import { SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openInEditor } from "@/lib/api";

export function OpenButton({ path, file, line, label = "Open in VS Code", compact = false, variant = "outline" }: {
  path: string;
  file?: string;
  line?: number;
  label?: string;
  compact?: boolean;
  variant?: "outline" | "ghost" | "secondary";
}) {
  const click = () => openInEditor(path, file, line).catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Could not open VS Code"));
  if (compact)
    return (
      <Button variant="ghost" size="icon" className="size-8" onClick={click} aria-label={label} title={label}>
        <SquareTerminal className="size-4" />
      </Button>
    );
  return (
    <Button variant={variant} size="sm" onClick={click}>
      <SquareTerminal /> {label}
    </Button>
  );
}
