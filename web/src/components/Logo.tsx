import { cn } from "@/lib/utils";

/** Brand mark: a running (green) hub linked to four projects. Same drawing as web/public/favicon.svg. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6 shrink-0", className)}>
      <rect width="32" height="32" rx="7" fill="#0F172A" />
      <path d="M16 16 8.5 8.5M16 16l7.5-7.5M16 16l-7.5 7.5M16 16l7.5 7.5" stroke="#64748B" strokeWidth="2" strokeLinecap="round" />
      <g fill="#F8FAFC">
        <circle cx="8.5" cy="8.5" r="3" />
        <circle cx="23.5" cy="8.5" r="3" />
        <circle cx="8.5" cy="23.5" r="3" />
        <circle cx="23.5" cy="23.5" r="3" />
      </g>
      <circle cx="16" cy="16" r="4.5" fill="#22C55E" />
    </svg>
  );
}
