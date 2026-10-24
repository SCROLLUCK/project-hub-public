import { TriangleAlert } from "lucide-react";

/** Missing dependencies/tools the dev server reported. The Hub never fixes them: the project's agents do. */
export function PreviewIssues({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      <div className="flex items-center gap-1.5 font-medium">
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
        Fix in the project, not in the Hub.
      </div>
      <ul className="mt-1 list-disc pl-5 font-mono">
        {issues.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
