import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { webUrl, type Project } from "@/lib/api";

export function RepoLink({ p, size = "size-8" }: { p: Project; size?: string }) {
  const url = webUrl(p);
  if (!url) return <span className={size} aria-hidden />;
  return (
    <Button variant="ghost" size="icon" className={size} asChild>
      <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${p.name} repository`} title="Open repository">
        <ExternalLink className="size-4" />
      </a>
    </Button>
  );
}
