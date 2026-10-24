import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface SubagentInfo {
  id: string;
  description: string;
  agentType: string | null;
  model: string | null;
  finished: boolean;
  lastActivity: string;
  active: boolean;
}

export interface SessionInfo {
  id: string;
  cwd: string;
  lastActivity: string;
  active: boolean;
  title: string;
  model: string | null;
  subagents: SubagentInfo[];
}

export const ACTIVE_MS = 5 * 60_000;
const HEAD_BYTES = 200 * 1024;
const TAIL_BYTES = 256 * 1024;

/** Claude Code's project dir name: every `/` and `.` in the absolute cwd becomes `-`. */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

/** A dir belongs to the project when it is the encoded path itself or an encoded descendant (worktrees). */
export function dirBelongsTo(dirName: string, projectPath: string): boolean {
  const enc = encodeCwd(projectPath);
  return dirName === enc || dirName.startsWith(`${enc}-`);
}

const WRAPPERS = /^\s*<(system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-caveat|user-prompt-submit-hook|task-notification)/;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
        const t = (part as { text?: unknown }).text;
        if (typeof t === "string" && !WRAPPERS.test(t)) return t;
      }
    }
  }
  return "";
}

/** Pasted blobs become "[pasted]", other XML-like tags are dropped, whitespace is collapsed. */
export function cleanTitle(t: string): string {
  return t
    .replace(/<pasted_content\b[^>]*>[\s\S]*?(<\/pasted_content>|$)/g, "[pasted]")
    .replace(/<\/?[a-zA-Z][\w:-]*(\s[^>]*)?>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** First real user prompt in a chunk of JSONL. */
export function extractTitle(head: string): string {
  for (const line of head.split("\n")) {
    if (!line.includes('"type":"user"')) continue;
    let o: { type?: string; isMeta?: boolean; isSidechain?: boolean; message?: { content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "user" || o.isMeta) continue;
    const t = textOf(o.message?.content).trim();
    if (t && !WRAPPERS.test(t)) {
      const c = cleanTitle(t);
      if (c) return c.slice(0, 120);
    }
  }
  return "";
}

/** Last assistant `message.model` in a chunk of JSONL. */
export function extractModel(tail: string): string | null {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i] ?? "";
    if (!ln.includes('"model"')) continue;
    try {
      const o = JSON.parse(ln) as { type?: string; message?: { model?: string } };
      const m = o.message?.model;
      if (o.type === "assistant" && m && m !== "<synthetic>") return m;
    } catch {
      /* partial line */
    }
  }
  return null;
}

async function readRange(file: string, where: "head" | "tail", bytes: number): Promise<string> {
  const fh = await fs.open(file, "r");
  try {
    const { size } = await fh.stat();
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, where === "head" ? 0 : size - len);
    return buf.toString("utf8");
  } finally {
    await fh.close();
  }
}

async function subagentsOf(sessionDir: string, now: number): Promise<SubagentInfo[]> {
  const dir = path.join(sessionDir, "subagents");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: SubagentInfo[] = [];
  for (const n of names.filter((x) => /^agent-.+\.jsonl$/.test(x))) {
    const base = n.replace(/\.jsonl$/, "");
    let meta: { agentType?: string; description?: string; model?: string; finished?: boolean } = {};
    try {
      meta = JSON.parse(await fs.readFile(path.join(dir, `${base}.meta.json`), "utf8"));
    } catch {
      /* meta is optional */
    }
    const st = await fs.stat(path.join(dir, n));
    let model = meta.model ?? null;
    if (!model) model = extractModel(await readRange(path.join(dir, n), "tail", TAIL_BYTES));
    const active = now - st.mtimeMs < ACTIVE_MS && !meta.finished;
    out.push({
      id: base.replace(/^agent-/, ""),
      description: meta.description ?? "",
      agentType: meta.agentType ?? null,
      model,
      finished: meta.finished ?? !active,
      lastActivity: new Date(st.mtimeMs).toISOString(),
      active,
    });
  }
  return out.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

export async function listSessions(projectPath: string, limit = 20, home = os.homedir(), now = Date.now()): Promise<SessionInfo[]> {
  const root = path.join(home, ".claude", "projects");
  let dirs: string[];
  try {
    dirs = (await fs.readdir(root)).filter((d) => dirBelongsTo(d, projectPath));
  } catch {
    return [];
  }
  const files: { dir: string; name: string; mtimeMs: number }[] = [];
  for (const d of dirs) {
    let names: string[];
    try {
      names = await fs.readdir(path.join(root, d));
    } catch {
      continue;
    }
    for (const n of names.filter((x) => x.endsWith(".jsonl"))) {
      try {
        files.push({ dir: d, name: n, mtimeMs: (await fs.stat(path.join(root, d, n))).mtimeMs });
      } catch {
        /* vanished */
      }
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return Promise.all(
    files.slice(0, limit).map(async (f) => {
      const file = path.join(root, f.dir, f.name);
      const id = f.name.replace(/\.jsonl$/, "");
      const [head, tail] = await Promise.all([readRange(file, "head", HEAD_BYTES), readRange(file, "tail", TAIL_BYTES)]);
      const cwdMatch = /"cwd":"([^"]+)"/.exec(head);
      return {
        id,
        cwd: cwdMatch?.[1] ?? projectPath,
        lastActivity: new Date(f.mtimeMs).toISOString(),
        active: now - f.mtimeMs < ACTIVE_MS,
        title: extractTitle(head),
        model: extractModel(tail),
        subagents: await subagentsOf(path.join(root, f.dir, id), now),
      };
    }),
  );
}
