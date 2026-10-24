import { execFile } from "node:child_process";

export function git(cwd: string, args: string[], opts: { maxBuffer?: number; timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024, timeout: opts.timeout ?? 15000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/** Like git() but resolves to null on failure. */
export async function gitOrNull(cwd: string, args: string[], opts?: { maxBuffer?: number }): Promise<string | null> {
  try {
    return (await git(cwd, args, opts)).trimEnd();
  } catch {
    return null;
  }
}

export interface Remote {
  provider: "github" | "gitlab" | "other";
  host: string;
  projectPath: string;
}

export function parseRemote(url: string | null | undefined): Remote | null {
  if (!url) return null;
  const u = url.trim();
  let host: string | undefined;
  let rest: string | undefined;
  let m = /^[\w.-]+@([^:/\s]+):(.+)$/.exec(u); // scp-like: git@host:o/r.git
  if (m) {
    host = m[1];
    rest = m[2];
  } else if ((m = /^(?:ssh|https?|git):\/\/(?:[^@/]+@)?([^:/\s]+)(?::\d+)?\/(.+)$/.exec(u))) {
    host = m[1];
    rest = m[2];
  }
  if (!host || !rest) return null;
  const projectPath = rest.replace(/\/+$/, "").replace(/\.git$/, "").replace(/^\/+/, "");
  const h = host.toLowerCase();
  const provider = h === "github.com" ? "github" : h === "gitlab.com" || h.startsWith("gitlab.") || h.startsWith("git.") ? "gitlab" : "other";
  return { provider, host: h, projectPath };
}

export interface Commit {
  hash: string;
  subject: string;
  date: string;
}

const SEP = "\x1f";
export const COMMIT_FORMAT = `%H${SEP}%s${SEP}%cI`;

export function parseCommits(out: string): Commit[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash = "", subject = "", date = ""] = l.split(SEP);
      return { hash, subject, date };
    });
}

export async function defaultBranch(repo: string): Promise<string> {
  const head = await gitOrNull(repo, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head) return head.replace(/^origin\//, "");
  for (const b of ["master", "main"]) {
    if ((await gitOrNull(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`])) !== null) return b;
  }
  return "master";
}

/** Best ref to compare against: origin/<default> when it exists, else the local branch. */
export async function defaultRef(repo: string, branch: string): Promise<string> {
  const remote = `origin/${branch}`;
  return (await gitOrNull(repo, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}`])) !== null ? remote : branch;
}
