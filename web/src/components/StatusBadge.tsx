import { CircleCheck, CircleDashed, CircleMinus, CircleX, LoaderCircle } from "lucide-react";
import type { RunStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

const MAP: Record<RunStatus, { label: string; color: string; Icon: typeof CircleCheck; spin?: boolean }> = {
  success: { label: "Passed", color: "text-st-success", Icon: CircleCheck },
  failed: { label: "Failed", color: "text-st-failed", Icon: CircleX },
  running: { label: "Running", color: "text-st-running", Icon: LoaderCircle, spin: true },
  pending: { label: "Pending", color: "text-st-neutral", Icon: CircleDashed },
  canceled: { label: "Canceled", color: "text-st-neutral", Icon: CircleMinus },
  skipped: { label: "Skipped", color: "text-st-neutral", Icon: CircleMinus },
};

export function StatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const { label, color, Icon, spin } = MAP[status] ?? MAP.pending;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-current/30 px-2 py-0.5 text-xs font-medium", color, className)}>
      <Icon className={cn("size-3.5", spin && "animate-spin")} aria-hidden />
      {label}
    </span>
  );
}

export function StatusDot({ tone }: { tone: "success" | "failed" | "running" | "neutral" }) {
  const c = { success: "bg-st-success", failed: "bg-st-failed", running: "bg-st-running", neutral: "bg-st-neutral" }[tone];
  return <span className={cn("inline-block size-2 rounded-full", c)} aria-hidden />;
}
