import { Hint } from "@/components/Hint";
import { useSessions } from "@/lib/api";

/** "N active" indicator for a project row; renders nothing when no session is active. */
export function ActiveSessions({ id }: { id: string }) {
  const { data } = useSessions(id, 30_000);
  const n = data?.filter((s) => s.active).length ?? 0;
  if (n === 0) return null;
  return (
    <Hint text="Claude Code sessions in this project with activity in the last 5 minutes, counted from session file modification times.">
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
        <span className="size-2 rounded-full bg-st-success" aria-hidden />
        <span className="font-semibold tabular-nums">{n}</span> active
      </span>
    </Hint>
  );
}
