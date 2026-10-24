import { useEffect, useRef, useState } from "react";

const W = 1280;
const H = 800;

function useScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, scale };
}

/** Scaled, non-interactive iframe thumbnail; a big title (+ caption) when the page forbids framing. */
export function PreviewThumb({ url, title, embeddable, caption }: { url: string; title: string; embeddable?: boolean; caption: string }) {
  const { ref, scale } = useScale();
  return (
    <div ref={ref} className="relative overflow-hidden border-b bg-card" style={{ width: "100%", aspectRatio: `${W} / ${H}` }}>
      {embeddable === false ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          <span className="max-w-full truncate px-4 text-3xl font-semibold">{title}</span>
          <span className="font-mono text-lg tabular-nums text-muted-foreground">{caption}</span>
        </div>
      ) : (
        <iframe
          src={url}
          title={`Preview of ${title}`}
          loading="lazy"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white"
          style={{ width: W, height: H, transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
}
