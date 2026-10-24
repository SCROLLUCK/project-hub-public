import { COMMIT_FORMAT, Commit, defaultBranch, defaultRef, git, gitOrNull, parseCommits } from "./git";

export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
  isMain: boolean;
  dirty: number;
  ahead: number;
  behind: number;
  commitsAhead: Commit[];
}

interface RawWorktree {
  path: string;
  head: string;
  branch: string | null;
}

export function parseWorktreeList(out: string): RawWorktree[] {
  return out
    .split(/\n\n+/)
    .map((block) => {
      const w: RawWorktree = { path: "", head: "", branch: null };
      for (const line of block.split("\n")) {
        if (line.startsWith("worktree ")) w.path = line.slice(9);
        else if (line.startsWith("HEAD ")) w.head = line.slice(5);
        else if (line.startsWith("branch ")) w.branch = line.slice(7).replace(/^refs\/heads\//, "");
      }
      return w;
    })
    .filter((w) => w.path);
}

export async function listRawWorktrees(repo: string): Promise<RawWorktree[]> {
  const out = await gitOrNull(repo, ["worktree", "list", "--porcelain"]);
  return out ? parseWorktreeList(out) : [];
}

export async function listWorktrees(repo: string): Promise<Worktree[]> {
  const raws = await listRawWorktrees(repo);
  const base = await defaultRef(repo, await defaultBranch(repo));
  return Promise.all(
    raws.map(async (w, i): Promise<Worktree> => {
      const [status, counts, log] = await Promise.all([
        gitOrNull(w.path, ["status", "--porcelain"]),
        gitOrNull(w.path, ["rev-list", "--left-right", "--count", `${base}...HEAD`]),
        gitOrNull(w.path, ["log", `${base}..HEAD`, "-n", "50", `--format=${COMMIT_FORMAT}`]),
      ]);
      const [behind = 0, ahead = 0] = (counts ?? "0\t0").split(/\s+/).map(Number);
      return {
        path: w.path,
        branch: w.branch,
        head: w.head,
        isMain: i === 0,
        dirty: status ? status.split("\n").filter(Boolean).length : 0,
        ahead,
        behind,
        commitsAhead: log ? parseCommits(log) : [],
      };
    }),
  );
}

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  firstChangedLine: number;
}

export interface WorktreeDiff {
  commits: Commit[];
  files: DiffFile[];
  patch: string;
  truncated: boolean;
}

export const PATCH_CAP = 200 * 1024;

/** First new-side line number of the first hunk, per file. */
export function firstChangedLines(patch: string): Map<string, number> {
  const res = new Map<string, number>();
  let file: string | null = null;
  for (const line of patch.split("\n")) {
    const f = /^diff --git a\/.* b\/(.*)$/.exec(line);
    if (f) {
      file = f[1] ?? null;
      continue;
    }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
    if (h && file && !res.has(file)) res.set(file, Math.max(1, Number(h[1])));
  }
  return res;
}

/** Diff of the working tree against the merge-base with the default branch. */
export async function worktreeDiff(repo: string, wtPath: string): Promise<WorktreeDiff> {
  const base = await defaultRef(repo, await defaultBranch(repo));
  const mb = (await gitOrNull(wtPath, ["merge-base", base, "HEAD"])) ?? base;
  const [numstat, patchFull, log] = await Promise.all([
    git(wtPath, ["diff", "--numstat", "--no-renames", mb]),
    git(wtPath, ["diff", "--no-color", "--no-renames", mb], { maxBuffer: 256 * 1024 * 1024 }),
    gitOrNull(wtPath, ["log", `${base}..HEAD`, "-n", "100", `--format=${COMMIT_FORMAT}`]),
  ]);
  const first = firstChangedLines(patchFull);
  const files = numstat
    .split("\n")
    .filter(Boolean)
    .map((l): DiffFile => {
      const [a = "0", d = "0", ...rest] = l.split("\t");
      const p = rest.join("\t");
      return { path: p, additions: Number(a) || 0, deletions: Number(d) || 0, firstChangedLine: first.get(p) ?? 1 };
    });
  const truncated = Buffer.byteLength(patchFull) > PATCH_CAP;
  return {
    commits: log ? parseCommits(log) : [],
    files,
    patch: truncated ? Buffer.from(patchFull).subarray(0, PATCH_CAP).toString("utf8") : patchFull,
    truncated,
  };
}
