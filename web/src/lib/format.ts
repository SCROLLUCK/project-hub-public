const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  if (Number.isNaN(secs)) return "—";
  const abs = Math.abs(secs);
  for (const [unit, size] of UNITS) {
    if (abs >= size) return rtf.format(Math.round(secs / size), unit);
  }
  return "just now";
}

export function duration(sec: number | null | undefined): string {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${Math.round(sec % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const shortSha = (s: string) => s.slice(0, 7);
export const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
