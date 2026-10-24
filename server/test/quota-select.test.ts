import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applySettings, defaultConfig } from "../src/config";
import { newLiveCache, parseClaudeLive, readQuota } from "../src/quota";

const NOW = Date.parse("2026-10-23T12:00:00Z");
const USAGE = {
  five_hour: { utilization: 71, resets_at: "2026-10-23T15:00:00+00:00" },
  seven_day: { utilization: 82, resets_at: "2026-10-24T09:00:00+00:00" },
  limits: [
    { kind: "session", percent: 71, resets_at: "2026-10-23T15:00:00+00:00" },
    { kind: "weekly_all", percent: 82, resets_at: "2026-10-24T09:00:00+00:00" },
    { kind: "weekly_scoped", percent: 7, resets_at: "2026-10-24T13:00:00+00:00", scope: { model: { id: null, display_name: "Fable" }, surface: null } },
    { kind: "weekly_scoped", percent: 3, resets_at: "2026-10-24T13:00:00+00:00", scope: { model: null, surface: null } },
  ],
};

async function home(): Promise<string> {
  const h = await fs.mkdtemp(path.join(os.tmpdir(), "quota-sel-"));
  await fs.mkdir(path.join(h, ".claude"), { recursive: true });
  await fs.writeFile(path.join(h, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "t" } }));
  const dir = path.join(h, ".local", "state", "project-hub");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "agy-quota.tsv"), "G1\tFive Hour Limit\t50%\t2026-10-23T15:00:00Z\nG2\tWeekly Limit\t80%\t2026-10-24T15:00:00Z\n");
  return h;
}

describe("applySettings quotaHidden", () => {
  it("defaults to empty, accepts string arrays and ignores other values", () => {
    expect(defaultConfig().quotaHidden).toEqual([]);
    expect(applySettings(defaultConfig(), { quotaHidden: ["codex", 3 as unknown as string, "claude:Fable"] }).quotaHidden).toEqual(["codex", "claude:Fable"]);
    expect(applySettings(defaultConfig(), { quotaHidden: "codex" as unknown as string[] }).quotaHidden).toEqual([]);
  });
});

describe("claude scoped models", () => {
  it("parses weekly_scoped limits with a model name", () => {
    const q = parseClaudeLive(USAGE, NOW)!;
    expect(q.models).toHaveLength(1);
    expect(q.models![0]).toMatchObject({ name: "Fable", sevenDay: { pct: 7, resetsAt: "2026-10-24T13:00:00.000Z", reset: false } });
  });
  it("omits models when the response has none", () => {
    expect(parseClaudeLive({ five_hour: USAGE.five_hour }, NOW)!.models).toBeUndefined();
  });
});

describe("readQuota with quotaHidden", () => {
  it("returns everything and lists available ids by default", async () => {
    const q = await readQuota(await home(), NOW, async () => USAGE, newLiveCache());
    expect(q.claude!.models!.map((m) => m.name)).toEqual(["Fable"]);
    expect(q.agy!.map((g) => g.name)).toEqual(["G1", "G2"]);
    expect(q.available).toEqual(["claude", "claude:Fable", "codex", "agy", "agy:G1", "agy:G2"]);
  });

  it("does not read hidden platforms", async () => {
    let calls = 0;
    const q = await readQuota(await home(), NOW, async () => (calls++, USAGE), newLiveCache(), ["claude", "agy", "codex"]);
    expect(calls).toBe(0);
    expect(q).toMatchObject({ claude: null, codex: null, agy: null, available: ["claude", "codex", "agy"] });
  });

  it("filters hidden models but still lists them as available", async () => {
    const q = await readQuota(await home(), NOW, async () => USAGE, newLiveCache(), ["claude:Fable", "agy:G1"]);
    expect(q.claude!.models).toEqual([]);
    expect(q.agy!.map((g) => g.name)).toEqual(["G2"]);
    expect(q.available).toContain("claude:Fable");
    expect(q.available).toContain("agy:G1");
  });
});
