import { Config } from "./config";
import { discover } from "./discovery";
import { Probe, isEmbeddable, makeProbe } from "./running";

export interface ShowcaseItem {
  projectId: string;
  name: string;
  url: string;
  up: boolean;
  embeddable: boolean;
}

export interface ShowcaseEntry {
  projectId: string;
  name: string;
  url: string;
}

const showcaseProbe = makeProbe(3000);

/** Up = the URL answers with a status below 500. Embeddable only matters (and is only known) when up. */
export async function probeShowcase(entries: ShowcaseEntry[], probe: Probe = showcaseProbe): Promise<ShowcaseItem[]> {
  return Promise.all(
    entries.map(async (e) => {
      const r = await probe(e.url);
      const up = !!r && r.status < 500;
      return { ...e, up, embeddable: up && r ? isEmbeddable(r) : false };
    }),
  );
}

/** Entries in project-list order (pinned first, then by name); ids that no longer exist are skipped. */
export function showcaseEntries(cfg: Config, found: { id: string; name: string }[]): ShowcaseEntry[] {
  const rank = (id: string) => {
    const i = cfg.pinned.indexOf(id);
    return i < 0 ? Infinity : i;
  };
  return found
    .filter((f) => !!cfg.projects[f.id]?.showcaseUrl)
    .map((f) => ({ projectId: f.id, name: f.name, url: cfg.projects[f.id]!.showcaseUrl! }))
    .sort((a, b) => rank(a.projectId) - rank(b.projectId) || a.name.localeCompare(b.name));
}

export async function listShowcase(cfg: Config): Promise<ShowcaseItem[]> {
  return probeShowcase(showcaseEntries(cfg, await discover()));
}
