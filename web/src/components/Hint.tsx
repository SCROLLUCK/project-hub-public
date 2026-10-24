import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Wraps a figure with a tooltip saying what it measures and how it is counted. */
export function Hint({ text, children, side }: { text: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-default">{children}</span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-72">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
