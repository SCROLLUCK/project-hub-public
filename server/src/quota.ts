import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface QuotaWindow {
  pct: number;
  /** ISO time the window resets, or null when unknown. */
  resetsAt: string | null;
  /** True when the stored window had already reset (counts as 0%). */
  reset: boolean;
}

export interface QuotaSource {
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  updatedAt: string | null;
  plan?: string;
  /** Where the numbers came from: the live usage API or a local file. */
  source?: "live" | "file";
  /** Claude only: per-model weekly windows (live source only). */
  models?: { name: string; sevenDay: QuotaWindow }[];
}

export type AgyGroup = { name: string } & QuotaSource;

export interface Quota {
  claude: QuotaSource | null;
  codex: QuotaSource | null;
  agy: AgyGroup[] | null;
  /** Every id Settings can toggle: platforms (always) and `claude:<model>` / `agy:<group>` of the platforms that were read. */
  available: string[];
}

/** `used` percent and `resets_at` in epoch seconds; a window that already reset reads 0%. */
export function parseWindow(used: unknown, resetsAtSec: unknown, nowSec: number): QuotaWindow | null {
  if (typeof used !== "number" || !Number.isFinite(used)) return null;
  const at = typeof resetsAtSec === "number" && Number.isFinite(resetsAtSec) ? resetsAtSec : null;
  const reset = at !== null && at < nowSec;
  return { pct: reset ? 0 : Math.round(used * 10) / 10, resetsAt: at === null ? null : new Date(at * 1000).toISOString(), reset };
}

interface ClaudeLatest {
  updated_at?: number;
  rate_limits?: Record<string, { used_percentage?: number; resets_at?: number } | undefined>;
}

export function parseClaude(data: ClaudeLatest, nowSec: number): QuotaSource {
  const rl = data.rate_limits ?? {};
  return {
    fiveHour: parseWindow(rl.five_hour?.used_percentage, rl.five_hour?.resets_at, nowSec),
    sevenDay: parseWindow(rl.seven_day?.used_percentage, rl.seven_day?.resets_at, nowSec),
    updatedAt: typeof data.updated_at === "number" ? new Date(data.updated_at * 1000).toISOString() : null,
    source: "file",
  };
}

function findLimit(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.limit_id === "codex") return o;
  for (const child of Object.values(o)) {
    const r = findLimit(child);
    if (r) return r;
  }
  return null;
}

/** Scan JSONL text from the end for the newest `limit_id: codex` record. */
export function parseCodexText(text: string, mtimeMs: number, nowSec: number): QuotaSource | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (!line.includes('"limit_id":"codex"')) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const lim = findLimit(obj);
    if (!lim) continue;
    const p = lim.primary as { used_percent?: number; resets_at?: number } | undefined;
    const s = lim.secondary as { used_percent?: number; resets_at?: number } | undefined;
    return {
      fiveHour: parseWindow(p?.used_percent, p?.resets_at, nowSec),
      sevenDay: parseWindow(s?.used_percent, s?.resets_at, nowSec),
      updatedAt: new Date(mtimeMs).toISOString(),
      source: "file",
      plan: typeof lim.plan_type === "string" ? lim.plan_type : undefined,
    };
  }
  return null;
}

/** Parse `agy /quota` TSV (group, limit, % remaining, reset ISO) into one entry per group. */
export function parseAgyText(text: string, mtimeMs: number, nowSec: number): AgyGroup[] {
  const groups = new Map<string, AgyGroup>();
  for (const line of text.split("\n")) {
    const parts = line.replace(/\r$/, "").split("\t");
    if (parts.length !== 4 || !parts[2]!.endsWith("%")) continue;
    const [name, limit, remaining, reset] = parts as [string, string, string, string];
    const left = Number(remaining.slice(0, -1));
    const at = Date.parse(reset);
    if (!name || remaining.length < 2 || !Number.isFinite(left)) continue;
    const key = /five hour/i.test(limit) ? "fiveHour" : /weekly/i.test(limit) ? "sevenDay" : null;
    if (!key) continue;
    let g = groups.get(name);
    if (!g) {
      g = { name, fiveHour: null, sevenDay: null, updatedAt: new Date(mtimeMs).toISOString(), source: "file" };
      groups.set(name, g);
    }
    g[key] = parseWindow(100 - left, Number.isNaN(at) ? null : at / 1000, nowSec);
  }
  return [...groups.values()];
}

async function readAgy(home: string, nowSec: number): Promise<AgyGroup[] | null> {
  try {
    const file = path.join(home, ".local", "state", "project-hub", "agy-quota.tsv");
    const [text, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    const groups = parseAgyText(text, st.mtimeMs, nowSec);
    return groups.length ? groups : null;
  } catch {
    return null;
  }
}

async function readTail(file: string, bytes: number): Promise<{ text: string; mtimeMs: number }> {
  const fh = await fs.open(file, "r");
  try {
    const st = await fh.stat();
    const len = Math.min(st.size, bytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, st.size - len);
    return { text: buf.toString("utf8"), mtimeMs: st.mtimeMs };
  } finally {
    await fh.close();
  }
}

async function rollouts(dir: string, out: { file: string; mtimeMs: number }[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (e) => {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) return rollouts(f, out);
      if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) out.push({ file: f, mtimeMs: (await fs.stat(f)).mtimeMs });
    }),
  );
}

async function readCodex(home: string, nowSec: number): Promise<QuotaSource | null> {
  const files: { file: string; mtimeMs: number }[] = [];
  await rollouts(path.join(home, ".codex", "sessions"), files);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const f of files.slice(0, 10)) {
    try {
      const { text, mtimeMs } = await readTail(f.file, 4_000_000);
      const q = parseCodexText(text, mtimeMs, nowSec);
      if (q) return q;
    } catch {
      /* try next */
    }
  }
  return null;
}

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const LIVE_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export type UsageFetcher = (token: string) => Promise<unknown>;

/** Never throws a message containing the token; callers only see a generic failure. */
export const fetchUsage: UsageFetcher = async (token) => {
  const res = await fetch(USAGE_URL, {
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`usage API ${res.status}`);
  return res.json();
};

function liveWindow(w: unknown, nowSec: number): QuotaWindow | null {
  if (!w || typeof w !== "object") return null;
  const o = w as { utilization?: unknown; resets_at?: unknown };
  const at = typeof o.resets_at === "string" ? Date.parse(o.resets_at) : NaN;
  return parseWindow(o.utilization, Number.isNaN(at) ? null : at / 1000, nowSec);
}

/** Map the OAuth usage response to a QuotaSource; null when it has no usable window. */
export function parseClaudeLive(data: unknown, nowMs: number): QuotaSource | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { five_hour?: unknown; seven_day?: unknown; limits?: unknown };
  const fiveHour = liveWindow(d.five_hour, nowMs / 1000);
  const sevenDay = liveWindow(d.seven_day, nowMs / 1000);
  if (!fiveHour && !sevenDay) return null;
  const models: NonNullable<QuotaSource["models"]> = [];
  for (const l of Array.isArray(d.limits) ? d.limits : []) {
    const o = l as { kind?: unknown; percent?: unknown; resets_at?: unknown; scope?: { model?: { display_name?: unknown } } } | null;
    const name = o?.scope?.model?.display_name;
    if (o?.kind !== "weekly_scoped" || typeof name !== "string" || !name) continue;
    const at = typeof o.resets_at === "string" ? Date.parse(o.resets_at) : NaN;
    const w = parseWindow(o.percent, Number.isNaN(at) ? null : at / 1000, nowMs / 1000);
    if (w) models.push({ name, sevenDay: w });
  }
  return { fiveHour, sevenDay, updatedAt: new Date(nowMs).toISOString(), source: "live", ...(models.length ? { models } : {}) };
}

export interface LiveCache {
  at: number;
  value: QuotaSource | null;
  inflight: Promise<QuotaSource | null> | null;
}
export const newLiveCache = (): LiveCache => ({ at: 0, value: null, inflight: null });
const sharedCache = newLiveCache();

async function readToken(home: string): Promise<string | null> {
  try {
    const j = JSON.parse(await fs.readFile(path.join(home, ".claude", ".credentials.json"), "utf8"));
    const t = j?.claudeAiOauth?.accessToken;
    return typeof t === "string" && t ? t : null;
  } catch {
    return null;
  }
}

/** Live Claude usage, fetched at most once per 5 min (failures count too); null on any failure. */
export function readClaudeLive(home: string, now: number, fetcher: UsageFetcher = fetchUsage, cache: LiveCache = sharedCache): Promise<QuotaSource | null> {
  if (cache.inflight) return cache.inflight;
  if (cache.at && now - cache.at < LIVE_TTL_MS) return Promise.resolve(cache.value);
  cache.inflight = (async () => {
    try {
      const token = await readToken(home);
      cache.value = token ? parseClaudeLive(await fetcher(token), now) : null;
    } catch {
      cache.value = null;
    }
    cache.at = now;
    return cache.value;
  })().finally(() => {
    cache.inflight = null;
  });
  return cache.inflight;
}

/** Hide models listed in `hidden`; the platform itself is expected to be visible already. */
export function filterQuota(q: Quota, hidden: string[]): Quota {
  const off = new Set(hidden);
  const claude = q.claude?.models ? { ...q.claude, models: q.claude.models.filter((m) => !off.has(`claude:${m.name}`)) } : q.claude;
  const agy = q.agy ? q.agy.filter((g) => !off.has(`agy:${g.name}`)) : q.agy;
  return { ...q, claude, agy: agy && agy.length ? agy : null };
}

/** `hidden` platforms are not read at all; hidden models are filtered from the result. */
export async function readQuota(home = os.homedir(), now = Date.now(), fetcher?: UsageFetcher, cache?: LiveCache, hidden: string[] = []): Promise<Quota> {
  const nowSec = now / 1000;
  const off = new Set(hidden);
  let claude: QuotaSource | null = null;
  if (!off.has("claude")) {
    claude = await readClaudeLive(home, now, fetcher, cache);
    if (!claude) {
      try {
        claude = parseClaude(JSON.parse(await fs.readFile(path.join(home, ".claude", "state", "usage", "latest.json"), "utf8")), nowSec);
      } catch {
        /* no data */
      }
    }
  }
  const codex = off.has("codex") ? null : await readCodex(home, nowSec);
  const agy = off.has("agy") ? null : await readAgy(home, nowSec);
  const available = [
    "claude",
    ...(claude?.models ?? []).map((m) => `claude:${m.name}`),
    "codex",
    "agy",
    ...(agy ?? []).map((g) => `agy:${g.name}`),
  ];
  return filterQuota({ claude, codex, agy, available }, hidden);
}
