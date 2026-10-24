import { promises as fs } from "node:fs";
import path from "node:path";
import { readBacklog } from "./backlog";
import { Config } from "./config";
import { Found, discover } from "./discovery";
import { COMMIT_FORMAT, Commit, Remote, defaultBranch, gitOrNull, parseCommits, parseRemote } from "./git";
import { listRawWorktrees } from "./worktrees";

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  remoteUrl: string | null;
  provider: "github" | "gitlab" | "other" | null;
  host: string | null;
  remotePath: string | null;
  defaultBranch: string;
  branch: string | null;
  dirty: number;
  lastCommit: Commit | null;
  ahead: number;
  behind: number;
  worktreeCount: number;
  stack: string[];
  backlog: { open: number; done: number } | null;
  pinned: boolean;
  hidden: boolean;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function stackHints(dir: string): Promise<string[]> {
  const checks: [string, string[]][] = [
    ["node", ["package.json", "frontend/package.json", "web/package.json", "client/package.json"]],
    ["django", ["manage.py", "backend/manage.py"]],
    ["docker", ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml", "Dockerfile"]],
    ["python", ["pyproject.toml", "requirements.txt"]],
  ];
  const out: string[] = [];
  for (const [name, files] of checks) {
    for (const f of files) {
      if (await exists(path.join(dir, f))) {
        out.push(name);
        break;
      }
    }
  }
  return out;
}

export async function remoteOf(repo: string): Promise<{ url: string | null; remote: Remote | null }> {
  let url = await gitOrNull(repo, ["remote", "get-url", "origin"]);
  if (!url) {
    const first = (await gitOrNull(repo, ["remote"]))?.split("\n")[0];
    if (first) url = await gitOrNull(repo, ["remote", "get-url", first]);
  }
  return { url: url || null, remote: parseRemote(url) };
}

export async function projectInfo(f: Found, cfg: Config): Promise<ProjectInfo> {
  const [branch, status, last, counts, remote, def, worktrees, stack, backlog] = await Promise.all([
    gitOrNull(f.path, ["branch", "--show-current"]),
    gitOrNull(f.path, ["status", "--porcelain"]),
    gitOrNull(f.path, ["log", "-1", `--format=${COMMIT_FORMAT}`]),
    gitOrNull(f.path, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]),
    remoteOf(f.path),
    defaultBranch(f.path),
    listRawWorktrees(f.path),
    stackHints(f.path),
    readBacklog(f.path),
  ]);
  const [behind = 0, ahead = 0] = (counts ?? "0\t0").split(/\s+/).map(Number);
  return {
    id: f.id,
    name: f.name,
    path: f.path,
    remoteUrl: remote.url,
    provider: remote.remote?.provider ?? null,
    host: remote.remote?.host ?? null,
    remotePath: remote.remote?.projectPath ?? null,
    defaultBranch: def,
    branch: branch || null,
    dirty: status ? status.split("\n").filter(Boolean).length : 0,
    lastCommit: last ? (parseCommits(last)[0] ?? null) : null,
    ahead,
    behind,
    worktreeCount: worktrees.length,
    stack,
    backlog: backlog.exists ? { open: backlog.open, done: backlog.done } : null,
    pinned: cfg.pinned.includes(f.id),
    hidden: cfg.hidden.includes(f.id),
  };
}

export async function findProject(id: string): Promise<Found | undefined> {
  return (await discover()).find((p) => p.id === id);
}

export async function allProjects(cfg: Config, includeHidden: boolean): Promise<ProjectInfo[]> {
  const found = (await discover()).filter((f) => includeHidden || !cfg.hidden.includes(f.id));
  const list = await Promise.all(found.map((f) => projectInfo(f, cfg)));
  return list.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastCommit?.date ?? "").localeCompare(a.lastCommit?.date ?? ""));
}
