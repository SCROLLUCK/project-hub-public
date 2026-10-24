import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface VaultNote {
  path: string;
  title: string;
  summary?: string;
}

export interface VaultInfo {
  exists: boolean;
  root: string | null;
  notes: VaultNote[];
}

function inside(child: string, root: string): boolean {
  return child === root || child.startsWith(root.endsWith("/") ? root : `${root}/`);
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function registered(home: string): Promise<string[]> {
  try {
    const j = JSON.parse(await fs.readFile(path.join(home, ".config", "obsidian", "obsidian.json"), "utf8")) as { vaults?: Record<string, { path?: string }> };
    return Object.values(j.vaults ?? {}).map((v) => v.path ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

/** Deepest vault equal to or inside the project: registered in obsidian.json, or a `.obsidian` dir at the root or in docs/. */
export async function findVaultRoot(projectPath: string, home = os.homedir()): Promise<string | null> {
  const candidates = new Set<string>();
  for (const v of await registered(home)) if (inside(path.resolve(v), projectPath) && (await isDir(v))) candidates.add(path.resolve(v));
  for (const sub of [".", "docs"]) {
    const d = path.join(projectPath, sub);
    if (await isDir(path.join(d, ".obsidian"))) candidates.add(path.resolve(d));
  }
  return [...candidates].sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Resolve a request path to an absolute `.md` file under the vault root, or null when it escapes or is not markdown. */
export function safeNotePath(root: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || path.isAbsolute(rel)) return null;
  const abs = path.resolve(root, rel);
  if (abs === root || !inside(abs, root)) return null;
  if (!abs.endsWith(".md")) return null;
  const segs = path.relative(root, abs).split(path.sep);
  if (segs.some((s) => s.startsWith("."))) return null;
  return abs;
}

export function parseFrontmatter(md: string): { data: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md);
  if (!m) return { data: {}, body: md };
  const data: Record<string, string> = {};
  for (const l of (m[1] ?? "").split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(l);
    if (kv && kv[1]) data[kv[1]] = (kv[2] ?? "").replace(/^["']|["']$/g, "").trim();
  }
  return { data, body: md.slice(m[0].length) };
}

export function titleOf(md: string, rel: string): string {
  const { body } = parseFrontmatter(md);
  const h = /^#\s+(.+)$/m.exec(body);
  return h?.[1] ? h[1].trim() : path.basename(rel, ".md");
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) await walk(root, f, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(path.relative(root, f).split(path.sep).join("/"));
  }
}

export async function readVault(projectPath: string, home = os.homedir()): Promise<VaultInfo> {
  const root = await findVaultRoot(projectPath, home);
  if (!root) return { exists: false, root: null, notes: [] };
  const rels: string[] = [];
  await walk(root, root, rels);
  rels.sort();
  const notes = await Promise.all(
    rels.map(async (rel) => {
      let head = "";
      try {
        const fh = await fs.open(path.join(root, rel), "r");
        try {
          const buf = Buffer.alloc(8192);
          const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
          head = buf.toString("utf8", 0, bytesRead);
        } finally {
          await fh.close();
        }
      } catch {
        /* unreadable */
      }
      const summary = parseFrontmatter(head).data.summary;
      return { path: rel, title: titleOf(head, rel), ...(summary ? { summary } : {}) };
    }),
  );
  return { exists: true, root, notes };
}

export async function readNote(projectPath: string, rel: string, home = os.homedir()): Promise<string | null> {
  const root = await findVaultRoot(projectPath, home);
  if (!root) return null;
  const abs = safeNotePath(root, rel);
  if (!abs) return null;
  try {
    const [realRoot, realAbs] = await Promise.all([fs.realpath(root), fs.realpath(abs)]);
    if (!inside(realAbs, realRoot)) return null;
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

/** Resolve `[[target]]` / `[[target|alias]]` (target may carry `#heading`) to a note path by basename, case-insensitive; path-style targets match by suffix. */
export function resolveWikilink(target: string, notePaths: string[]): string | null {
  const name = (target.split("|")[0] ?? "").split("#")[0]!.trim().replace(/\.md$/i, "").toLowerCase();
  if (!name) return null;
  const hit = notePaths.filter((p) => {
    const lower = p.replace(/\.md$/i, "").toLowerCase();
    return lower === name || lower.endsWith(`/${name}`);
  });
  return hit.sort((a, b) => a.length - b.length)[0] ?? null;
}
