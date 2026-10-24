import { useEffect, useState } from "react";
import { Hint } from "@/components/Hint";
import { useQuota, type AgyGroup, type QuotaSource, type QuotaWindow } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const STALE_MS = 3_600_000;
const HIGH_PCT = 90;

/** Compact countdown: "2h 10m", "3d", "45m". */
function countdown(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60_000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return mins % 60 ? `${h}h ${mins % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

const resetsIn = (w: QuotaWindow | null, now: number) => (w && !w.reset && w.resetsAt ? `resets in ${countdown(w.resetsAt, now)}` : null);

function windowTip(label: string, w: QuotaWindow | null, now: number) {
  if (!w) return `${label}: no data`;
  if (w.reset) return `${label}: window already reset`;
  const used = `${Math.round(w.pct)}% used`;
  if (!w.resetsAt) return `${label}: ${used} · reset time unknown`;
  const at = new Date(w.resetsAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  return `${label}: ${used} · resets ${at} (in ${countdown(w.resetsAt, now)})`;
}

function Bar({ w }: { w: QuotaWindow }) {
  const pct = Math.min(100, Math.max(0, w.pct));
  return (
    <span className="h-1.5 w-12 shrink-0 self-center overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <span className={cn("block h-full rounded-full", pct >= HIGH_PCT ? "bg-destructive" : "bg-foreground")} style={{ width: `${pct}%` }} />
    </span>
  );
}

function Win({ label, w, now, showReset }: { label: string; w: QuotaWindow | null; now: number; showReset: boolean }) {
  if (!w) return null;
  const reset = showReset ? resetsIn(w, now) : null;
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}</span>
      <Bar w={w} />
      <span>{Math.round(w.pct)}%</span>
      {reset && <span className="text-muted-foreground">{reset}</span>}
    </span>
  );
}

function Source({ name, src, now }: { name: string; src: QuotaSource | null; now: number }) {
  if (!src) return null;
  const age = src.updatedAt ? now - new Date(src.updatedAt).getTime() : Infinity;
  const stale = age > STALE_MS;
  const origin = src.source === "live" ? "live" : "local file";
  const text = (
    <span className="flex flex-col gap-0.5">
      <span>{windowTip("5h", src.fiveHour, now)}</span>
      <span>{windowTip("7d", src.sevenDay, now)}</span>
      {src.models?.map((m) => <span key={m.name}>{windowTip(`${m.name} 7d`, m.sevenDay, now)}</span>)}
      <span>{src.updatedAt ? `Updated ${relativeTime(src.updatedAt)}` : "Update time unknown"} · {origin}</span>
    </span>
  );
  return (
    <Hint text={text} side="bottom">
      <span className={cn("flex items-baseline gap-2 whitespace-nowrap text-xs tabular-nums", stale && "text-muted-foreground")}>
        <span className="font-semibold">{name}</span>
        <Win label="5h" w={src.fiveHour} now={now} showReset />
        <Win label="7d" w={src.sevenDay} now={now} showReset={false} />
        {src.models?.map((m) => (
          <span key={m.name} className="text-muted-foreground">
            {m.name} 7d <span className="text-foreground">{Math.round(m.sevenDay.pct)}%</span>
          </span>
        ))}
        {stale && <span className="text-muted-foreground">({relativeTime(src.updatedAt)})</span>}
      </span>
    </Hint>
  );
}

const peak = (g: QuotaSource) => Math.max(g.fiveHour?.pct ?? 0, g.sevenDay?.pct ?? 0);

/** Top bar is tight: show only the most-used agy group inline; the tooltip lists them all. */
function Agy({ groups, now }: { groups: AgyGroup[]; now: number }) {
  const top = groups.reduce((a, b) => (peak(b) > peak(a) ? b : a));
  const updatedAt = top.updatedAt;
  const stale = (updatedAt ? now - new Date(updatedAt).getTime() : Infinity) > STALE_MS;
  const text = (
    <span className="flex flex-col gap-1.5">
      {groups.map((g) => (
        <span key={g.name} className="flex flex-col gap-0.5">
          <span className="font-semibold">{g.name}</span>
          <span>{windowTip("5h", g.fiveHour, now)}</span>
          <span>{windowTip("7d", g.sevenDay, now)}</span>
        </span>
      ))}
      <span>{updatedAt ? `Updated ${relativeTime(updatedAt)}` : "Update time unknown"} · local file</span>
    </span>
  );
  return (
    <Hint text={text} side="bottom">
      <span className={cn("flex items-baseline gap-2 whitespace-nowrap text-xs tabular-nums", stale && "text-muted-foreground")}>
        <span className="font-semibold">agy</span>
        <Win label="5h" w={top.fiveHour} now={now} showReset />
        <Win label="7d" w={top.sevenDay} now={now} showReset={false} />
        {stale && <span className="text-muted-foreground">({relativeTime(updatedAt)})</span>}
      </span>
    </Hint>
  );
}

export function QuotaWidget() {
  const { data } = useQuota();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  if (!data || (!data.claude && !data.codex && !data.agy?.length)) return null;
  return (
    <div className="hidden items-center gap-4 pr-2 sm:flex" aria-label="Model quota">
      <Source name="Claude" src={data.claude} now={now} />
      <Source name="Codex" src={data.codex} now={now} />
      {data.agy && data.agy.length > 0 && <Agy groups={data.agy} now={now} />}
    </div>
  );
}
