import { describe, it, expect } from "vitest";
import path from "node:path";
import { parseAnalyzerMachine, parseTestFailures, parseTestSummary } from "../src/check/flutter.js";

const root = "/work/app";

describe("parseAnalyzerMachine", () => {
  it("parses SEVERITY|TYPE|CODE|FILE|LINE|COL|LEN|MESSAGE lines", () => {
    const out = [
      "ERROR|COMPILE_TIME_ERROR|UNDEFINED_IDENTIFIER|/work/app/lib/main.dart|12|5|3|Undefined name 'foo'.",
      "WARNING|STATIC_WARNING|UNUSED_IMPORT|/work/app/lib/src/a.dart|1|8|20|Unused import: 'dart:io'.",
      "INFO|LINT|PREFER_CONST_CONSTRUCTORS|/work/app/lib/b.dart|40|9|6|Prefer const with constant constructors.",
    ].join("\n");
    const issues = parseAnalyzerMachine(out, root);
    expect(issues).toHaveLength(3);
    expect(issues[0]).toEqual({
      severity: "ERROR",
      type: "COMPILE_TIME_ERROR",
      code: "undefined_identifier",
      file: path.join("lib", "main.dart"),
      line: 12,
      column: 5,
      message: "Undefined name 'foo'.",
    });
    expect(issues[1].severity).toBe("WARNING");
    expect(issues[1].file).toBe(path.join("lib", "src", "a.dart"));
    expect(issues[2]).toMatchObject({ severity: "INFO", code: "prefer_const_constructors", line: 40, column: 9 });
  });

  it("unescapes \\| and keeps literal pipes in the message", () => {
    const out = "ERROR|SYNTACTIC_ERROR|EXPECTED_TOKEN|/work/app/lib/main.dart|3|10|1|Expected to find 'a \\| b' but got x | y.";
    const [i] = parseAnalyzerMachine(out, root);
    expect(i.message).toBe("Expected to find 'a | b' but got x | y.");
    expect(i.line).toBe(3);
  });

  it("handles messages with several escaped pipes", () => {
    const out = "WARNING|HINT|DEAD_CODE|/work/app/lib/x.dart|7|1|2|a \\|\\| b \\| c";
    expect(parseAnalyzerMachine(out, root)[0].message).toBe("a || b | c");
  });

  it("ignores noise: banners, blank lines, short lines, unknown severities", () => {
    const out = [
      "Analyzing app...",
      "",
      "HINT|X|Y|/work/app/a.dart|1|1|1|nope",
      "ERROR|only|four|fields",
      "No issues found!",
    ].join("\n");
    expect(parseAnalyzerMachine(out, root)).toEqual([]);
  });

  it("handles CRLF output", () => {
    const out = "ERROR|T|C|/work/app/lib/a.dart|1|2|3|msg\r\nWARNING|T|C|/work/app/lib/b.dart|4|5|6|msg2\r\n";
    const issues = parseAnalyzerMachine(out, root);
    expect(issues.map((i) => i.message)).toEqual(["msg", "msg2"]);
  });

  it("keeps absolute path for files outside the root (relative would start with ..)", () => {
    const [i] = parseAnalyzerMachine("ERROR|T|C|/other/place/a.dart|1|2|3|m", root);
    expect(i.file).toBe(path.relative(root, "/other/place/a.dart"));
  });
});

// Realistic `flutter test --reporter expanded` output.
const PASSING = `00:00 +0: loading /work/app/test/widget_test.dart
00:02 +0: Counter increments smoke test
00:02 +1: Counter increments smoke test
00:02 +1: Home shows title
00:03 +2: Home shows title
00:03 +2: All tests passed!
`;

const FAILING = `00:00 +0: loading /work/app/test/widget_test.dart
00:02 +0: Counter increments smoke test
00:02 +1: Counter increments smoke test
00:02 +1: Home shows title
00:02 +1 -1: Home shows title [E]
  Expected: exactly one matching candidate
    Actual: _TextWidgetFinder:<Found 0 widgets with text "Hello": []>
     Which: means none were found but one was expected

  When the exception was thrown, this was the stack:
  #4      main.<anonymous closure> (file:///work/app/test/widget_test.dart:20:5)

00:02 +1 -1: Skipped feature ~ skip
00:03 +1 ~1 -1: Settings saves value
00:03 +2 ~1 -1: Settings saves value
00:03 +2 ~1 -2: Settings: toggles dark mode [E]
  Bad state: nope
00:04 +2 ~1 -2: Some tests failed.
`;

describe("parseTestFailures", () => {
  it("returns nothing for a passing run", () => {
    expect(parseTestFailures(PASSING)).toEqual([]);
  });

  it("extracts failing test names from [E] lines, with ~skipped counters too", () => {
    expect(parseTestFailures(FAILING)).toEqual(["Home shows title", "Settings: toggles dark mode"]);
  });

  it("deduplicates repeated failure lines", () => {
    const out = "00:01 +0 -1: dup test [E]\n00:02 +0 -1: dup test [E]\n";
    expect(parseTestFailures(out)).toEqual(["dup test"]);
  });

  it("handles CRLF", () => {
    expect(parseTestFailures("00:01 +0 -1: a b [E]\r\n00:01 +0 -2: c [E]\r\n")).toEqual(["a b", "c"]);
  });

  it("handles names with a minute count over 59 and long durations", () => {
    expect(parseTestFailures("100:01 +10 -1: late test [E]")).toEqual(["late test"]);
  });
});

describe("parseTestSummary", () => {
  it("reads the final progress line of a passing run", () => {
    expect(parseTestSummary(PASSING)).toEqual({ passed: 2, failed: 0, skipped: 0 });
  });

  it("reads passed/skipped/failed from the last progress line", () => {
    expect(parseTestSummary(FAILING)).toEqual({ passed: 2, failed: 2, skipped: 1 });
  });

  it("returns zeros for empty or unrelated output", () => {
    expect(parseTestSummary("")).toEqual({ passed: 0, failed: 0, skipped: 0 });
    expect(parseTestSummary("Resolving dependencies...\nGot dependencies!")).toEqual({ passed: 0, failed: 0, skipped: 0 });
  });

  it("a progress line without -N means zero failures", () => {
    expect(parseTestSummary("00:01 +5: x\n00:02 +7 ~2: All tests passed!")).toEqual({ passed: 7, failed: 0, skipped: 2 });
  });
});
