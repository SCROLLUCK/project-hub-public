import { Eye, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState, RowsSkeleton } from "@/components/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAllProjects, useQuota, useSaveSettings, useSettings } from "@/lib/api";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const q = useSettings();
  const all = useAllProjects();
  const save = useSaveSettings();
  const quota = useQuota();
  const [root, setRoot] = useState("");
  const [host, setHost] = useState("");
  const [tok, setTok] = useState("");
  const [scProject, setScProject] = useState("");
  const [scUrl, setScUrl] = useState("");
  const [edit, setEdit] = useState<Record<string, string>>({});

  if (q.isLoading) return <div className="p-4 md:p-6"><RowsSkeleton rows={6} /></div>;
  if (q.isError) return <div className="p-4 md:p-6"><ErrorState error={q.error} onRetry={() => void q.refetch()} /></div>;
  const s = q.data;
  if (!s) return null;

  const put = (patch: Parameters<typeof save.mutate>[0], ok?: string) =>
    save.mutate(patch, { onSuccess: () => ok && toast.success(ok), onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save") });
  const showcase = Object.entries(s.projects).filter(([, c]) => c.showcaseUrl);
  const scValid = /^https?:\/\/\S+$/i.test(scUrl.trim());
  const setShowcaseUrl = (id: string, url: string | null) => {
    const { showcaseUrl: _drop, ...rest } = s.projects[id] ?? {};
    put({ projects: { ...s.projects, [id]: url ? { ...rest, showcaseUrl: url } : rest } }, url ? "Saved" : undefined);
  };
  const hiddenProjects = (all.data ?? []).filter((p) => s.hidden.includes(p.id));

  const PLATFORMS = [["claude", "Claude"], ["codex", "Codex"], ["agy", "agy (Antigravity)"]] as const;
  const available = quota.data?.available ?? [];
  const toggleQuota = (id: string, on: boolean) =>
    put({ quotaHidden: on ? s.quotaHidden.filter((x) => x !== id) : [...s.quotaHidden, id] });
  const QuotaBox = ({ id, label }: { id: string; label: string }) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!s.quotaHidden.includes(id)} onChange={(e) => toggleQuota(id, e.target.checked)} />
      {label}
    </label>
  );

  return (
    <div className="flex max-w-3xl flex-col gap-10 p-4 md:p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Block title="Quota">
        <p className="text-sm text-muted-foreground">Platforms and models shown in the top bar. Unchecked platforms are not read.</p>
        <ul className="flex flex-col gap-2">
          {PLATFORMS.map(([id, label]) => {
            const models = available.filter((a) => a.startsWith(`${id}:`));
            return (
              <li key={id} className="flex flex-col gap-1">
                <QuotaBox id={id} label={label} />
                {!s.quotaHidden.includes(id) && models.length > 0 && (
                  <ul className="ml-6 flex flex-col gap-1">
                    {models.map((m) => (
                      <li key={m}>
                        <QuotaBox id={m} label={m.slice(id.length + 1)} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Block>

      <Block title="Roots">
        {s.roots.length === 0 && <p className="text-sm text-muted-foreground">No roots</p>}
        <ul className="flex flex-col gap-1">
          {s.roots.map((r) => (
            <li key={r} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{r}</span>
              <Button variant="ghost" size="icon" aria-label={`Remove ${r}`} onClick={() => put({ roots: s.roots.filter((x) => x !== r) })}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!root.trim()) return;
            put({ roots: [...s.roots, root.trim()] });
            setRoot("");
          }}
        >
          <Input aria-label="New root path" placeholder="/home/you/projects" value={root} onChange={(e) => setRoot(e.target.value)} className="font-mono" />
          <Button type="submit" variant="outline" disabled={!root.trim()}>
            <Plus /> Add
          </Button>
        </form>
      </Block>

      <Block title="Tokens">
        <ul className="flex flex-col gap-2">
          {Object.entries(s.tokens).map(([h, masked]) => (
            <li key={h} className="flex flex-wrap items-center gap-2">
              <span className="w-44 shrink-0 truncate font-mono text-sm">{h}</span>
              <Input
                type="password"
                aria-label={`Token for ${h}`}
                value={edit[h] ?? masked}
                onChange={(e) => setEdit({ ...edit, [h]: e.target.value })}
                className="min-w-40 flex-1 font-mono"
                autoComplete="off"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={edit[h] === undefined}
                onClick={() => {
                  put({ tokens: { ...s.tokens, [h]: edit[h] ?? masked } }, "Saved");
                  setEdit(({ [h]: _drop, ...rest }) => rest);
                }}
              >
                Save
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove token for ${h}`}
                onClick={() => put({ tokens: Object.fromEntries(Object.entries(s.tokens).filter(([k]) => k !== h)) })}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        {Object.keys(s.tokens).length === 0 && <p className="text-sm text-muted-foreground">No tokens</p>}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!host.trim() || !tok.trim()) return;
            put({ tokens: { ...s.tokens, [host.trim()]: tok.trim() } }, "Saved");
            setHost("");
            setTok("");
          }}
        >
          <Input aria-label="Host" placeholder="github.com" value={host} onChange={(e) => setHost(e.target.value)} className="w-44 font-mono" />
          <Input aria-label="Token" type="password" placeholder="Token" value={tok} onChange={(e) => setTok(e.target.value)} className="min-w-40 flex-1 font-mono" autoComplete="off" />
          <Button type="submit" variant="outline" disabled={!host.trim() || !tok.trim()}>
            <Plus /> Add host
          </Button>
        </form>
      </Block>

      <Block title="Hidden projects">
        {all.isLoading && <RowsSkeleton rows={2} className="h-8" />}
        {all.isError && <ErrorState error={all.error} onRetry={() => void all.refetch()} />}
        {all.isSuccess && hiddenProjects.length === 0 && <p className="text-sm text-muted-foreground">None hidden</p>}
        <ul className="flex flex-col gap-1">
          {hiddenProjects.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
              <Button variant="outline" size="sm" onClick={() => put({ hidden: s.hidden.filter((x) => x !== p.id) })}>
                <Eye /> Unhide
              </Button>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Showcase">
        {showcase.length === 0 && <p className="text-sm text-muted-foreground">No apps in the showcase</p>}
        <ul className="flex flex-col gap-1">
          {showcase.map(([id, c]) => (
            <li key={id} className="flex items-center gap-2">
              <span className="w-44 shrink-0 truncate text-sm font-medium">{all.data?.find((p) => p.id === id)?.name ?? id}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{c.showcaseUrl}</span>
              <Button variant="ghost" size="icon" aria-label={`Remove ${id} from the showcase`} onClick={() => setShowcaseUrl(id, null)}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!scProject || !scValid) return;
            setShowcaseUrl(scProject, scUrl.trim());
            setScProject("");
            setScUrl("");
          }}
        >
          <select
            aria-label="Project"
            value={scProject}
            onChange={(e) => setScProject(e.target.value)}
            className="h-9 w-44 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">Project</option>
            {(all.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Input
            aria-label="Showcase URL"
            placeholder="http://my-app.local:8889"
            value={scUrl}
            onChange={(e) => setScUrl(e.target.value)}
            aria-invalid={scUrl.trim() !== "" && !scValid}
            className="min-w-40 flex-1 font-mono"
          />
          <Button type="submit" variant="outline" disabled={!scProject || !scValid}>
            <Plus /> Add
          </Button>
        </form>
      </Block>
    </div>
  );
}
