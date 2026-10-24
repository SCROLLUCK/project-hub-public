import { BookOpen, FileText } from "lucide-react";
import { useMemo, type ComponentProps } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Mermaid } from "@/components/Mermaid";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/States";
import { Button } from "@/components/ui/button";
import { useVault, useVaultNote } from "@/lib/api";
import { linkifyWikilinks, resolveWikilink, stripFrontmatter } from "@/lib/wikilinks";
import { cn } from "@/lib/utils";

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function joinPath(dir: string, rel: string) {
  const out = dir ? dir.split("/") : [];
  for (const part of rel.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

export function DocsPage() {
  const { id = "", "*": splat = "" } = useParams();
  const nav = useNavigate();
  const loc = useLocation();
  const vault = useVault(id);
  const notes = vault.data?.notes ?? [];
  const paths = useMemo(() => notes.map((n) => n.path), [notes]);
  const base = `/p/${encodeURIComponent(id)}/docs`;
  const toNote = (p: string) => `${base}/${p.split("/").map(encodeURIComponent).join("/")}`;

  const current = splat ? decodeURIComponent(splat) : null;
  const note = useVaultNote(id, current && paths.includes(current) ? current : null);

  if (vault.isLoading) return <RowsSkeleton rows={6} className="h-8" />;
  if (vault.isError) return <ErrorState error={vault.error} onRetry={() => void vault.refetch()} />;
  if (!vault.data?.exists || notes.length === 0) return <EmptyState icon={<BookOpen />} title="No Obsidian vault in this project" />;

  if (!current) {
    const start = paths.find((p) => p.toLowerCase() === "index.md") ?? paths.find((p) => p.toLowerCase().endsWith("/index.md")) ?? paths[0]!;
    return <Navigate to={toNote(start)} replace />;
  }

  const root = vault.data.root;
  const obsidian = root ? `obsidian://open?path=${encodeURIComponent(`${root}/${current}`)}` : null;
  const body = note.data ? linkifyWikilinks(stripFrontmatter(note.data)) : "";

  const A = ({ href = "", children }: ComponentProps<"a">) => {
    if (href.startsWith("wikilink:")) {
      const target = decodeURIComponent(href.slice("wikilink:".length));
      const hit = resolveWikilink(target, paths);
      if (!hit) return <span className="text-muted-foreground underline decoration-dotted" title="Note not found">{children}</span>;
      return <Link to={toNote(hit)} className="font-semibold underline underline-offset-2">{children}</Link>;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">{children}</a>;
    const [pathPart = ""] = href.split("#");
    if (/\.md$/i.test(pathPart)) {
      const target = joinPath(dirOf(current), decodeURIComponent(pathPart));
      if (paths.includes(target)) return <Link to={toNote(target)} className="font-semibold underline underline-offset-2">{children}</Link>;
    }
    return <a href={href} className="underline underline-offset-2">{children}</a>;
  };

  const tree = notes.reduce<Record<string, typeof notes>>((acc, n) => {
    (acc[dirOf(n.path)] ??= []).push(n);
    return acc;
  }, {});
  const dirs = Object.keys(tree).sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <nav aria-label="Notes" className="flex min-w-0 flex-col gap-3 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
        {dirs.map((d) => (
          <div key={d} className="flex flex-col gap-0.5">
            {d && <div className="px-2 pb-0.5 font-mono text-xs font-semibold uppercase tracking-wide text-muted-foreground">{d}</div>}
            {tree[d]!.map((n) => (
              <button
                key={n.path}
                type="button"
                onClick={() => nav(toNote(n.path))}
                aria-current={n.path === current ? "page" : undefined}
                title={n.summary ?? n.path}
                className={cn("flex items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-accent", n.path === current && "bg-accent font-semibold")}
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{n.title}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <article className="min-w-0" key={loc.pathname}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{current}</span>
          {obsidian && (
            <Button variant="outline" size="sm" asChild>
              <a href={obsidian}>
                <BookOpen /> Open in Obsidian
              </a>
            </Button>
          )}
        </div>
        {note.isLoading && <RowsSkeleton rows={8} className="h-5" />}
        {note.isError && <ErrorState error={note.error} onRetry={() => void note.refetch()} />}
        {current && !paths.includes(current) && <EmptyState icon={<FileText />} title="Note not found" />}
        {note.data !== undefined && (
          <div className="docs-md max-w-3xl">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              urlTransform={(u) => (u.startsWith("wikilink:") ? u : defaultUrlTransform(u))}
              components={{
                a: A,
                h1: (p) => <h1 className="mb-4 mt-2 text-2xl font-semibold" {...p} />,
                h2: (p) => <h2 className="mb-3 mt-8 text-xl font-semibold" {...p} />,
                h3: (p) => <h3 className="mb-2 mt-6 text-base font-semibold" {...p} />,
                p: (p) => <p className="my-3 leading-7" {...p} />,
                ul: (p) => <ul className="my-3 list-disc pl-6 leading-7" {...p} />,
                ol: (p) => <ol className="my-3 list-decimal pl-6 leading-7" {...p} />,
                blockquote: (p) => <blockquote className="my-3 border-l-2 pl-4 text-muted-foreground" {...p} />,
                hr: () => <hr className="my-6" />,
                table: (p) => (
                  <div className="my-4 overflow-x-auto">
                    <table className="w-full text-left text-sm" {...p} />
                  </div>
                ),
                th: (p) => <th className="border-b px-3 py-2 font-semibold" {...p} />,
                td: (p) => <td className="border-b px-3 py-2 align-top" {...p} />,
                pre: ({ children }) => <>{children}</>,
                code: ({ className, children }) => {
                  const text = String(children).replace(/\n$/, "");
                  if (/language-mermaid/.test(className ?? "")) return <Mermaid code={text} />;
                  if (/language-/.test(className ?? "") || text.includes("\n"))
                    return <pre className="my-4 overflow-x-auto rounded-lg border bg-card p-3 font-mono text-xs leading-5"><code>{text}</code></pre>;
                  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;
                },
              }}
            >
              {body}
            </ReactMarkdown>
          </div>
        )}
      </article>
    </div>
  );
}
