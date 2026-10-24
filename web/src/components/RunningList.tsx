import { Link } from "react-router";
import { ExternalLink, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRunning, useStopPreview, type RunningItem } from "@/lib/api";
import { baseName } from "@/lib/format";
import { StatusDot } from "./StatusBadge";

export function itemTitle(i: RunningItem) {
  return i.kind === "hub" ? (i.projectId ?? i.label) : i.label;
}

export function itemWhere(i: RunningItem) {
  const branch = i.branch ?? (i.worktreePath ? baseName(i.worktreePath) : null);
  return [i.projectId, branch].filter(Boolean).join(" · ") || i.kind;
}

export function StopButton({ item, className }: { item: RunningItem; className?: string }) {
  const stop = useStopPreview();
  if (item.kind !== "hub" || !item.previewId) return null;
  const id = item.previewId;
  return (
    <Button
      variant="ghost"
      size="icon"
      className={className ?? "size-8"}
      disabled={stop.isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        stop.mutate(id);
      }}
      aria-label={`Stop preview on port ${item.port}`}
      title="Stop preview"
    >
      <Square className="size-4" />
    </Button>
  );
}

/** One row of compact chips (label :port); `projectId` narrows it to one project. */
export function RunningList({ projectId }: { projectId?: string }) {
  const q = useRunning();
  const all = (q.data ?? []).filter((i) => !projectId || i.projectId === projectId);
  if (all.length === 0) return null;
  const items = all.slice(0, 6);
  const more = all.length - items.length;
  return (
    <ul aria-label="Running servers" className="flex flex-nowrap items-center gap-2 overflow-x-auto">
      {items.map((i) => (
        <li key={`${i.kind}:${i.port}`} className="flex shrink-0 items-center gap-1 rounded-full border py-0.5 pl-3 pr-1 text-xs">
          <StatusDot tone="success" />
          <span className="font-semibold" title={itemWhere(i)}>
            {itemTitle(i)}
          </span>
          <span className="font-mono tabular-nums text-muted-foreground">:{i.port}</span>
          <Button variant="ghost" size="icon" className="size-6" asChild>
            <a href={i.url} target="_blank" rel="noreferrer" aria-label={`Open ${i.url}`} title={i.url}>
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
          <StopButton item={i} className="size-6" />
        </li>
      ))}
      {more > 0 && (
        <li className="shrink-0 text-xs">
          <Link to="/previews" className="font-medium text-muted-foreground hover:text-foreground">
            +{more} more
          </Link>
        </li>
      )}
    </ul>
  );
}
