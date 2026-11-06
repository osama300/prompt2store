import { describe, it, expect } from "vitest";
import { quoteForCmd, pickStableArchive, releaseManifestUrl } from "../src/check/flutter.js";

describe("Windows command quoting", () => {
  it("leaves simple args alone and quotes spaces, Arabic-with-spaces and quotes", () => {
    expect(quoteForCmd("analyze")).toBe("analyze");
    expect(quoteForCmd("--project-name")).toBe("--project-name");
    expect(quoteForCmd("C:\\Users\\Ahmed Ali\\app")).toBe('"C:\\Users\\Ahmed Ali\\app"');
    expect(quoteForCmd("قائمة المشتريات")).toBe('"قائمة المشتريات"');
    expect(quoteForCmd('say "hi"')).toBe('"say ""hi"""');
    expect(quoteForCmd("a&b")).toBe('"a&b"');
    expect(quoteForCmd("")).toBe('""');
  });
});

describe("Flutter release archive selection", () => {
  const manifest = {
    base_url: "https://storage.googleapis.com/flutter_infra_release/releases",
    current_release: { stable: "abc" },
    releases: [
      { hash: "old", archive: "stable/macos/old.zip", dart_sdk_arch: "x64" },
      { hash: "abc", archive: "stable/macos/flutter_macos_3.0.0-stable.zip", dart_sdk_arch: "x64" },
      { hash: "abc", archive: "stable/macos/flutter_macos_arm64_3.0.0-stable.zip", dart_sdk_arch: "arm64" },
    ],
  };
  it("picks the current stable for the CPU", () => {
    expect(pickStableArchive(manifest, "arm64")).toMatch(/arm64_3\.0\.0/);
    expect(pickStableArchive(manifest, "x64")).toMatch(/flutter_macos_3\.0\.0/);
  });
  it("uses the per-OS manifest", () => {
    expect(releaseManifestUrl("win32")).toMatch(/releases_windows\.json$/);
    expect(releaseManifestUrl("darwin")).toMatch(/releases_macos\.json$/);
    expect(releaseManifestUrl("linux")).toMatch(/releases_linux\.json$/);
  });
});
