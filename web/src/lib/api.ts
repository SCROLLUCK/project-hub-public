import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/* ---------- types (mirror server/src; adjust here if server/API.md differs) ---------- */

export interface Commit {
  hash: string;
  subject: string;
  date: string;
}

export interface Project {
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

/** Browser URL of the repo, derived from host + path of the remote. */
export const webUrl = (p: Pick<Project, "host" | "remotePath">) => (p.host && p.remotePath ? `https://${p.host}/${p.remotePath}` : null);

/** Browser URL of a branch on the remote (github /tree/, gitlab /-/tree/), or null. */
export function treeUrl(p: Pick<Project, "host" | "remotePath" | "provider">, branch: string | null): string | null {
  const base = webUrl(p);
  if (!base || !branch) return null;
  const b = branch.split("/").map(encodeURIComponent).join("/");
  if (p.provider === "github") return `${base}/tree/${b}`;
  if (p.provider === "gitlab") return `${base}/-/tree/${b}`;
  return null;
}

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

export type RunStatus = "success" | "failed" | "running" | "pending" | "canceled" | "skipped";

export interface PipelineRun {
  id: string;
  status: RunStatus;
  ref: string;
  sha: string;
  title: string;
  createdAt: string;
  durationSec: number | null;
  url: string;
}

export type PipelinesResponse =
  | { host: string; provider: string; runs: PipelineRun[]; error?: undefined }
  | { error: "no_token" | "not_found" | "unsupported" | "upstream"; host: string; runs?: undefined };

export interface BacklogItem {
  line: number;
  text: string;
  body: string;
  done: boolean | null;
  section: string;
}

export interface BacklogState {
  exists: boolean;
  raw: string;
  items: BacklogItem[];
  open: number;
  done: number;
}

export interface Settings {
  roots: string[];
  scanDepth: number;
  pinned: string[];
  hidden: string[];
  quotaHidden: string[];
  tokens: Record<string, string>;
  projects: Record<string, { devCommand?: string; devCwd?: string; showcaseUrl?: string }>;
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
  issues: string[];
  browser: { status: "none" | "open"; cdpUrl: string | null };
}

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
  embeddable?: boolean;
}

export interface QuotaWindow {
  pct: number;
  resetsAt: string | null;
  reset: boolean;
}
export interface QuotaSource {
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  updatedAt: string | null;
  plan?: string;
  source?: "live" | "file";
  models?: { name: string; sevenDay: QuotaWindow }[];
}
export type AgyGroup = { name: string } & QuotaSource;
export interface Quota {
  claude: QuotaSource | null;
  codex: QuotaSource | null;
  agy: AgyGroup[] | null;
  available: string[];
}

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

/* ---------- fetch ---------- */

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (init?.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const e = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
    const msg = e ? String(e) : res.statusText;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

/* ---------- hooks ---------- */

export const useProjects = () => useQuery({ queryKey: ["projects"], queryFn: () => api<Project[]>("/projects") });

export const useAllProjects = () => useQuery({ queryKey: ["projects", "all"], queryFn: () => api<Project[]>("/projects?all=1") });

export const useProject = (id: string | undefined) => {
  const list = useProjects();
  return { ...list, data: list.data?.find((p) => p.id === id) };
};

export const usePipelines = (id: string, enabled = true) =>
  useQuery({
    queryKey: ["pipelines", id],
    queryFn: () => api<PipelinesResponse>(`/projects/${encodeURIComponent(id)}/pipelines`),
    enabled,
    staleTime: 30_000,
  });

export const useWorktrees = (id: string) =>
  useQuery({ queryKey: ["worktrees", id], queryFn: () => api<Worktree[]>(`/projects/${encodeURIComponent(id)}/worktrees`) });

export const useWorktreeDiff = (id: string, wt: string | undefined) =>
  useQuery({
    queryKey: ["diff", id, wt],
    queryFn: () => api<WorktreeDiff>(`/projects/${encodeURIComponent(id)}/worktrees/diff?path=${encodeURIComponent(wt ?? "")}`),
    enabled: !!wt,
  });

export const usePreviews = () => useQuery({ queryKey: ["previews"], queryFn: () => api<PreviewInfo[]>("/previews"), refetchInterval: 5000 });

export const useBacklog = (id: string) =>
  useQuery({ queryKey: ["backlog", id], queryFn: () => api<BacklogState>(`/projects/${encodeURIComponent(id)}/backlog`) });

export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api<Settings>("/settings", { method: "PUT", json: patch }),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data);
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/** The server checks the path and returns a `vscode://` URL; the browser hands it to the host VS Code. */
export const openInEditor = async (path: string, file?: string, line?: number) => {
  const { url } = await api<{ ok: true; url: string }>("/open", { method: "POST", json: { path, file, line } });
  window.location.href = url;
};

export const useRunning = () => useQuery({ queryKey: ["running"], queryFn: () => api<RunningItem[]>("/running"), refetchInterval: 5000 });

export const useQuota = () => useQuery({ queryKey: ["quota"], queryFn: () => api<Quota>("/quota"), refetchInterval: 300_000, staleTime: 30_000, refetchOnWindowFocus: true });

export const useSessions = (id: string, interval = 15_000) =>
  useQuery({ queryKey: ["sessions", id], queryFn: () => api<SessionInfo[]>(`/projects/${encodeURIComponent(id)}/sessions`), refetchInterval: interval });

export const useVault = (id: string) =>
  useQuery({ queryKey: ["vault", id], queryFn: () => api<VaultInfo>(`/projects/${encodeURIComponent(id)}/vault`), staleTime: 60_000 });

export const useVaultNote = (id: string, notePath: string | null) =>
  useQuery({
    queryKey: ["vault-note", id, notePath],
    enabled: !!notePath,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/vault/note?path=${encodeURIComponent(notePath ?? "")}`);
      if (!res.ok) throw new ApiError(res.status, res.status === 404 ? "Note not found" : res.statusText, null);
      return res.text();
    },
  });

export function useStopPreview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/previews/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["previews"] });
      void qc.invalidateQueries({ queryKey: ["running"] });
    },
  });
}

export interface ShowcaseItem {
  projectId: string;
  name: string;
  url: string;
  up: boolean;
  embeddable: boolean;
}

export const useShowcase = () => useQuery({ queryKey: ["showcase"], queryFn: () => api<ShowcaseItem[]>("/showcase"), refetchInterval: 30_000 });
