import { Monitor } from "lucide-react";
import { Link } from "react-router";
import { AgentBrowser } from "@/components/AgentBrowser";
import { PreviewIssues } from "@/components/PreviewIssues";
import { PreviewThumb } from "@/components/PreviewThumb";
import { StatusDot } from "@/components/StatusBadge";
import { itemTitle, itemWhere, StopButton } from "@/components/RunningList";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/States";
import { Button } from "@/components/ui/button";
import { usePreviews, useRunning, type PreviewInfo, type RunningItem } from "@/lib/api";

function Tile({ item, preview }: { item: RunningItem; preview?: PreviewInfo }) {
  return (
    <li className="group relative flex flex-col overflow-hidden rounded-lg border transition-colors hover:border-foreground/40">
      <a href={item.url} target="_blank" rel="noreferrer" className="flex flex-col" aria-label={`Open ${itemTitle(item)} on port ${item.port}`}>
        <PreviewThumb url={item.url} title={itemTitle(item)} embeddable={item.embeddable} caption={`:${item.port}`} />
        <div className="flex items-center gap-2 px-3 py-2.5">
          <StatusDot tone="success" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{itemTitle(item)}</span>
            <span className="truncate font-mono text-xs text-muted-foreground">{itemWhere(item)}</span>
          </div>
          <span className="shrink-0 font-mono text-xs tabular-nums">:{item.port}</span>
          <span className="size-8 shrink-0" aria-hidden={!item.previewId} />
        </div>
      </a>
      {preview && preview.issues.length > 0 && (
        <div className="px-3 pb-12">
          <PreviewIssues issues={preview.issues} />
        </div>
      )}
      {preview && <AgentBrowser preview={preview} className="px-3 pb-3 pr-12" />}
      <div className="absolute bottom-2.5 right-2">
        <StopButton item={item} />
      </div>
    </li>
  );
}

export function PreviewsPage() {
  const q = useRunning();
  const items = q.data ?? [];
  const previews = usePreviews().data ?? [];
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">Previews</h1>
      {q.isLoading && <RowsSkeleton rows={3} className="h-40" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isSuccess && items.length === 0 && (
        <EmptyState icon={<Monitor />} title="Nothing running">
          <Button variant="outline" size="sm" asChild>
            <Link to="/projects">Go to projects</Link>
          </Button>
        </EmptyState>
      )}
      {items.length > 0 && (
        <ul aria-label="Running previews" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => (
            <Tile key={`${i.kind}:${i.port}`} item={i} preview={previews.find((p) => p.id === i.previewId)} />
          ))}
        </ul>
      )}
    </div>
  );
}
