import { cn } from "@/lib/utils";

/** Unified diff with add/remove line coloring. */
export function Diff({ patch }: { patch: string }) {
  const lines = patch.split("\n");
  return (
    <pre className="overflow-x-auto rounded-lg border bg-card py-2 font-mono text-xs leading-5" aria-label="Diff">
      {lines.map((l, i) => {
        const kind = l.startsWith("+++") || l.startsWith("---") || l.startsWith("diff ") || l.startsWith("index ")
          ? "meta"
          : l.startsWith("@@")
            ? "hunk"
            : l.startsWith("+")
              ? "add"
              : l.startsWith("-")
                ? "del"
                : "ctx";
        return (
          <div
            key={i}
            className={cn(
              "min-w-max px-3",
              kind === "add" && "bg-diff-add-bg text-diff-add",
              kind === "del" && "bg-diff-del-bg text-diff-del",
              kind === "hunk" && "text-st-running",
              kind === "meta" && "font-semibold text-muted-foreground",
            )}
          >
            {l || " "}
          </div>
        );
      })}
    </pre>
  );
}
