/** Resolve `[[target|alias#heading]]` to a note path by basename or path suffix (mirrors server/src/vault.ts). */
export function resolveWikilink(target: string, notePaths: string[]): string | null {
  const name = (target.split("|")[0] ?? "").split("#")[0]!.trim().replace(/\.md$/i, "").toLowerCase();
  if (!name) return null;
  const hit = notePaths.filter((p) => {
    const lower = p.replace(/\.md$/i, "").toLowerCase();
    return lower === name || lower.endsWith(`/${name}`);
  });
  return hit.sort((a, b) => a.length - b.length)[0] ?? null;
}

/** Turn `[[note|alias]]` into a markdown link with a `wikilink:` scheme, skipping fenced code. */
export function linkifyWikilinks(md: string): string {
  let fenced = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line.replace(/\[\[([^\]\n]+)\]\]/g, (_m, inner: string) => {
        const [target = "", alias] = inner.split("|");
        const label = (alias ?? target.split("#")[0] ?? target).trim() || target;
        return `[${label.replace(/[[\]]/g, "")}](wikilink:${encodeURIComponent(inner)})`;
      });
    })
    .join("\n");
}

export function stripFrontmatter(md: string): string {
  return md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}
