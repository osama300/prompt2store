import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import forge from "node-forge";

/**
 * Android upload key + iOS certificate key management.
 * Keys are generated locally, stored in .prompt-to-store/keys/ (gitignored, 0600) and pushed to Codemagic
 * variable groups by the tools. They never pass through the agent conversation.
 */

export interface UploadKey {
  p12Base64: string;
  password: string;
  alias: string;
  sha256: string;
  createdAt: string;
}

export function keysDir(p2sDir: string) {
  const d = path.join(p2sDir, "keys");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const gi = path.join(p2sDir, ".gitignore");
  const cur = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  if (!cur.split(/\r?\n/).includes("keys/")) fs.writeFileSync(gi, `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}keys/\n`);
  return d;
}

function writeSecret(file: string, data: string) {
  fs.writeFileSync(file, data, { mode: 0o600 });
}

/** Create (once) a PKCS#12 upload keystore — RSA 2048, 30-year validity — usable by Gradle. */
export function ensureUploadKey(p2sDir: string, commonName: string): { key: UploadKey; created: boolean } {
  const file = path.join(keysDir(p2sDir), "android-upload-key.json");
  if (fs.existsSync(file)) return { key: JSON.parse(fs.readFileSync(file, "utf8")), created: false };
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01" + crypto.randomBytes(8).toString("hex");
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 30);
  const attrs = [{ name: "commonName", value: commonName.slice(0, 64) }, { name: "organizationName", value: "prompt-to-store upload key" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const password = crypto.randomBytes(18).toString("base64url");
  const alias = "upload";
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: "3des", friendlyName: alias, generateLocalKeyId: true });
  const der = forge.asn1.toDer(p12).getBytes();
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const key: UploadKey = {
    p12Base64: forge.util.encode64(der),
    password,
    alias,
    sha256: crypto.createHash("sha256").update(Buffer.from(certDer, "binary")).digest("hex").toUpperCase().match(/../g)!.join(":"),
    createdAt: new Date().toISOString(),
  };
  writeSecret(file, JSON.stringify(key, null, 2));
  fs.writeFileSync(path.join(keysDir(p2sDir), "android-upload-key.p12"), Buffer.from(key.p12Base64, "base64"), { mode: 0o600 });
  return { key, created: true };
}

/** RSA private key used by `app-store-connect fetch-signing-files --create` for the distribution certificate. */
export function ensureIosCertificateKey(p2sDir: string): string {
  const file = path.join(keysDir(p2sDir), "ios-certificate-key.pem");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  writeSecret(file, pem);
  return pem;
}

const KTS_MARK = "// prompt-to-store: release signing";

/**
 * Patch android/app/build.gradle(.kts) so release builds use android/key.properties when present
 * and fall back to the debug key otherwise (keeps test builds working without a keystore).
 */
export function patchGradleSigning(projectRoot: string): { file: string; changed: boolean } {
  const kts = path.join(projectRoot, "android", "app", "build.gradle.kts");
  const groovy = path.join(projectRoot, "android", "app", "build.gradle");
  if (fs.existsSync(kts)) return patchKts(kts);
  if (fs.existsSync(groovy)) return patchGroovy(groovy);
  throw new Error("android/app/build.gradle(.kts) not found — is this a Flutter project with Android enabled?");
}

function patchKts(file: string) {
  let s = fs.readFileSync(file, "utf8");
  if (s.includes(KTS_MARK) || s.includes("keystoreProperties")) return { file, changed: false };
  const header = `${KTS_MARK}
val keystoreProperties = java.util.Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(java.io.FileInputStream(keystorePropertiesFile))
}
`;
  // fully-qualified names: Kotlin scripts don't allow imports mid-file
  s = s.replace(/\nandroid\s*\{/, `\n${header}\nandroid {`);
  s = s.replace(
    /(\n\s*buildTypes\s*\{)/,
    `
    signingConfigs {
        create("release") {
            if (keystorePropertiesFile.exists()) {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
                storeType = "pkcs12"
            }
        }
    }
$1`,
  );
  const replaced = s.replace(
    /signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)/,
    `signingConfig = if (keystorePropertiesFile.exists()) signingConfigs.getByName("release") else signingConfigs.getByName("debug")`,
  );
  if (replaced === s) throw new Error(`Could not find the release signingConfig line in ${file}; add release signing manually (see Flutter docs: Build and release an Android app).`);
  fs.writeFileSync(file, replaced);
  return { file, changed: true };
}

function patchGroovy(file: string) {
  let s = fs.readFileSync(file, "utf8");
  if (s.includes(KTS_MARK) || s.includes("keystoreProperties")) return { file, changed: false };
  s = s.replace(
    /\nandroid\s*\{/,
    `\n${KTS_MARK}
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {`,
  );
  s = s.replace(
    /(\n\s*buildTypes\s*\{)/,
    `
    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                storeType 'pkcs12'
            }
        }
    }
$1`,
  );
  const replaced = s.replace(/signingConfig\s+signingConfigs\.debug/, "signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug");
  if (replaced === s) throw new Error(`Could not find the release signingConfig line in ${file}; add release signing manually.`);
  fs.writeFileSync(file, replaced);
  return { file, changed: true };
}
