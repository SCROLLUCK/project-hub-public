import { promises as fs } from "node:fs";
import path from "node:path";
import { expandHome, readConfig } from "./config";

export interface Found {
  id: string;
  name: string;
  path: string;
}

const SKIP = new Set(["node_modules", "dist", "build", "vendor", ".cache"]);

async function scan(dir: string, depth: number, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  if (entries.some((e) => e.name === ".git" && e.isDirectory())) {
    out.push(dir);
    return;
  }
  if (depth <= 0) return;
  await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
      .map((e) => scan(path.join(dir, e.name), depth - 1, out)),
  );
}

/** Assign ids: folder name, or `parent-name` on collision. */
export function assignIds(paths: string[]): Found[] {
  const sorted = [...paths].sort();
  const count = new Map<string, number>();
  for (const p of sorted) count.set(path.basename(p), (count.get(path.basename(p)) ?? 0) + 1);
  return sorted.map((p) => {
    const name = path.basename(p);
    const id = (count.get(name) ?? 0) > 1 ? `${path.basename(path.dirname(p))}-${name}` : name;
    return { id, name, path: p };
  });
}

let cache: { at: number; value: Found[] } | null = null;

export async function discover(force = false): Promise<Found[]> {
  if (!force && cache && Date.now() - cache.at < 5000) return cache.value;
  const cfg = await readConfig();
  const found: string[] = [];
  await Promise.all(cfg.roots.map((r) => scan(path.resolve(expandHome(r)), cfg.scanDepth, found)));
  const value = assignIds([...new Set(found)]);
  cache = { at: Date.now(), value };
  return value;
}
