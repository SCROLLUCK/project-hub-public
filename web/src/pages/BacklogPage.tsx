import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, ListChecks, Plus } from "lucide-react";
import { Fragment, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useParams } from "react-router";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { EmptyState, ErrorState, RowsSkeleton, Stat } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { api, ApiError, useBacklog, type BacklogItem, type BacklogState } from "@/lib/api";

function sectionsOf(s: BacklogState): string[] {
  const names: string[] = [];
  for (const l of s.raw.split("\n")) {
    const m = /^##\s+(.+?)\s*$/.exec(l);
    if (m?.[1] && !names.includes(m[1])) names.push(m[1]);
  }
  for (const i of s.items) if (i.section && !names.includes(i.section)) names.push(i.section);
  return names;
}

const MD_DETAIL =
  "mt-1 text-sm text-muted-foreground [&_a]:underline [&_code]:font-mono [&_code]:text-xs [&_li]:ml-5 [&_li]:list-disc [&_p]:my-1 [&_strong]:font-semibold [&_strong]:text-foreground";

function BacklogRow({ item: i, onToggle }: { item: BacklogItem; onToggle: (done: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const rest = i.body.includes("\n") ? i.body.slice(i.body.indexOf("\n") + 1) : "";
  return (
    <li className="rounded-md px-1 py-1.5 hover:bg-accent/50">
      <div className="flex items-start gap-3">
        {i.done === null ? (
          <span className="mt-2 ml-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
        ) : (
          <Checkbox id={`bl-${i.line}`} className="mt-0.5" checked={i.done} onCheckedChange={(v: boolean | "indeterminate") => onToggle(v === true)} />
        )}
        <label htmlFor={i.done === null ? undefined : `bl-${i.line}`} className={`min-w-0 flex-1 ${i.done ? "cursor-pointer text-muted-foreground line-through" : i.done === false ? "cursor-pointer" : ""}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ p: ({ children }) => <Fragment>{children}</Fragment> }}>
            {i.text}
          </ReactMarkdown>
        </label>
        {rest && (
          <Button variant="ghost" size="icon" className="-my-1 size-7 shrink-0" aria-expanded={open} aria-label={open ? "Hide details" : "Show details"} onClick={() => setOpen((o) => !o)}>
            <ChevronRight className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
          </Button>
        )}
      </div>
      {rest && open && (
        <div className={`ml-8 ${MD_DETAIL}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{rest}</ReactMarkdown>
        </div>
      )}
    </li>
  );
}

function AddItem({ onAdd, section }: { onAdd: (section: string, text: string) => void; section: string }) {
  const [text, setText] = useState("");
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onAdd(section, text.trim());
        setText("");
      }}
    >
      <Input aria-label={`Add item to ${section}`} placeholder="Add item" value={text} onChange={(e) => setText(e.target.value)} className="h-9" />
      <Button type="submit" variant="outline" size="sm" className="h-9" disabled={!text.trim()}>
        <Plus /> Add
      </Button>
    </form>
  );
}

export function BacklogPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const q = useBacklog(id);
  const key = ["backlog", id];
  const path = `/projects/${encodeURIComponent(id)}/backlog`;

  const toggle = useMutation({
    mutationFn: (v: { item: BacklogItem; done: boolean }) =>
      api<BacklogState>(path, { method: "PATCH", json: { line: v.item.line, done: v.done, expectedText: v.item.text } }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<BacklogState>(key);
      if (prev)
        qc.setQueryData<BacklogState>(key, {
          ...prev,
          items: prev.items.map((i) => (i.line === v.item.line ? { ...i, done: v.done } : i)),
        });
      return { prev };
    },
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      if (e instanceof ApiError && e.status === 409) toast.error("Backlog changed on disk, reloaded");
      else toast.error(e instanceof Error ? e.message : "Could not save");
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  const add = useMutation({
    mutationFn: (v: { section: string; text: string }) => api<BacklogState>(path, { method: "POST", json: v }),
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add"),
  });

  const create = useMutation({
    mutationFn: () => api<BacklogState>(`${path}/create`, { method: "POST" }),
    onSuccess: (data) => {
      qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create"),
  });

  if (q.isLoading) return <RowsSkeleton rows={8} className="h-8" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const s = q.data;
  if (!s) return null;
  if (!s.exists)
    return (
      <EmptyState icon={<ListChecks />} title="No backlog file">
        <Button size="sm" className="mt-2" onClick={() => create.mutate()} disabled={create.isPending}>
          Create backlog
        </Button>
      </EmptyState>
    );

  const sections = sectionsOf(s);
  const total = s.open + s.done;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {total > 0 && (
        <div className="flex gap-8">
          <Stat value={s.open} label="Open" />
          <Stat value={s.done} label="Done" />
          <Stat value={total} label="Total" />
        </div>
      )}

      {sections.map((name) => {
        const items = s.items.filter((i) => i.section === name);
        return (
          <section key={name} aria-label={name}>
            <h2 className="mb-2 text-base font-semibold">{name}</h2>
            {items.length > 0 && (
              <ul className="flex flex-col">
                {items.map((i) => (
                  <BacklogRow key={i.line} item={i} onToggle={(done) => toggle.mutate({ item: i, done })} />
                ))}
              </ul>
            )}
            <AddItem section={name} onAdd={(section, text) => add.mutate({ section, text })} />
          </section>
        );
      })}

      <details className="group rounded-lg border">
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold">
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden /> Raw markdown
        </summary>
        <div className="border-t px-4 py-3 text-sm [&_a]:underline [&_code]:font-mono [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:my-1 [&_table]:my-2 [&_td]:border [&_td]:px-2 [&_th]:border [&_th]:px-2">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.raw}</ReactMarkdown>
        </div>
      </details>
    </div>
  );
}
