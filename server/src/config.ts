import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProjectConfig {
  devCommand?: string;
  devCwd?: string;
  /** URL of the project's deployed app; present = listed in the Showcase. */
  showcaseUrl?: string;
}

export interface Config {
  roots: string[];
  scanDepth: number;
  pinned: string[];
  hidden: string[];
  /** Quota ids not monitored: `claude`, `codex`, `agy`, `claude:<model>`, `agy:<group>`. */
  quotaHidden: string[];
  tokens: Record<string, string>;
  projects: Record<string, ProjectConfig>;
}

export function configPath(): string {
  return process.env.PROJECT_HUB_CONFIG ?? path.join(os.homedir(), ".config", "project-hub", "config.json");
}

export function defaultConfig(): Config {
  return {
    roots: [],
    scanDepth: 2,
    pinned: [],
    hidden: [],
    quotaHidden: [],
    tokens: {},
    projects: {},
  };
}

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

async function writeAtomic(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function readConfig(): Promise<Config> {
  const file = configPath();
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    const cfg = defaultConfig();
    await writeAtomic(file, JSON.stringify(cfg, null, 2) + "\n");
    return cfg;
  }
  const parsed = JSON.parse(raw) as Partial<Config>;
  return { ...defaultConfig(), ...parsed };
}

export async function writeConfig(cfg: Config): Promise<void> {
  await writeAtomic(configPath(), JSON.stringify(cfg, null, 2) + "\n");
}

export async function updateConfig(fn: (cfg: Config) => void): Promise<Config> {
  const cfg = await readConfig();
  fn(cfg);
  await writeConfig(cfg);
  return cfg;
}

export function maskToken(token: string): string {
  if (token.length <= 8) return "…";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export interface SettingsView extends Omit<Config, "tokens"> {
  tokens: Record<string, string>;
}

export function settingsView(cfg: Config): SettingsView {
  return {
    ...cfg,
    tokens: Object.fromEntries(Object.entries(cfg.tokens).map(([h, t]) => [h, maskToken(t)])),
  };
}

/** Merge a PUT body into the config. A token equal to its mask keeps the stored one; empty removes it. */
export function applySettings(cfg: Config, body: Partial<Config>): Config {
  const next: Config = { ...cfg };
  if (Array.isArray(body.roots)) next.roots = body.roots.filter((r) => typeof r === "string" && r.trim());
  if (typeof body.scanDepth === "number" && body.scanDepth >= 1 && body.scanDepth <= 5) next.scanDepth = Math.floor(body.scanDepth);
  if (Array.isArray(body.pinned)) next.pinned = body.pinned.map(String);
  if (Array.isArray(body.hidden)) next.hidden = body.hidden.map(String);
  if (Array.isArray(body.quotaHidden)) next.quotaHidden = body.quotaHidden.filter((x) => typeof x === "string");
  if (body.projects && typeof body.projects === "object") next.projects = body.projects;
  if (body.tokens && typeof body.tokens === "object") {
    const tokens: Record<string, string> = {};
    for (const [host, value] of Object.entries(body.tokens)) {
      if (typeof value !== "string" || !value.trim()) continue;
      const existing = cfg.tokens[host];
      tokens[host] = existing !== undefined && value === maskToken(existing) ? existing : value.trim();
    }
    next.tokens = tokens;
  }
  return next;
}
