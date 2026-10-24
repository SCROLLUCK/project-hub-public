import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError, type PreviewInfo } from "@/lib/api";
import { CopyButton } from "./CopyButton";

/** "Open with agent": opens the preview in the project's CDP-enabled Chrome and shows its endpoint. */
export function AgentBrowser({ preview, className }: { preview: PreviewInfo; className?: string }) {
  const qc = useQueryClient();
  const open = useMutation({
    mutationFn: () => api<{ cdpUrl: string }>(`/previews/${encodeURIComponent(preview.id)}/browser`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["previews"] }),
  });
  const cdpUrl = open.data?.cdpUrl ?? (preview.browser?.status === "open" ? preview.browser.cdpUrl : null);
  const error = open.error;
  const message = error instanceof ApiError && error.status === 503 ? "Browser helper not running — run deploy/up.sh" : error?.message;
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className ?? ""}`}>
      <Button variant="outline" size="sm" onClick={() => open.mutate()} disabled={open.isPending || preview.status !== "running"}>
        <Bot /> Open with agent
      </Button>
      {cdpUrl && (
        <span className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Agent browser</span>
          <code className="font-mono">{cdpUrl}</code>
          <CopyButton value={cdpUrl} label="Copy CDP URL" />
        </span>
      )}
      <p aria-live="polite" className="text-xs text-destructive empty:hidden">
        {message}
      </p>
    </div>
  );
}
