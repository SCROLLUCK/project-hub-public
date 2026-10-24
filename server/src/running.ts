import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { discover } from "./discovery";
import { gitOrNull } from "./git";
import { listPreviews } from "./previews";

const run = promisify(execFile);

export interface RunningItem {
  kind: "hub" | "process" | "docker";
  url: string;
  port: number;
  projectId?: string;
  worktreePath?: string;
  branch?: string | null;
  label: string;
  pid?: number;
  container?: string;
  previewId?: string;
  /** false when the page forbids framing (X-Frame-Options / CSP frame-ancestors). */
  embeddable?: boolean;
}

export interface ProjectPath {
  id: string;
  path: string;
}

export interface Match {
  projectId: string;
  worktreePath: string;
}

function inside(dir: string, root: string): boolean {
  return dir === root || dir.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/** Longest project path that contains `cwd`; a `.claude/worktrees/<name>` child resolves to that worktree. */
export function matchProject(cwd: string, projects: ProjectPath[]): Match | null {
  let best: ProjectPath | null = null;
  for (const p of projects) {
    if (inside(cwd, p.path) && (!best || p.path.length > best.path.length)) best = p;
  }
  if (!best) return null;
  const rel = path.relative(best.path, cwd).split(path.sep);
  const worktreePath = rel[0] === ".claude" && rel[1] === "worktrees" && rel[2] ? path.join(best.path, ".claude", "worktrees", rel[2]) : best.path;
  return { projectId: best.id, worktreePath };
}

export interface Listener {
  port: number;
  pid: number;
  name: string;
}

const LOCAL = new Set(["127.0.0.1", "0.0.0.0", "::", "[::]", "[::1]", "::1", "*"]);

/** Parse `ss -ltnpH` output; only listeners on loopback/any address that carry a `users:` field. */
export function parseSs(out: string): Listener[] {
  const res: Listener[] = [];
  for (const line of out.split("\n")) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    const local = cols[3] ?? "";
    const i = local.lastIndexOf(":");
    if (i < 0) continue;
    if (!LOCAL.has(local.slice(0, i))) continue;
    const port = Number(local.slice(i + 1));
    const m = /\("([^"]*)",pid=(\d+)/.exec(line);
    if (!port || !m) continue;
    res.push({ port, pid: Number(m[2]), name: m[1] ?? "" });
  }
  return res;
}

export interface DockerContainer {
  name: string;
  service: string | null;
  workingDir: string | null;
  ports: number[];
}

/** Parse the `docker ps --format json` stream (one object per line). */
export function parseDocker(out: string): DockerContainer[] {
  const res: DockerContainer[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    let o: { Names?: string; Ports?: string; Labels?: string };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const wd = /(?:^|,)com\.docker\.compose\.project\.working_dir=([^,]*)/.exec(o.Labels ?? "");
    const ports = new Set<number>();
    for (const m of (o.Ports ?? "").matchAll(/(?:0\.0\.0\.0|127\.0\.0\.1|\[?::\]?):(\d+)->/g)) ports.add(Number(m[1]));
    const svc = /(?:^|,)com\.docker\.compose\.service=([^,]*)/.exec(o.Labels ?? "");
    res.push({ name: o.Names ?? "", service: svc?.[1] ?? null, workingDir: wd?.[1] ?? null, ports: [...ports] });
  }
  return res;
}

function hubPorts(): Set<number> {
  const s = new Set<number>([4310, 4311]);
  for (const v of [process.env.PROJECT_HUB_PORT, process.env.WEB_PORT]) if (v && Number(v)) s.add(Number(v));
  return s;
}

async function safe(cmd: string, args: string[]): Promise<string> {
  try {
    return (await run(cmd, args, { timeout: 4000, maxBuffer: 8 * 1024 * 1024 })).stdout;
  } catch {
    return "";
  }
}

/** Editor internals (VS Code, language servers) listen on local ports but are not previews. */
export const EDITOR_PROCS = new Set(["code", "code-insiders", "cursor", "windsurf", "language_server", "electron"]);

export interface ProbeResult {
  status: number;
  contentType: string | null;
  xFrameOptions?: string | null;
  csp?: string | null;
}
export type Probe = (url: string) => Promise<ProbeResult | null>;

/** GET / following redirects; null when nothing answers within `timeoutMs`. */
export const makeProbe = (timeoutMs: number): Probe => async (url) => {
  try {
    const r = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    void r.body?.cancel();
    return {
      status: r.status,
      contentType: r.headers.get("content-type"),
      xFrameOptions: r.headers.get("x-frame-options"),
      csp: r.headers.get("content-security-policy"),
    };
  } catch {
    return null;
  }
};

export const httpProbe: Probe = makeProbe(700);

/** Framing is blocked by X-Frame-Options, or by a CSP frame-ancestors that is not `*`. */
export function isEmbeddable(r: ProbeResult): boolean {
  if (r.xFrameOptions) return false;
  const fa = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(r.csp ?? "");
  if (!fa) return true;
  return /(^|\s)\*(\s|$)/.test(fa[1] ?? "");
}

/**
 * A non-hub listener is a preview only if it is not editor internals and `GET /`
 * ends 2xx/3xx with HTML. Returns null when dropped, else whether it can be framed.
 */
export async function probePreview(procName: string | null, url: string, probe: Probe = httpProbe): Promise<{ embeddable: boolean } | null> {
  if (procName && EDITOR_PROCS.has(procName)) return null;
  const r = await probe(url);
  if (!r || r.status < 200 || r.status >= 400) return null;
  if (!r.contentType || !/text\/html/i.test(r.contentType)) return null;
  return { embeddable: isEmbeddable(r) };
}

export async function listRunning(): Promise<RunningItem[]> {
  const projects = await discover();
  const items: RunningItem[] = [];
  const seen = new Set<number>(hubPorts());

  for (const pv of listPreviews()) {
    if (pv.status === "stopped" || pv.status === "failed") continue;
    const port = Number(new URL(pv.url).port) || pv.port;
    seen.add(port);
    seen.add(pv.port);
    items.push({ kind: "hub", url: pv.url, port, projectId: pv.projectId, worktreePath: pv.worktreePath, label: `preview (${pv.status})`, previewId: pv.id });
  }

  const [ss, docker] = await Promise.all([safe("ss", ["-ltnpH"]), safe("docker", ["ps", "--format", "json"])]);

  for (const l of parseSs(ss)) {
    if (seen.has(l.port) || l.pid === process.pid || EDITOR_PROCS.has(l.name)) continue;
    let cwd: string;
    try {
      cwd = await fs.readlink(`/proc/${l.pid}/cwd`);
    } catch {
      continue;
    }
    const m = matchProject(cwd, projects);
    if (!m) continue;
    seen.add(l.port);
    items.push({ kind: "process", url: `http://127.0.0.1:${l.port}`, port: l.port, projectId: m.projectId, worktreePath: m.worktreePath, label: l.name, pid: l.pid });
  }

  for (const c of parseDocker(docker)) {
    const m = c.workingDir ? matchProject(c.workingDir, projects) : null;
    if (!m) continue;
    for (const port of c.ports) {
      if (seen.has(port)) continue;
      seen.add(port);
      items.push({ kind: "docker", url: `http://127.0.0.1:${port}`, port, projectId: m.projectId, worktreePath: m.worktreePath, label: c.service ?? c.name, container: c.name });
    }
  }

  const probes = await Promise.all(items.map((i) => (i.kind === "hub" ? { embeddable: true } : probePreview(i.kind === "process" ? i.label : null, i.url))));
  const kept = items.filter((i, n) => {
    const pr = probes[n];
    if (pr) i.embeddable = pr.embeddable;
    return !!pr;
  });
  items.splice(0, items.length, ...kept);

  await Promise.all(
    items.map(async (i) => {
      if (i.worktreePath) i.branch = (await gitOrNull(i.worktreePath, ["branch", "--show-current"])) || null;
    }),
  );
  return items.sort((a, b) => (a.projectId ?? "").localeCompare(b.projectId ?? "") || a.port - b.port);
}
