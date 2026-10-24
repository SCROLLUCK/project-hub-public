import { EyeOff, FolderGit2, Pin, PinOff } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { ActiveSessions } from "@/components/ActiveSessions";
import { RepoLink } from "@/components/RepoLink";
import { useRunning } from "@/lib/api";
import { OpenButton } from "@/components/OpenButton";
import { PipelineCell } from "@/components/PipelineCell";
import { ProviderIcon } from "@/components/ProviderIcon";
import { EmptyState, ErrorState, RowsSkeleton, Stat } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { relativeTime } from "@/lib/format";
import { usePrefs, useVisibleProjects } from "@/lib/prefs";

export function Dashboard() {
  const { projects, query } = useVisibleProjects();
  const { pinned, togglePin, toggleHide } = usePrefs();
  const [q, setQ] = useState("");
  const running = useRunning().data?.length ?? 0;
  const rows = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase())), [projects, q]);
  const totals = useMemo(
    () => ({
      projects: projects.length,
      worktrees: projects.reduce((n, p) => n + p.worktreeCount, 0),
      open: projects.reduce((n, p) => n + (p.backlog?.open ?? 0), 0),
    }),
    [projects],
  );

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex gap-8">
          {query.isLoading ? (
            <>
              <Skeleton className="h-12 w-20" />
              <Skeleton className="h-12 w-20" />
              <Skeleton className="h-12 w-20" />
            </>
          ) : (
            <>
              <Stat value={totals.projects} label="Projects" />
              <Stat value={totals.worktrees} label="Worktrees" />
              <Stat value={totals.open} label="Open items" />
            </>
          )}
        </div>
        {running > 0 && (
          <Link to="/previews" className="text-sm font-semibold hover:underline">
            <span className="tabular-nums">{running}</span> running <span aria-hidden>→</span> Previews
          </Link>
        )}
        <Input aria-label="Filter projects" placeholder="Filter projects" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-64" />
      </div>

      {query.isLoading && <RowsSkeleton rows={8} className="h-12" />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.isSuccess && rows.length === 0 && (
        <EmptyState icon={<FolderGit2 />} title={projects.length ? "No project matches" : "No projects found"}>
          {!projects.length && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/settings">Check roots in Settings</Link>
            </Button>
          )}
        </EmptyState>
      )}

      {query.isSuccess && rows.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border md:hidden" aria-label="Projects">
          {rows.map((p) => {
            const isPinned = pinned.has(p.id);
            const total = p.backlog ? p.backlog.open + p.backlog.done : 0;
            return (
              <li key={p.id} className="flex items-start gap-1 px-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link to={`/p/${encodeURIComponent(p.id)}`} className="flex min-w-0 items-center gap-2 font-semibold hover:underline">
                    <ProviderIcon provider={p.provider ?? "other"} className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{p.name}</span>
                    {isPinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
                  </Link>
                  <span className="truncate font-mono text-xs text-muted-foreground">{p.branch ?? "detached"}</span>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                    <span title="Dirty files">
                      <span className={p.dirty ? "font-semibold text-foreground" : ""}>{p.dirty}</span> dirty
                    </span>
                    <span title="Worktrees">{p.worktreeCount} wt</span>
                    <span title={p.lastCommit?.subject}>{relativeTime(p.lastCommit?.date)}</span>
                    <PipelineCell id={p.id} />
                    <ActiveSessions id={p.id} />
                    {p.backlog && total > 0 && (
                      <span title="Backlog done / total">
                        <span className="font-semibold text-foreground">{p.backlog.done}</span> / {total}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 -mr-1">
                  <Button variant="ghost" size="icon" className="size-9" onClick={() => togglePin(p.id)} aria-label={isPinned ? `Unpin ${p.name}` : `Pin ${p.name}`}>
                    {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="size-9" onClick={() => toggleHide(p.id)} aria-label={`Hide ${p.name}`}>
                    <EyeOff className="size-4" />
                  </Button>
                  <RepoLink p={p} size="size-9" />
                  <OpenButton compact path={p.path} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {query.isSuccess && rows.length > 0 && (
        <div className="relative hidden overflow-x-auto rounded-lg border md:block">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b bg-card text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2.5 font-medium">Project</th>
                <th className="px-3 py-2.5 font-medium">Branch</th>
                <th className="px-3 py-2.5 text-right font-medium">Dirty</th>
                <th className="px-3 py-2.5 text-right font-medium">Worktrees</th>
                <th className="px-3 py-2.5 font-medium">Last commit</th>
                <th className="px-3 py-2.5 font-medium">Pipeline</th>
                <th className="px-3 py-2.5 font-medium">Backlog</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => {
                const isPinned = pinned.has(p.id);
                const total = p.backlog ? p.backlog.open + p.backlog.done : 0;
                return (
                  <tr key={p.id} className="transition-colors hover:bg-accent/50">
                    <td className="px-3 py-2">
                      <Link to={`/p/${encodeURIComponent(p.id)}`} className="flex items-center gap-2 font-semibold hover:underline">
                        <ProviderIcon provider={p.provider ?? "other"} className="size-4 shrink-0 text-muted-foreground" />
                        {p.name}
                        {isPinned && <Pin className="size-3 text-muted-foreground" aria-label="Pinned" />}
                      </Link>
                      <div className="empty:hidden pl-6"><ActiveSessions id={p.id} /></div>
                    </td>
                    <td className="max-w-[200px] truncate px-3 py-2 font-mono text-xs" title={p.branch ?? "detached"}>
                      {p.branch ?? "detached"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.dirty ? <span className="font-semibold">{p.dirty}</span> : <span className="text-muted-foreground">0</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.worktreeCount}</td>
                    <td className="px-3 py-2 text-muted-foreground" title={p.lastCommit?.subject}>
                      {relativeTime(p.lastCommit?.date)}
                    </td>
                    <td className="px-3 py-2">
                      <PipelineCell id={p.id} />
                    </td>
                    <td className="px-3 py-2">
                      {p.backlog && total > 0 ? (
                        <div className="flex w-32 flex-col gap-1">
                          <span className="tabular-nums">
                            <span className="font-semibold">{p.backlog.done}</span>
                            <span className="text-muted-foreground"> / {total}</span>
                          </span>
                          <Progress value={(p.backlog.done / total) * 100} className="h-1" aria-label={`${p.backlog.done} of ${total} done`} />
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-0.5">
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => togglePin(p.id)} aria-label={isPinned ? `Unpin ${p.name}` : `Pin ${p.name}`} title={isPinned ? "Unpin" : "Pin"}>
                          {isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => toggleHide(p.id)} aria-label={`Hide ${p.name}`} title="Hide">
                          <EyeOff className="size-4" />
                        </Button>
                        <RepoLink p={p} />
                        <OpenButton compact path={p.path} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
