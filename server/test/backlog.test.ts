import { describe, expect, it } from "vitest";
import { BacklogMismatch, addItem, parseBacklog, toggleItem } from "../src/backlog";

const SAMPLE = `---
title: Backlog
---
# Backlog

## Next

- [ ] first
- [x] second
- plain note

## Done

- [x] shipped
`;

describe("parseBacklog", () => {
  it("skips frontmatter, tracks sections and counts only checkboxes", () => {
    const s = parseBacklog(SAMPLE);
    expect(s.items.map((i) => [i.line, i.text, i.done, i.section])).toEqual([
      [8, "first", false, "Next"],
      [9, "second", true, "Next"],
      [10, "plain note", null, "Next"],
      [14, "shipped", true, "Done"],
    ]);
    expect(s.open).toBe(1);
    expect(s.done).toBe(2);
  });

  it("ignores items inside code fences", () => {
    const s = parseBacklog("## A\n```\n- [ ] fake\n```\n- [ ] real\n");
    expect(s.items.map((i) => i.text)).toEqual(["real"]);
  });
});

describe("continuation lines and ordered items", () => {
  const MD = "## Next\n\n- **A** (date). first line\n  second line\n  third line\n- [ ] B\n  more B\n\n  not part of B\n1. one\n2. [x] two\n   cont two\n## Z\n- z\n";

  it("folds indented continuation lines into the item body", () => {
    const s = parseBacklog(MD);
    expect(s.items.map((i) => [i.line, i.text, i.body, i.done])).toEqual([
      [3, "**A** (date). first line", "**A** (date). first line\nsecond line\nthird line", null],
      [6, "B", "B\nmore B", false],
      [10, "one", "one", null],
      [11, "two", "two\ncont two", true],
      [14, "z", "z", null],
    ]);
  });

  it("toggles ordered checkboxes without touching continuation lines", () => {
    const out = toggleItem(MD, 11, false, "two");
    expect(out).toBe(MD.replace("2. [x] two", "2. [ ] two"));
    const out2 = toggleItem(MD, 6, true, "B");
    expect(out2).toBe(MD.replace("- [ ] B", "- [x] B"));
  });
});

describe("toggleItem", () => {
  it("flips the checkbox on the matching line", () => {
    const out = toggleItem(SAMPLE, 8, true, "first");
    expect(out.split("\n")[7]).toBe("- [x] first");
    expect(toggleItem(out, 8, false, "first")).toBe(SAMPLE);
  });

  it("throws on text mismatch or non-checkbox line", () => {
    expect(() => toggleItem(SAMPLE, 8, true, "other")).toThrow(BacklogMismatch);
    expect(() => toggleItem(SAMPLE, 10, true, "plain note")).toThrow(BacklogMismatch);
    expect(() => toggleItem(SAMPLE, 99, true, "x")).toThrow(BacklogMismatch);
  });
});

describe("addItem", () => {
  it("appends at the end of an existing section", () => {
    const out = addItem(SAMPLE, "Next", "third");
    const lines = out.split("\n");
    expect(lines[10]).toBe("- [ ] third");
    expect(lines[11]).toBe("");
    expect(lines[12]).toBe("## Done");
  });

  it("creates the section when absent", () => {
    const out = addItem("# Backlog\n\n## Next\n\n- [ ] a\n", "Later", "b");
    expect(out.endsWith("## Later\n\n- [ ] b\n")).toBe(true);
  });

  it("fills an empty section", () => {
    const out = addItem("# Backlog\n\n## Next\n\n## Done\n", "Next", "a");
    expect(out).toBe("# Backlog\n\n## Next\n\n- [ ] a\n\n## Done\n");
  });
});
