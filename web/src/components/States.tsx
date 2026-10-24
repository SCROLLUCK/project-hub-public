import { CircleAlert, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof Error ? error.message : "Something went wrong";
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-2 font-medium">
        <CircleAlert className="size-4 text-destructive" aria-hidden /> Request failed
      </div>
      <p className="font-mono text-xs text-muted-foreground break-all">{msg}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
      {icon && <div className="text-muted-foreground [&>svg]:size-6">{icon}</div>}
      <div className="font-medium">{title}</div>
      {children}
    </div>
  );
}

export function RowsSkeleton({ rows = 6, className = "h-10" }: { rows?: number; className?: string }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </div>
  );
}

export function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-3xl font-semibold leading-none tabular-nums">{value}</span>
      <span className="mt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}
