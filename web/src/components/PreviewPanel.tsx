import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiError, usePreviews, type PreviewInfo, type PreviewStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AgentBrowser } from "./AgentBrowser";
import { PreviewIssues } from "./PreviewIssues";
import { StatusDot } from "./StatusBadge";

const TONE: Record<PreviewStatus, "success" | "failed" | "running" | "neutral"> = {
  running: "success",
  failed: "failed",
  installing: "running",
  starting: "running",
  stopped: "neutral",
};

function Logs({ id, onStatus, onIssues }: { id: string; onStatus: (s: PreviewStatus) => void; onIssues: (i: string[]) => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    setLines([]);
    const es = new EventSource(`/api/previews/${encodeURIComponent(id)}/logs`);
    es.addEventListener("log", (e) => setLines((l) => [...l.slice(-499), JSON.parse((e as MessageEvent<string>).data) as string]));
    es.addEventListener("status", (e) => onStatus(JSON.parse((e as MessageEvent<string>).data) as PreviewStatus));
    es.addEventListener("issues", (e) => onIssues(JSON.parse((e as MessageEvent<string>).data) as string[]));
    return () => es.close();
  }, [id, onStatus, onIssues]);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [lines]);
  return (
    <pre ref={box} aria-label="Preview logs" className="h-48 overflow-auto rounded-lg border bg-card p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-all">
      {lines.length ? lines.join("\n") : "No output yet"}
    </pre>
  );
}

export function PreviewPanel({ projectId, worktreePath }: { projectId: string; worktreePath: string }) {
  const qc = useQueryClient();
  const previews = usePreviews();
  const current: PreviewInfo | undefined = previews.data?.find((p) => p.projectId === projectId && p.worktreePath === worktreePath);
  const [live, setLive] = useState<PreviewStatus | null>(null);
  const [liveIssues, setLiveIssues] = useState<string[] | null>(null);
  const [noDev, setNoDev] = useState(false);

  useEffect(() => {
    setNoDev(false);
    setLive(null);
    setLiveIssues(null);
  }, [projectId, worktreePath]);

  const start = useMutation({
    mutationFn: () => api<PreviewInfo>("/previews", { method: "POST", json: { projectId, worktreePath } }),
    onSuccess: () => {
      setNoDev(false);
      void qc.invalidateQueries({ queryKey: ["previews"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.body && typeof e.body === "object" && (e.body as { error?: string }).error === "no_dev_command") setNoDev(true);
    },
  });
  const stop = useMutation({
    mutationFn: (id: string) => api(`/previews/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["previews"] }),
  });

  const status = live ?? current?.status;
  const active = current && status !== "stopped" && status !== "failed";

  return (
    <section aria-label="Preview" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-base font-semibold">Preview</h3>
        {current && status && (
          <span className="flex items-center gap-1.5 text-sm">
            <StatusDot tone={TONE[status]} />
            <span className="capitalize">{status}</span>
          </span>
        )}
        {active && current ? (
          <>
            {status === "running" && (
              <Button variant="outline" size="sm" asChild>
                <a href={current.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> New tab
                </a>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => stop.mutate(current.id)} disabled={stop.isPending}>
              <Square /> Stop
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending}>
            <Play /> Start
          </Button>
        )}
      </div>

      {active && current && status === "running" && <AgentBrowser preview={current} />}

      {noDev && (
        <p role="alert" className="font-mono text-xs text-muted-foreground">
          no dev command — set projects.{projectId}.devCommand in ~/.config/project-hub/config.json
        </p>
      )}
      {start.isError && !noDev && <p role="alert" className="text-sm text-destructive">{start.error.message}</p>}

      {current && (
        <>
          {status === "running" && (
            <iframe title="Preview" src={current.url} className={cn("h-96 w-full rounded-lg border bg-white")} />
          )}
          <PreviewIssues issues={liveIssues ?? current.issues ?? []} />
          <Logs id={current.id} onStatus={setLive} onIssues={setLiveIssues} />
        </>
      )}
    </section>
  );
}
