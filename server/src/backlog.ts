import { promises as fs } from "node:fs";
import path from "node:path";

export interface BacklogItem {
  line: number; // 1-based
  text: string; // first line
  body: string; // first line plus indented continuation lines
  done: boolean | null; // null = plain bullet
  section: string;
}

export interface BacklogState {
  exists: boolean;
  raw: string;
  items: BacklogItem[];
  open: number;
  done: number;
}

export class BacklogMismatch extends Error {}

export const BACKLOG_REL = path.join("docs", "backlog.md");
export const TEMPLATE = "# Backlog\n\n## Next\n\n## Done\n";

const CHECK = /^(\s*)([-*+]|\d+[.)])\s+\[([ xX])\]\s+(.*)$/;
const BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(```|~~~)/;

function eolOf(raw: string): string {
  return raw.includes("\r\n") ? "\r\n" : "\n";
}

function splitLines(raw: string): string[] {
  return raw.split(/\r?\n/);
}

function frontmatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i]?.trim() === "---") return i + 1;
  return 0;
}

export function parseBacklog(raw: string): BacklogState {
  const lines = splitLines(raw);
  const items: BacklogItem[] = [];
  let section = "";
  let fenced = false;
  for (let i = frontmatterEnd(lines); i < lines.length; i++) {
    const l = lines[i] ?? "";
    const start = i;
    if (FENCE.test(l)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const h = /^##\s+(.*?)\s*#*\s*$/.exec(l);
    if (h && !l.startsWith("###")) {
      section = h[1] ?? "";
      continue;
    }
    const c = CHECK.exec(l);
    const b = c ? null : BULLET.exec(l);
    if (!c && !b) continue;
    const text = ((c ? c[4] : b?.[3]) ?? "").trim();
    const cont: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const n = lines[j] ?? "";
      if (!/^\s+\S/.test(n) || BULLET.test(n) || FENCE.test(n)) break;
      cont.push(n.trim());
    }
    i = j - 1;
    items.push({ line: start + 1, text, body: [text, ...cont].join("\n"), done: c ? c[3] !== " " : null, section });
  }
  const done = items.filter((x) => x.done === true).length;
  const open = items.filter((x) => x.done === false).length;
  return { exists: true, raw, items, open, done };
}

export function toggleItem(raw: string, line: number, done: boolean, expectedText: string): string {
  const lines = splitLines(raw);
  const l = lines[line - 1];
  const m = l === undefined ? null : CHECK.exec(l);
  if (!m || (m[4] ?? "").trim() !== expectedText.trim()) throw new BacklogMismatch(`line ${line} no longer matches`);
  lines[line - 1] = `${m[1]}${m[2]} [${done ? "x" : " "}] ${m[4]}`;
  return lines.join(eolOf(raw));
}

export function addItem(raw: string, section: string, text: string): string {
  const eol = eolOf(raw);
  const clean = text.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const item = `- [ ] ${clean}`;
  const lines = splitLines(raw);
  const hadTrailingNewline = lines.length > 0 && lines[lines.length - 1] === "";
  if (hadTrailingNewline) lines.pop();
  const start = frontmatterEnd(lines);
  let fenced = false;
  let idx = -1;
  for (let i = start; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (FENCE.test(l)) fenced = !fenced;
    if (!fenced && /^##\s/.test(l) && /^##\s+(.*?)\s*#*\s*$/.exec(l)?.[1] === section) {
      idx = i;
      break;
    }
  }
  if (idx === -1) {
    while (lines.length && lines[lines.length - 1]?.trim() === "") lines.pop();
    if (lines.length) lines.push("");
    lines.push(`## ${section}`, "", item);
  } else {
    let end = lines.length;
    fenced = false;
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i] ?? "";
      if (FENCE.test(l)) fenced = !fenced;
      if (!fenced && /^#{1,2}\s/.test(l)) {
        end = i;
        break;
      }
    }
    let last = end - 1;
    while (last > idx && lines[last]?.trim() === "") last--;
    if (last === idx) {
      lines.splice(idx + 1, 0, "", item);
    } else {
      lines.splice(last + 1, 0, item);
    }
  }
  return lines.join(eol) + eol;
}

export function backlogPath(projectPath: string): string {
  return path.join(projectPath, BACKLOG_REL);
}

export async function readBacklog(projectPath: string): Promise<BacklogState> {
  try {
    return parseBacklog(await fs.readFile(backlogPath(projectPath), "utf8"));
  } catch {
    return { exists: false, raw: "", items: [], open: 0, done: 0 };
  }
}

export async function writeBacklog(projectPath: string, raw: string): Promise<void> {
  const file = backlogPath(projectPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, raw);
  await fs.rename(tmp, file);
}
