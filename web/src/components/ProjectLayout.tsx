import { ExternalLink } from "lucide-react";
import { NavLink, Outlet, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { webUrl } from "@/lib/api";
import { useProject, useVault } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CopyButton } from "./CopyButton";
import { RunningList } from "./RunningList";
import { OpenButton } from "./OpenButton";
import { ProviderIcon } from "./ProviderIcon";
import { ErrorState, RowsSkeleton } from "./States";

const TABS = [
  { to: "worktrees", label: "Worktrees" },
  { to: "sessions", label: "Development" },
  { to: "pipelines", label: "Pipelines" },
  { to: "backlog", label: "Backlog" },
];

export function ProjectLayout() {
  const { id = "" } = useParams();
  const { data: p, isLoading, isError, error, refetch } = useProject(id);
  const vault = useVault(id);

  if (isLoading)
    return (
      <div className="p-4 md:p-6">
        <RowsSkeleton rows={3} className="h-10" />
      </div>
    );
  if (isError) return <div className="p-4 md:p-6"><ErrorState error={error} onRetry={() => void refetch()} /></div>;
  if (!p)
    return (
      <div className="p-4 md:p-6">
        <ErrorState error={new Error(`Project "${id}" not found`)} />
      </div>
    );
  const remote = webUrl(p);
  const base = `/p/${encodeURIComponent(p.id)}`;
  const tabs = vault.data?.exists ? [...TABS, { to: "docs", label: "Docs" }] : TABS;

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b px-4 pt-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold leading-tight">
              <ProviderIcon provider={p.provider ?? "other"} className="size-5 shrink-0 text-muted-foreground" />
              <span className="truncate">{p.name}</span>
            </h1>
            <div className="mt-1 flex min-w-0 items-center gap-1 font-mono text-xs text-muted-foreground">
              <span className="truncate">{p.path}</span>
              <CopyButton value={p.path} label="Copy path" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <OpenButton path={p.path} />
            {remote && (
              <Button variant="outline" size="sm" asChild>
                <a href={remote} target="_blank" rel="noreferrer">
                  <ExternalLink /> Remote
                </a>
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3 empty:hidden">
          <RunningList projectId={p.id} />
        </div>
        <nav aria-label="Project sections" className="-mb-px mt-4 flex gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={`${base}/${t.to}`}
              className={({ isActive }) =>
                cn(
                  "border-b-2 px-3 py-2 text-sm transition-colors",
                  isActive ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1 p-4 md:p-6">
        <Outlet />
      </div>
    </div>
  );
}
