import { ExternalLink, GitBranch } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router";
import { Diff } from "@/components/Diff";
import { OpenButton } from "@/components/OpenButton";
import { PreviewPanel } from "@/components/PreviewPanel";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/States";
import { treeUrl, useProject, useWorktreeDiff, useWorktrees, type Worktree } from "@/lib/api";
import { baseName, relativeTime, shortSha } from "@/lib/format";
import { cn } from "@/lib/utils";

function Detail({ projectId, wt }: { projectId: string; wt: Worktree }) {
  const d = useWorktreeDiff(projectId, wt.path);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-mono text-base font-semibold">
            <GitBranch className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{wt.branch ?? `detached ${shortSha(wt.head)}`}</span>
          </h2>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{wt.path}</p>
        </div>
        <OpenButton path={wt.path} />
      </div>

      <PreviewPanel projectId={projectId} worktreePath={wt.path} />

      <section aria-label="Commits ahead">
        <h3 className="mb-2 text-base font-semibold">
          Commits ahead <span className="tabular-nums text-muted-foreground">{wt.ahead}</span>
        </h3>
        {d.isLoading && <RowsSkeleton rows={3} className="h-7" />}
        {d.isError && <ErrorState error={d.error} onRetry={() => void d.refetch()} />}
        {d.data && d.data.commits.length === 0 && <p className="text-sm text-muted-foreground">None</p>}
        {d.data && d.data.commits.length > 0 && (
          <ul className="flex flex-col">
            {d.data.commits.map((c) => (
              <li key={c.hash} className="flex items-baseline gap-3 py-1 text-sm">
                <span className="shrink-0 font-mono text-xs">{shortSha(c.hash)}</span>
                <span className="min-w-0 flex-1 truncate">{c.subject}</span>
                <span className="shrink-0 text-muted-foreground">{relativeTime(c.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Files">
        <h3 className="mb-2 text-base font-semibold">
          Files <span className="tabular-nums text-muted-foreground">{d.data?.files.length ?? ""}</span>
        </h3>
        {d.isLoading && <RowsSkeleton rows={4} className="h-7" />}
        {d.data && d.data.files.length === 0 && <p className="text-sm text-muted-foreground">No changes</p>}
        {d.data && d.data.files.length > 0 && (
          <ul className="flex flex-col">
            {d.data.files.map((f) => (
              <li key={f.path} className="flex items-center gap-3 rounded-md px-1 py-0.5 hover:bg-accent/50">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>{f.path}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-diff-add">+{f.additions}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-diff-del">-{f.deletions}</span>
                <OpenButton compact variant="ghost" path={wt.path} file={f.path} line={f.firstChangedLine} label={`Open ${baseName(f.path)} at line ${f.firstChangedLine}`} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Diff">
        <h3 className="mb-2 text-base font-semibold">Diff</h3>
        {d.isLoading && <RowsSkeleton rows={6} className="h-5" />}
        {d.data && !d.data.patch && <p className="text-sm text-muted-foreground">Empty</p>}
        {d.data?.patch && <Diff patch={d.data.patch} />}
        {d.data?.truncated && <p className="mt-2 text-sm text-muted-foreground">Diff truncated</p>}
      </section>

    </div>
  );
}

export function WorktreesPage() {
  const { id = "", wt } = useParams();
  const nav = useNavigate();
  const q = useWorktrees(id);
  const project = useProject(id).data;

  if (q.isLoading) return <RowsSkeleton rows={5} className="h-14" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];
  if (list.length === 0) return <EmptyState icon={<GitBranch />} title="No worktrees" />;

  const selected = list.find((w) => w.path === wt);
  if (!selected && !wt) return <Navigate to={`/p/${encodeURIComponent(id)}/worktrees/${encodeURIComponent(list[0]!.path)}`} replace />;
  const go = (path: string) => nav(`/p/${encodeURIComponent(id)}/worktrees/${encodeURIComponent(path)}`);

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ul aria-label="Worktrees" className="flex min-w-0 flex-col gap-1 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
        {list.map((w) => {
          const active = w.path === selected?.path;
          const remote = project ? treeUrl(project, w.branch) : null;
          return (
            <li key={w.path} className="relative">
              <button
                type="button"
                onClick={() => go(w.path)}
                aria-current={active ? "true" : undefined}
                className={cn("flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent", active ? "border-foreground/40 bg-accent" : "border-transparent")}
              >
                <span className={cn("truncate pr-6 font-mono text-sm", active && "font-semibold")}>{w.branch ?? `detached ${shortSha(w.head)}`}</span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="truncate">{w.isMain ? "main tree" : baseName(w.path)}</span>
                  <span className="ml-auto tabular-nums">{w.ahead} ahead</span>
                  {w.dirty > 0 && <span className="tabular-nums">{w.dirty} dirty</span>}
                </span>
              </button>
              {remote && (
                <a
                  href={remote}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${w.branch} on the remote`}
                  title="Open branch on the remote"
                  className="absolute right-2 top-2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <div className="min-w-0">
        {selected ? <Detail key={selected.path} projectId={id} wt={selected} /> : <EmptyState icon={<GitBranch />} title="Select a worktree" />}
      </div>
    </div>
  );
}
