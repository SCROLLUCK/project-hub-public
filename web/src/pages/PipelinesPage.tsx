import { ExternalLink, Workflow } from "lucide-react";
import { Link, useParams } from "react-router";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/States";
import { usePipelines } from "@/lib/api";
import { duration, relativeTime, shortSha } from "@/lib/format";

const ERR: Record<string, string> = {
  not_found: "Repository not found on the host",
  unsupported: "Host not supported",
  upstream: "Host did not answer",
};

export function PipelinesPage() {
  const { id = "" } = useParams();
  const q = usePipelines(id);

  if (q.isLoading) return <RowsSkeleton rows={8} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  if (!d) return null;
  if (d.error === "no_token")
    return (
      <p className="text-sm">
        No token for <span className="font-mono">{d.host}</span>.{" "}
        <Link to="/settings" className="font-semibold underline underline-offset-2">
          Add one in Settings
        </Link>
      </p>
    );
  if (d.error) return <ErrorState error={new Error(ERR[d.error] ?? d.error)} onRetry={() => void q.refetch()} />;
  if (d.runs.length === 0) return <EmptyState icon={<Workflow />} title="No pipeline runs" />;

  return (
    <div className="relative overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Ref</th>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Commit</th>
            <th className="px-3 py-2 font-medium">When</th>
            <th className="px-3 py-2 font-medium">Time</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {d.runs.map((r) => (
            <tr key={r.id} className="border-b last:border-0 hover:bg-accent/50">
              <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
              <td className="max-w-40 truncate px-3 py-2 font-mono text-xs">{r.ref}</td>
              <td className="max-w-80 truncate px-3 py-2">{r.title}</td>
              <td className="px-3 py-2 font-mono text-xs">{shortSha(r.sha)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{relativeTime(r.createdAt)}</td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{duration(r.durationSec)}</td>
              <td className="px-3 py-2 text-right">
                <a href={r.url} target="_blank" rel="noreferrer" aria-label="Open run" className="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent">
                  <ExternalLink className="size-4" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
