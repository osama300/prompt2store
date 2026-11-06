import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Minimal YAML-frontmatter check (no yaml dependency): every value must be either quoted or free of ": ".
const dir = path.resolve(__dirname, "../skills");
const skills = fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, "SKILL.md")));

describe("skills", () => {
  it("has the five skills", () => {
    expect(skills.sort()).toEqual(["check", "doctor", "prompt-to-store", "ship", "store-listing"]);
  });
  for (const s of skills) {
    it(`${s}: valid frontmatter, third-person description, size limits`, () => {
      const text = fs.readFileSync(path.join(dir, s, "SKILL.md"), "utf8");
      expect(text.startsWith("---\n")).toBe(true);
      const fm = text.split("---")[1];
      const name = fm.match(/^name: (.+)$/m)?.[1];
      const descRaw = fm.match(/^description: (.+)$/m)?.[1] ?? "";
      expect(name).toBe(s);
      expect(name).toMatch(/^[a-z0-9-]{1,64}$/);
      const quoted = descRaw.startsWith('"');
      const desc = quoted ? JSON.parse(descRaw) : descRaw;
      if (!quoted) expect(descRaw).not.toMatch(/: /); // would break YAML
      expect(desc.length).toBeLessThanOrEqual(1024);
      expect(desc).toMatch(/Use when/);
      expect(desc).not.toMatch(/^(I |You )/);
      expect(text.split("\n").length).toBeLessThan(500);
    });
  }
});
