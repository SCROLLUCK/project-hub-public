import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { usePipelines } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "./StatusBadge";

/** Fetches only once the cell scrolls into view (lazy per row). */
export function PipelineCell({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && setSeen(true), { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  const q = usePipelines(id, seen);
  let body;
  if (!seen || q.isLoading) body = <Skeleton className="h-6 w-20" />;
  else if (q.isError) body = <span className="text-muted-foreground" title="Could not load pipelines">Error</span>;
  else if (q.data?.error === "no_token")
    body = (
      <Link to="/settings" className="text-muted-foreground underline-offset-2 hover:underline" title={`Add a token for ${q.data.host}`}>
        No token
      </Link>
    );
  else if (!q.data?.runs?.length) body = <span className="text-muted-foreground">—</span>;
  else body = <StatusBadge status={q.data.runs[0]!.status} />;
  return <div ref={ref}>{body}</div>;
}
