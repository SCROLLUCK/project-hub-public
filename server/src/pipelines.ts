import { execFile } from "node:child_process";
import { Config } from "./config";
import { Remote } from "./git";

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

export type PipelinesResult =
  | { host: string; provider: string; runs: PipelineRun[] }
  | { error: "no_token" | "not_found" | "unsupported" | "upstream"; host: string };

let ghToken: { at: number; value: string | null } | null = null;

async function githubToken(): Promise<string | null> {
  if (ghToken && Date.now() - ghToken.at < 5 * 60_000) return ghToken.value;
  const value = await new Promise<string | null>((resolve) => {
    execFile("gh", ["auth", "token"], { timeout: 5000 }, (err, out) => resolve(err ? null : out.trim() || null));
  });
  const v = value ?? process.env.GITHUB_TOKEN ?? null;
  ghToken = { at: Date.now(), value: v };
  return v;
}

export function githubStatus(status: string, conclusion: string | null): RunStatus {
  if (status !== "completed") return status === "in_progress" ? "running" : "pending";
  switch (conclusion) {
    case "success":
      return "success";
    case "cancelled":
      return "canceled";
    case "skipped":
    case "neutral":
      return "skipped";
    default:
      return "failed";
  }
}

export function gitlabStatus(s: string): RunStatus {
  switch (s) {
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "running":
      return "running";
    case "canceled":
    case "canceling":
      return "canceled";
    case "skipped":
      return "skipped";
    default:
      return "pending";
  }
}

const cache = new Map<string, { at: number; value: PipelinesResult }>();

async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers: { "user-agent": "project-hub", ...headers }, signal: AbortSignal.timeout(10000) });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, body };
}

function httpError(status: number, host: string): PipelinesResult {
  if (status === 401) return { error: "no_token", host };
  if (status === 404) return { error: "not_found", host };
  return { error: "upstream", host };
}

async function fetchRuns(remote: Remote, cfg: Config): Promise<PipelinesResult> {
  const { host, provider, projectPath } = remote;
  if (provider === "github") {
    const token = await githubToken();
    if (!token) return { error: "no_token", host };
    const { status, body } = await getJson(`https://api.github.com/repos/${projectPath}/actions/runs?per_page=15`, {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
    });
    if (status !== 200) return httpError(status, host);
    const runs = ((body as { workflow_runs?: Record<string, any>[] }).workflow_runs ?? []).map((r): PipelineRun => {
      const started = Date.parse(r.run_started_at ?? r.created_at);
      const ended = Date.parse(r.updated_at);
      const finished = r.status === "completed";
      return {
        id: String(r.id),
        status: githubStatus(r.status, r.conclusion),
        ref: r.head_branch ?? "",
        sha: r.head_sha ?? "",
        title: r.display_title ?? r.name ?? "",
        createdAt: r.created_at,
        durationSec: finished && !Number.isNaN(started) && !Number.isNaN(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : null,
        url: r.html_url,
      };
    });
    return { host, provider, runs };
  }
  if (provider === "gitlab") {
    const token = cfg.tokens[host] ?? (host === "gitlab.com" ? process.env.GITLAB_TOKEN : undefined);
    if (!token) return { error: "no_token", host };
    const { status, body } = await getJson(`https://${host}/api/v4/projects/${encodeURIComponent(projectPath)}/pipelines?per_page=15`, {
      "private-token": token,
    });
    if (status !== 200) return httpError(status, host);
    const list = body as Record<string, any>[];
    const base = `https://${host}/api/v4/projects/${encodeURIComponent(projectPath)}`;
    const headers = { "private-token": token };
    const titles = new Map<string, Promise<string | null>>();
    for (const r of list) {
      const sha = r.sha as string | undefined;
      if (sha && !titles.has(sha)) {
        titles.set(
          sha,
          getJson(`${base}/repository/commits/${sha}`, headers)
            .then((c) => (c.status === 200 ? ((c.body as { title?: string }).title ?? null) : null))
            .catch(() => null),
        );
      }
    }
    const details = await Promise.all(
      list.map((r) =>
        getJson(`${base}/pipelines/${r.id}`, headers)
          .then((d) => (d.status === 200 ? ((d.body as { duration?: number | null }).duration ?? null) : null))
          .catch(() => null),
      ),
    );
    const resolved = new Map<string, string | null>();
    await Promise.all([...titles].map(async ([sha, t]) => resolved.set(sha, await t)));
    const runs = list.map((r, i): PipelineRun => ({
      id: String(r.id),
      status: gitlabStatus(r.status),
      ref: r.ref ?? "",
      sha: r.sha ?? "",
      title: resolved.get(r.sha) || r.ref || "",
      createdAt: r.created_at,
      durationSec: typeof details[i] === "number" ? Math.round(details[i] as number) : null,
      url: r.web_url,
    }));
    return { host, provider, runs };
  }
  return { error: "unsupported", host };
}

export async function getPipelines(projectId: string, remote: Remote | null, cfg: Config): Promise<PipelinesResult> {
  if (!remote) return { error: "unsupported", host: "" };
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  let value: PipelinesResult;
  try {
    value = await fetchRuns(remote, cfg);
  } catch {
    value = { error: "upstream", host: remote.host };
  }
  cache.set(projectId, { at: Date.now(), value });
  return value;
}
