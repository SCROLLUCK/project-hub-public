import { describe, expect, it } from "vitest";
import { parseIssues, type IssueState } from "../src/previews";

function run(lines: string[]): string[] {
  const state: IssueState = { issues: [] };
  for (const l of lines) parseIssues(l, state);
  return state.issues;
}

describe("parseIssues", () => {
  it("vite failed import", () => {
    expect(run(['Failed to resolve import "zustand" from "src/a.ts". Does the file exist?'])).toEqual(["missing dependency: zustand"]);
  });
  it("vite dep scan list", () => {
    expect(
      run([
        "The following dependencies are imported but could not be resolved:",
        "",
        "  lodash (imported by /x/src/a.ts)",
        "  @scope/pkg (imported by /x/src/b.ts)",
        "unrelated",
        "  other (imported by /x/c.ts)",
      ]),
    ).toEqual(["missing dependency: lodash", "missing dependency: @scope/pkg"]);
  });
  it("node module / package", () => {
    expect(run(["Error: Cannot find module 'express'", "Cannot find package 'zod' imported from /a.js"])).toEqual([
      "missing dependency: express",
      "missing dependency: zod",
    ]);
  });
  it("ignores relative and absolute paths", () => {
    expect(run(["Cannot find module './local'", "Cannot find module '/abs/x'", 'Failed to resolve import "../x" from "a.ts"'])).toEqual([]);
  });
  it("shell missing tool", () => {
    expect(run(["sh: 1: vite: not found", "bash: line 3: tsx: command not found"])).toEqual(["missing tool: vite", "missing tool: tsx"]);
  });
  it("deduplicates", () => {
    expect(run(["Cannot find module 'a'", "Cannot find module 'a'"])).toEqual(["missing dependency: a"]);
  });
});
