import { promises as fs } from "node:fs";
import path from "node:path";
import { discover } from "./discovery";
import { listRawWorktrees } from "./worktrees";

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function real(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

/** The project or worktree root that contains `target`, or null. */
export async function allowedRoot(target: string): Promise<string | null> {
  const t = await real(target);
  if (!t) return null;
  const projects = await discover();
  for (const p of projects) if (isInside(p.path, t)) return p.path;
  const lists = await Promise.all(projects.map((p) => listRawWorktrees(p.path)));
  for (const w of lists.flat()) if (isInside(w.path, t)) return w.path;
  return null;
}

export class OpenError extends Error {}

/**
 * `vscode://` URL for the browser to open: the hub may run in a container with no access to the
 * host's `code` binary, so the user's browser hands the URL to the host VS Code.
 */
export async function editorUrl(target: string, file?: string, line?: number): Promise<string> {
  if (!path.isAbsolute(target)) throw new OpenError("path must be absolute");
  const root = await allowedRoot(target);
  if (!root) throw new OpenError("path is not inside a known project or worktree");
  if (!file) return `vscode://file${encodeURI(target)}`;
  const abs = path.resolve(target, file);
  if (!isInside(root, abs)) throw new OpenError("file is outside the project");
  return `vscode://file${encodeURI(abs)}:${Number.isInteger(line) && (line as number) > 0 ? line : 1}`;
}
