import { useEffect, useId, useState } from "react";

export function Mermaid({ code }: { code: string }) {
  const id = "m" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSvg(null);
    setErr(null);
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
        const out = await mermaid.render(id, code);
        if (alive) setSvg(out.svg);
      })
      .catch((e: unknown) => alive && setErr(e instanceof Error ? e.message : "Diagram error"));
    return () => {
      alive = false;
    };
  }, [code, id]);
  if (err)
    return (
      <pre className="overflow-auto rounded-lg border p-3 font-mono text-xs text-destructive">
        {err}
        {"\n\n"}
        {code}
      </pre>
    );
  if (!svg) return <div className="h-24 animate-pulse rounded-lg border bg-card" aria-busy="true" aria-label="Rendering diagram" />;
  return <div className="my-4 overflow-x-auto rounded-lg border bg-card p-4 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}
