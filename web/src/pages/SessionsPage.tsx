import { ChevronRight, Bot } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { Hint } from "@/components/Hint";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/States";
import { StatusDot } from "@/components/StatusBadge";
import { useSessions, type SessionInfo } from "@/lib/api";
import { baseName, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

function Row({ s }: { s: SessionInfo }) {
  const [open, setOpen] = useState(false);
  const running = s.subagents.filter((a) => !a.finished).length;
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={s.subagents.length === 0}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors enabled:hover:bg-accent/50"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90", s.subagents.length === 0 && "opacity-0")} aria-hidden />
        <Hint text={s.active ? "Active: the session file changed in the last 5 minutes." : "Idle: no session file change in the last 5 minutes."}>
          <StatusDot tone={s.active ? "success" : "neutral"} />
        </Hint>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.title}</span>
        <span className="hidden shrink-0 truncate font-mono text-xs text-muted-foreground sm:block sm:max-w-40" title={s.cwd}>
          {baseName(s.cwd)}
        </span>
        <span className="hidden shrink-0 font-mono text-xs text-muted-foreground md:block">{s.model ?? "—"}</span>
        {s.subagents.length > 0 && (
          <Hint text={`${s.subagents.length} subagents in this session, ${running} still running (no result recorded yet).`}>
            <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
              <Bot className="size-3.5" aria-hidden />
              {s.subagents.length}
            </span>
          </Hint>
        )}
        <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">{relativeTime(s.lastActivity)}</span>
      </button>
      {open && (
        <ul className="border-t bg-card/40 py-1 pl-10">
          {s.subagents.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <StatusDot tone={a.finished ? "neutral" : "running"} />
              <span className="min-w-0 flex-1 truncate">{a.description}</span>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{a.agentType ?? "agent"}</span>
              <span className="hidden shrink-0 font-mono text-xs text-muted-foreground md:block">{a.model ?? "—"}</span>
              <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{a.finished ? "finished" : "running"}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function SessionsPage() {
  const { id = "" } = useParams();
  const q = useSessions(id);
  if (q.isLoading) return <RowsSkeleton rows={6} className="h-11" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];
  if (list.length === 0) return <EmptyState icon={<Bot />} title="No sessions" />;
  return (
    <ul aria-label="Sessions" className="flex flex-col divide-y rounded-lg border">
      {list.map((s) => (
        <Row key={s.id} s={s} />
      ))}
    </ul>
  );
}
