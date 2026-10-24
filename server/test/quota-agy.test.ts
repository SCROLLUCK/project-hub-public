import { describe, expect, it } from "vitest";
import { parseAgyText } from "../src/quota";

const SAMPLE = [
  "Gemini Models\tWeekly Limit Remaining\t100%\t2026-10-25T03:38:30Z",
  "Gemini Models\tFive Hour Limit Remaining\t100%\t2026-10-18T08:38:30Z",
  "Claude and GPT models\tWeekly Limit Remaining\t49%\t2026-10-24T23:39:22Z",
  "Claude and GPT models\tFive Hour Limit Remaining\t0%\t2026-10-18T04:39:22Z",
  "Gemini 4 Argon\tGemini 4 Argon Weekly Limit\t81%\t2026-10-24T18:14:47Z",
].join("\n");
const NOW = Date.parse("2026-10-18T00:00:00Z") / 1000;

describe("parseAgyText", () => {
  it("groups lines and converts remaining to used", () => {
    const g = parseAgyText(`Header\n\n${SAMPLE}\n`, Date.parse("2026-10-18T00:00:00Z"), NOW);
    expect(g.map((x) => x.name)).toEqual(["Gemini Models", "Claude and GPT models", "Gemini 4 Argon"]);
    expect(g[1]!.fiveHour).toMatchObject({ pct: 100, reset: false, resetsAt: "2026-10-18T04:39:22.000Z" });
    expect(g[1]!.sevenDay!.pct).toBe(51);
    expect(g[0]!.fiveHour!.pct).toBe(0);
    expect(g[2]!.fiveHour).toBeNull();
    expect(g[2]!.sevenDay!.pct).toBe(19);
    expect(g[0]).toMatchObject({ source: "file", updatedAt: "2026-10-18T00:00:00.000Z" });
  });

  it("returns nothing for junk and treats passed resets as 0%", () => {
    expect(parseAgyText("no quota\nfoo\tbar\n", 0, NOW)).toEqual([]);
    const g = parseAgyText("G\tFive Hour Limit\t10%\t2026-10-17T00:00:00Z", 0, NOW);
    expect(g[0]!.fiveHour).toMatchObject({ pct: 0, reset: true });
  });
});
