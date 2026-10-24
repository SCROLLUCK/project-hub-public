import { describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config";
import { probeShowcase, showcaseEntries } from "../src/showcase";

describe("showcase", () => {
  it("lists only projects with a showcaseUrl, pinned first, skipping unknown ids", () => {
    const cfg = { ...defaultConfig(), pinned: ["b"], projects: { a: { showcaseUrl: "http://a.local:1" }, b: { showcaseUrl: "http://b.local:2" }, c: {}, gone: { showcaseUrl: "http://x" } } };
    const found = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
    expect(showcaseEntries(cfg, found).map((e) => e.projectId)).toEqual(["b", "a"]);
  });
  it("marks up below 500, down on 5xx or no answer, and reads embeddability", async () => {
    const answers: Record<string, { status: number; contentType: string | null; xFrameOptions?: string } | null> = {
      "http://ok": { status: 200, contentType: "text/html" },
      "http://denied": { status: 404, contentType: "text/html", xFrameOptions: "DENY" },
      "http://err": { status: 502, contentType: "text/html" },
      "http://none": null,
    };
    const entries = Object.keys(answers).map((url) => ({ projectId: url, name: url, url }));
    const res = await probeShowcase(entries, async (u) => answers[u] ?? null);
    expect(res.map((r) => [r.up, r.embeddable])).toEqual([[true, true], [true, false], [false, false], [false, false]]);
  });
});
