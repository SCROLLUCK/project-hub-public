import { ChildProcess, spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { BrowserError, helperCall } from "./browser";
import { ProjectConfig } from "./config";

export interface DevCommand {
  /** Shell command, `{port}`/`{worktree}`/`{cwd}`/`{main}` already substituted. */
  command: string;
  /** Absolute working directory. */
  cwd: string;
  /** True when node_modules is missing and `npm install` must run first. */
  needsInstall: boolean;
  /** Auto-detected command in a linked git worktree with node_modules missing: never install there. */
  installBlocked?: boolean;
  /** devCommand is set and node_modules is missing: the command owns its dependencies. */
  installSkipped?: boolean;
}

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function readPackage(dir: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as PackageJson;
  } catch {
    return null;
  }
}

function isLinkedWorktree(dir: string): boolean {
  try {
    return statSync(path.join(dir, ".git")).isFile();
  } catch {
    return false;
  }
}

/** Main checkout path for a worktree (itself when `.git` is a directory or unreadable). */
export function mainCheckout(worktree: string): string {
  const gitFile = path.join(worktree, ".git");
  try {
    if (!statSync(gitFile).isFile()) return worktree;
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitFile, "utf8"));
    if (!m) return worktree;
    const gitdir = path.resolve(worktree, m[1]!.trim());
    let common = path.resolve(gitdir, "..", "..");
    try {
      common = path.resolve(gitdir, readFileSync(path.join(gitdir, "commondir"), "utf8").trim());
    } catch {
      /* no commondir: gitdir/../.. */
    }
    return path.dirname(common);
  } catch {
    return worktree;
  }
}

export function detectDevCommand(worktree: string, cfg: ProjectConfig | undefined, port: number): DevCommand | null {
  if (cfg?.devCommand) {
    const wt = path.resolve(worktree);
    const cwd = path.resolve(wt, cfg.devCwd ?? ".");
    const command = cfg.devCommand
      .replaceAll("{port}", String(port))
      .replaceAll("{worktree}", wt)
      .replaceAll("{cwd}", cwd)
      .replaceAll("{main}", mainCheckout(wt));
    return { command, cwd, needsInstall: false, installSkipped: needsInstall(cwd) };
  }
  for (const sub of [".", "frontend", "web", "client"]) {
    const cwd = path.resolve(worktree, sub);
    const pkg = readPackage(cwd);
    const script = pkg?.scripts?.dev;
    if (!script) continue;
    const isVite = /\bvite\b/.test(script) || !!pkg?.devDependencies?.vite || !!pkg?.dependencies?.vite;
    const command = isVite ? `npm run dev -- --port ${port} --strictPort --host 127.0.0.1` : "npm run dev";
    const missing = needsInstall(cwd);
    const blocked = missing && isLinkedWorktree(worktree);
    return { command, cwd, needsInstall: missing && !blocked, ...(blocked ? { installBlocked: true } : {}) };
  }
  return null;
}

function needsInstall(cwd: string): boolean {
  return !existsSync(path.join(cwd, "node_modules"));
}

function containerName(id: string): string {
  return `project-hub-${id}`;
}

function removeContainer(id: string): void {
  try {
    spawn("docker", ["rm", "-f", containerName(id)], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    /* best effort */
  }
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });
}

export type PreviewStatus = "installing" | "starting" | "running" | "stopped" | "failed";

export interface PreviewInfo {
  id: string;
  projectId: string;
  worktreePath: string;
  port: number;
  url: string;
  status: PreviewStatus;
  command: string;
  cwd: string;
  /** Missing dependencies/tools seen in the dev server output. Fix them in the project, not in the Hub. */
  issues: string[];
  /** Agent browser opened through this preview (one Chrome per project, shared by its previews). */
  browser: { status: "none" | "open"; cdpUrl: string | null };
}

const LOG_CAP = 1000;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\S*/;
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

const ISSUES_CAP = 20;
const VITE_RESOLVE_RE = /Failed to resolve import "([^"]+)"/;
const VITE_SCAN_HEAD = "The following dependencies are imported but could not be resolved:";
const VITE_SCAN_ITEM_RE = /^\s+(\S+) \(imported by /;
const NODE_MODULE_RE = /Cannot find (?:module|package) '([^']+)'/;
const SH_NOT_FOUND_RE = /^\w*sh: (?:(?:line )?\d+: )?(\S+): not found\s*$/;
const CMD_NOT_FOUND_RE = /(\S+): command not found\s*$/;

export interface IssueState {
  issues: string[];
  /** True right after the vite dep-scan header: indented lines that follow are packages. */
  scanning?: boolean;
}

/** Parses one log line for missing dependencies/tools and records them in `state.issues`. Returns true when a new issue was added. */
export function parseIssues(line: string, state: IssueState): boolean {
  const add = (issue: string): boolean => {
    if (state.issues.includes(issue) || state.issues.length >= ISSUES_CAP) return false;
    state.issues.push(issue);
    return true;
  };
  const dep = (name: string): boolean => (name.startsWith(".") || name.startsWith("/") ? false : add(`missing dependency: ${name}`));
  if (line.includes(VITE_SCAN_HEAD)) {
    state.scanning = true;
    return false;
  }
  if (state.scanning) {
    if (line.trim() === "") return false;
    const m = VITE_SCAN_ITEM_RE.exec(line);
    if (m) return dep(m[1]!);
    state.scanning = false;
  }
  let m = VITE_RESOLVE_RE.exec(line);
  if (m) return dep(m[1]!);
  m = NODE_MODULE_RE.exec(line);
  if (m) return dep(m[1]!);
  m = SH_NOT_FOUND_RE.exec(line) ?? CMD_NOT_FOUND_RE.exec(line);
  if (m) return add(`missing tool: ${m[1]!}`);
  return false;
}

class Preview extends EventEmitter {
  logs: string[] = [];
  child: ChildProcess | null = null;
  private partial = "";
  private state: IssueState;
  constructor(public info: PreviewInfo) {
    super();
    this.state = { issues: info.issues };
  }
  addIssue(issue: string): void {
    if (!this.info.issues.includes(issue) && this.info.issues.length < ISSUES_CAP) {
      this.info.issues.push(issue);
      this.emit("issues", this.info.issues);
    }
  }
  log(line: string): void {
    this.logs.push(line);
    if (this.logs.length > LOG_CAP) this.logs.shift();
    this.emit("log", line);
  }
  feed(chunk: Buffer): void {
    const text = this.partial + chunk.toString("utf8").replace(ANSI, "");
    const parts = text.split(/\r?\n/);
    this.partial = parts.pop() ?? "";
    for (const l of parts) {
      this.log(l);
      if (parseIssues(l, this.state)) this.emit("issues", this.info.issues);
      const m = URL_RE.exec(l);
      if (m) this.info.url = m[0].replace(/[)\]'",.]+$/, "");
    }
  }
  setStatus(s: PreviewStatus): void {
    this.info.status = s;
    this.emit("status", s);
  }
}

const previews = new Map<string, Preview>();
let counter = 0;

export async function startPreview(projectId: string, worktreePath: string, cfg: ProjectConfig | undefined): Promise<PreviewInfo | { error: "no_dev_command" }> {
  const port = await freePort();
  const dev = detectDevCommand(worktreePath, cfg, port);
  if (!dev) return { error: "no_dev_command" };
  const full = dev.needsInstall ? `npm install && ${dev.command}` : dev.command;
  const id = `pv${++counter}-${Date.now().toString(36)}`;
  const p = new Preview({
    id,
    projectId,
    worktreePath,
    port,
    url: `http://127.0.0.1:${port}`,
    status: dev.installBlocked ? "failed" : dev.needsInstall ? "installing" : "starting",
    command: dev.command,
    cwd: dev.cwd,
    issues: [],
    browser: { status: "none", cdpUrl: null },
  });
  previews.set(id, p);
  p.log(`$ ${full}   (cwd ${dev.cwd})`);
  if (dev.installBlocked) {
    p.log(
      "node_modules missing in a worktree; install skipped. Set devCommand (e.g. {main}/scripts/...) to run with the main checkout's deps",
    );
    p.addIssue("node_modules missing in worktree: set devCommand");
    return p.info;
  }
  if (dev.installSkipped) p.log("install skipped (devCommand owns dependencies)");
  const child = spawn("sh", ["-c", full], {
    cwd: dev.cwd,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), BROWSER: "none", FORCE_COLOR: "0", HUB_PREVIEW_CONTAINER: containerName(id) },
  });
  p.child = child;
  child.stdout?.on("data", (c: Buffer) => p.feed(c));
  child.stderr?.on("data", (c: Buffer) => p.feed(c));
  child.on("error", (e) => {
    p.log(`spawn error: ${e.message}`);
    p.setStatus("failed");
  });
  child.on("exit", (code, sig) => {
    p.log(`process exited (${sig ?? code})`);
    if (p.info.status !== "stopped") p.setStatus(code === 0 ? "stopped" : "failed");
  });
  void waitReady(p);
  return p.info;
}

async function waitReady(p: Preview): Promise<void> {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline && p.info.status !== "stopped" && p.info.status !== "failed") {
    const port = Number(new URL(p.info.url).port) || p.info.port;
    if (await canConnect(port)) {
      p.setStatus("running");
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

export function listPreviews(): PreviewInfo[] {
  return [...previews.values()].map((p) => p.info);
}

export function getPreview(id: string): Preview | undefined {
  return previews.get(id);
}

function killGroup(p: Preview, signal: NodeJS.Signals): void {
  const pid = p.child?.pid;
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    /* already gone */
  }
}

/** Opens (or reuses) the project's agent browser on this preview's URL. Throws `BrowserError`. */
export async function openBrowser(id: string): Promise<{ cdpUrl: string; reused: boolean }> {
  const p = previews.get(id);
  if (!p) throw new BrowserError("preview_not_found");
  if (p.info.status !== "running") throw new BrowserError("preview_not_running");
  const r = await helperCall({ op: "launch", projectId: p.info.projectId, url: p.info.url });
  if (!r.ok || !r.cdpUrl) throw new BrowserError(r.ok ? "browser_helper_bad_reply" : r.error);
  p.info.browser = { status: "open", cdpUrl: r.cdpUrl };
  return { cdpUrl: r.cdpUrl, reused: !!r.reused };
}

function clearBrowser(projectId: string): void {
  for (const q of previews.values()) if (q.info.projectId === projectId) q.info.browser = { status: "none", cdpUrl: null };
}

/** Closes the project's agent browser and marks every preview of the project as having none. Throws `BrowserError`. */
export async function closeBrowser(id: string): Promise<void> {
  const p = previews.get(id);
  if (!p) throw new BrowserError("preview_not_found");
  const r = await helperCall({ op: "close", projectId: p.info.projectId });
  if (!r.ok) throw new BrowserError(r.error);
  clearBrowser(p.info.projectId);
}

export async function stopPreview(id: string): Promise<boolean> {
  const p = previews.get(id);
  if (!p) return false;
  const hadBrowser = p.info.browser.status === "open";
  p.setStatus("stopped");
  killGroup(p, "SIGTERM");
  const child = p.child;
  if (child && child.exitCode === null) {
    await Promise.race([new Promise((r) => child.once("exit", r)), new Promise((r) => setTimeout(r, 3000))]);
    killGroup(p, "SIGKILL");
  }
  removeContainer(id);
  previews.delete(id);
  const shared = [...previews.values()].some(
    (q) => q.info.projectId === p.info.projectId && q.info.status === "running" && q.info.browser.status === "open",
  );
  if (hadBrowser && !shared) {
    try {
      await helperCall({ op: "close", projectId: p.info.projectId });
    } catch (e) {
      console.warn(`browser close failed for ${p.info.projectId}: ${(e as Error).message}`);
    }
    clearBrowser(p.info.projectId);
  }
  return true;
}

export function killAllPreviews(): void {
  for (const p of previews.values()) {
    killGroup(p, "SIGKILL");
    try {
      spawnSync("docker", ["rm", "-f", containerName(p.info.id)], { stdio: "ignore", timeout: 3000 });
    } catch {
      /* best effort */
    }
  }
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    killAllPreviews();
    process.exit(0);
  });
}
process.on("exit", killAllPreviews);
