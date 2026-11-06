import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import forge from "node-forge";
import { ensureUploadKey, ensureIosCertificateKey, patchGradleSigning } from "../src/services/signing.js";
import { StateStore } from "../src/state/store.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const mode = (f: string) => fs.statSync(f).mode & 0o777;

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p2s-sign-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("ensureUploadKey", () => {
  it("creates a PKCS#12 keystore readable with the password, alias 'upload'", () => {
    const dir = path.join(tmp, ".prompt-to-store");
    const { key, created } = ensureUploadKey(dir, "My App");
    expect(created).toBe(true);
    expect(key.alias).toBe("upload");
    expect(key.password.length).toBeGreaterThanOrEqual(16);
    expect(key.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

    const der = forge.util.decode64(key.p12Base64);
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), key.password);
    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]!;
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]!;
    expect(keyBags).toHaveLength(1);
    expect(certBags).toHaveLength(1);
    expect(keyBags[0].attributes.friendlyName?.[0]).toBe("upload");
    const cert = certBags[0].cert!;
    expect(cert.subject.getField("CN").value).toBe("My App");
    expect(cert.publicKey && (cert.publicKey as forge.pki.rsa.PublicKey).n.bitLength()).toBe(2048);
    // ~30 year validity
    const years = (cert.validity.notAfter.getTime() - cert.validity.notBefore.getTime()) / (365.25 * 24 * 3600 * 1000);
    expect(years).toBeGreaterThan(29.9);
    expect(years).toBeLessThan(30.1);
    // fingerprint reported matches the certificate
    const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const sha = crypto.createHash("sha256").update(Buffer.from(certDer, "binary")).digest("hex").toUpperCase().match(/../g)!.join(":");
    expect(key.sha256).toBe(sha);
    // wrong password fails
    expect(() => forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), "wrong")).toThrow();
  }, 60_000);

  it("is idempotent: the second call returns the same key with created=false", () => {
    const dir = path.join(tmp, ".prompt-to-store");
    const a = ensureUploadKey(dir, "App");
    const b = ensureUploadKey(dir, "Other Name");
    expect(b.created).toBe(false);
    expect(b.key).toEqual(a.key);
  }, 60_000);

  it("writes key files with mode 0600 and the p12 matches the json", () => {
    const dir = path.join(tmp, ".prompt-to-store");
    const { key } = ensureUploadKey(dir, "App");
    const json = path.join(dir, "keys", "android-upload-key.json");
    const p12 = path.join(dir, "keys", "android-upload-key.p12");
    if (process.platform !== "win32") expect(mode(json)).toBe(0o600);
    if (process.platform !== "win32") expect(mode(p12)).toBe(0o600);
    expect(fs.readFileSync(p12).toString("base64")).toBe(key.p12Base64);
    expect(JSON.parse(fs.readFileSync(json, "utf8")).password).toBe(key.password);
    if (process.platform !== "win32") expect(mode(path.join(dir, "keys"))).toBe(0o700);
  }, 60_000);

  it("adds keys/ to .prompt-to-store/.gitignore once, keeping existing entries", () => {
    const store = new StateStore(tmp);
    store.init();
    const gi = path.join(store.p.dir, ".gitignore");
    ensureUploadKey(store.p.dir, "App");
    ensureUploadKey(store.p.dir, "App");
    ensureIosCertificateKey(store.p.dir);
    const lines = fs.readFileSync(gi, "utf8").split("\n");
    expect(lines).toContain("secrets.json");
    expect(lines).toContain("ui.json");
    expect(lines.filter((l) => l === "keys/")).toHaveLength(1);
  }, 60_000);

  // Regression (fixed): keysDir() creates .prompt-to-store/.gitignore containing only "keys/" when the
  // file is missing, and StateStore.ensureDir() then never adds "secrets.json"/"ui.json" because the file exists.
  it("does not leave secrets.json un-ignored when the key is created before the state store", () => {
    const store = new StateStore(tmp);
    ensureUploadKey(store.p.dir, "App");
    store.init();
    const lines = fs.readFileSync(path.join(store.p.dir, ".gitignore"), "utf8").split("\n");
    expect(lines).toContain("keys/");
    expect(lines).toContain("secrets.json");
  }, 60_000);

  it("truncates a very long common name to 64 chars", () => {
    const { key } = ensureUploadKey(path.join(tmp, ".p2s"), "x".repeat(200));
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(key.p12Base64)), key.password);
    const cert = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]![0].cert!;
    expect(cert.subject.getField("CN").value).toHaveLength(64);
  }, 60_000);
});

describe("ensureIosCertificateKey", () => {
  it("creates a PKCS#1 RSA key (0600) and returns the same one next time", () => {
    const dir = path.join(tmp, ".prompt-to-store");
    const a = ensureIosCertificateKey(dir);
    expect(a).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
    if (process.platform !== "win32") expect(mode(path.join(dir, "keys", "ios-certificate-key.pem"))).toBe(0o600);
    expect(ensureIosCertificateKey(dir)).toBe(a);
    expect(crypto.createPrivateKey(a).asymmetricKeyType).toBe("rsa");
  });
});

describe("patchGradleSigning (Kotlin DSL, current Flutter template)", () => {
  const app = () => path.join(tmp, "android", "app");
  const put = (name: string, from: string) => {
    fs.mkdirSync(app(), { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, from), path.join(app(), name));
    return path.join(app(), name);
  };

  it("inserts keystoreProperties before `android {`, a release signingConfig, and the conditional signingConfig", () => {
    const file = put("build.gradle.kts", "build.gradle.kts");
    const r = patchGradleSigning(tmp);
    expect(r).toEqual({ file, changed: true });
    const s = fs.readFileSync(file, "utf8");

    const iProps = s.indexOf("val keystoreProperties = java.util.Properties()");
    const iFile = s.indexOf('val keystorePropertiesFile = rootProject.file("key.properties")');
    const iAndroid = s.search(/^android \{/m);
    expect(iProps).toBeGreaterThan(0);
    expect(iFile).toBeGreaterThan(iProps);
    expect(iAndroid).toBeGreaterThan(iFile);
    expect(s).toContain("// prompt-to-store: release signing");

    // signingConfigs sits inside android { before buildTypes
    const iSigning = s.indexOf("signingConfigs {");
    const iBuildTypes = s.indexOf("buildTypes {");
    expect(iSigning).toBeGreaterThan(iAndroid);
    expect(iBuildTypes).toBeGreaterThan(iSigning);
    expect(s).toContain('create("release") {');
    expect(s).toContain('storeType = "pkcs12"');
    expect(s).toContain('storeFile = file(keystoreProperties["storeFile"] as String)');

    expect(s).toContain('signingConfig = if (keystorePropertiesFile.exists()) signingConfigs.getByName("release") else signingConfigs.getByName("debug")');
    expect(s).not.toMatch(/signingConfig = signingConfigs\.getByName\("debug"\)\s*$/m);
    // untouched parts remain
    expect(s).toContain('namespace = "com.example.x"');
    expect(s).toContain('source = "../.."');
    // braces stay balanced
    expect((s.match(/\{/g) ?? []).length).toBe((s.match(/\}/g) ?? []).length);
  });

  it("is idempotent", () => {
    const file = put("build.gradle.kts", "build.gradle.kts");
    expect(patchGradleSigning(tmp).changed).toBe(true);
    const once = fs.readFileSync(file, "utf8");
    expect(patchGradleSigning(tmp)).toEqual({ file, changed: false });
    expect(fs.readFileSync(file, "utf8")).toBe(once);
    expect(once.match(/val keystoreProperties /g)).toHaveLength(1);
  });

  it("throws and leaves the file untouched when the release signingConfig line is missing", () => {
    const file = put("build.gradle.kts", "build.gradle.kts");
    const custom = fs.readFileSync(file, "utf8").replace('signingConfig = signingConfigs.getByName("debug")', 'signingConfig = signingConfigs.getByName("custom")');
    fs.writeFileSync(file, custom);
    expect(() => patchGradleSigning(tmp)).toThrow(/Could not find the release signingConfig line/);
    expect(fs.readFileSync(file, "utf8")).toBe(custom);
  });

  it("throws a helpful error when there is no gradle file", () => {
    expect(() => patchGradleSigning(tmp)).toThrow(/build\.gradle\(\.kts\) not found/);
  });

  it("prefers .kts when both exist", () => {
    const kts = put("build.gradle.kts", "build.gradle.kts");
    put("build.gradle", "build.gradle.groovy");
    expect(patchGradleSigning(tmp).file).toBe(kts);
  });
});

describe("patchGradleSigning (Groovy, older Flutter template)", () => {
  it("patches build.gradle with the groovy syntax", () => {
    fs.mkdirSync(path.join(tmp, "android", "app"), { recursive: true });
    const file = path.join(tmp, "android", "app", "build.gradle");
    fs.copyFileSync(path.join(FIXTURES, "build.gradle.groovy"), file);
    const r = patchGradleSigning(tmp);
    expect(r).toEqual({ file, changed: true });
    const s = fs.readFileSync(file, "utf8");

    expect(s).toContain("def keystoreProperties = new Properties()");
    expect(s).toContain("def keystorePropertiesFile = rootProject.file('key.properties')");
    expect(s.indexOf("def keystoreProperties")).toBeLessThan(s.search(/^android \{/m));
    expect(s).toMatch(/signingConfigs \{\n\s+release \{/);
    expect(s).toContain("storeType 'pkcs12'");
    expect(s.indexOf("signingConfigs {")).toBeLessThan(s.indexOf("buildTypes {"));
    expect(s).toContain("signingConfig keystorePropertiesFile.exists() ? signingConfigs.release : signingConfigs.debug");
    expect(s).not.toMatch(/signingConfig signingConfigs\.debug\s*$/m);
    expect((s.match(/\{/g) ?? []).length).toBe((s.match(/\}/g) ?? []).length);

    // idempotent
    expect(patchGradleSigning(tmp).changed).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(s);
  });

  it("throws if the groovy file has no signingConfigs.debug line", () => {
    fs.mkdirSync(path.join(tmp, "android", "app"), { recursive: true });
    const file = path.join(tmp, "android", "app", "build.gradle");
    fs.writeFileSync(file, "android {\n  buildTypes {\n    release {\n    }\n  }\n}\n");
    expect(() => patchGradleSigning(tmp)).toThrow(/Could not find the release signingConfig line/);
  });
});
