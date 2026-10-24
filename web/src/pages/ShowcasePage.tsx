import { LayoutGrid } from "lucide-react";
import { Link } from "react-router";
import { PreviewThumb } from "@/components/PreviewThumb";
import { StatusDot } from "@/components/StatusBadge";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/States";
import { Button } from "@/components/ui/button";
import { useShowcase, type ShowcaseItem } from "@/lib/api";

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function Tile({ item }: { item: ShowcaseItem }) {
  const host = hostOf(item.url);
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-lg border transition-colors hover:border-foreground/40">
      <a href={item.url} target="_blank" rel="noreferrer" className="flex flex-col" aria-label={`Open ${item.name}`}>
        <PreviewThumb url={item.url} title={item.name} embeddable={item.embeddable} caption={host} />
        <div className="flex items-center gap-2 px-3 py-2.5">
          <StatusDot tone="success" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.name}</span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{host}</span>
          <span className="w-16 shrink-0" aria-hidden />
        </div>
      </a>
      <Link
        to={`/p/${encodeURIComponent(item.projectId)}`}
        className="absolute bottom-2.5 right-3 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Project
      </Link>
    </li>
  );
}

export function ShowcasePage() {
  const q = useShowcase();
  const items = q.data ?? [];
  const up = items.filter((i) => i.up);
  const down = items.filter((i) => !i.up);
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">Showcase</h1>
      {q.isLoading && <RowsSkeleton rows={3} className="h-40" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isSuccess && items.length === 0 && (
        <EmptyState icon={<LayoutGrid />} title="No apps in the showcase">
          <Button variant="outline" size="sm" asChild>
            <Link to="/settings">Open Settings</Link>
          </Button>
        </EmptyState>
      )}
      {up.length > 0 && (
        <ul aria-label="Deployed apps" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {up.map((i) => (
            <Tile key={i.projectId} item={i} />
          ))}
        </ul>
      )}
      {down.length > 0 && <p className="text-sm text-muted-foreground">Offline: {down.map((i) => i.name).join(", ")}</p>}
    </div>
  );
}
