# Project Hub — spec (MVP)

A local web app that gathers every project you develop: repos, worktrees with live
previews, CI pipelines (GitHub + GitLab), backlog with a checklist, and one-click "open in
VS Code". Runs only on this machine (it executes git and dev servers), bound to 127.0.0.1.

## Stack

- `server/` — Node 24, TypeScript, Fastify, run with `tsx`. Tests: vitest.
- `web/` — Vite + React + TypeScript + Tailwind v4 + shadcn/ui + react-router + TanStack Query
  + lucide-react + react-markdown/remark-gfm.
- Root `package.json`: `npm run dev` starts both (concurrently); server on 127.0.0.1:4310,
  web on 127.0.0.1:4311 proxying `/api` to the server. `npm test` runs server tests.
- Deployed: a container (`./deploy/up.sh`) serves API and built web on **127.0.0.1:4380** (name: `project-hub.local`),
  `restart: unless-stopped`. Details in `docs/container.md`.
- All UI strings, code, identifiers in English.

## Config — `~/.config/project-hub/config.json` (never in the repo)

```json
{
  "roots": ["~/code"],
  "scanDepth": 2,
  "pinned": ["my-app"],
  "hidden": [],
  "quotaHidden": [],
  "tokens": { "gitlab.com": "glpat-...", "git.example.com": "..." },
  "projects": { "my-app": { "devCommand": "npm run dev -- --port {port}", "devCwd": "frontend", "showcaseUrl": "http://my-app.local:8889" } }
}
```

- Created on first run with empty roots (the dashboard points to Settings). GitHub token: `gh auth token` (fallback env `GITHUB_TOKEN`).
  GitLab: `tokens[host]`, fallback env `GITLAB_TOKEN` for gitlab.com.
- Tokens are never sent to the browser in clear: the settings API returns them masked.

## Discovery

- Every directory under `roots` (up to `scanDepth`) that holds a `.git` **directory** is a
  project. `~/code/group/*` is depth 2. A `.git` *file* means a linked worktree —
  those come from `git worktree list --porcelain` of their main repo, not from the scan.
- Project id = folder name (disambiguate with parent folder on collision).

## Data per project

name, path, remote URL, provider (`github` | `gitlab` | `other`) and host + project path parsed
from the remote (handle `git@host:o/r.git`, `ssh://git@host:776/g/sub/r.git`, `https://host/g/r.git`),
default branch (`origin/HEAD`, fallback master/main), current branch, dirty file count, last
commit (hash, subject, ISO date), ahead/behind upstream, worktree count, stack hints
(package.json, manage.py, docker-compose), backlog summary (open/done counts or absent).

## Worktrees

For each worktree: path, branch, HEAD, dirty count, ahead/behind vs default branch, commits
ahead (hash, subject, date), diff vs merge-base with default branch: `--stat` list plus the
unified diff per file (cap ~200 KB per request, say it was truncated).

**Preview**: start the worktree's dev server on a free port and show it in an iframe.
- Command: `projects[id].devCommand`/`devCwd` from config; else first of `.`, `frontend/`,
  `web/`, `client/` with a `package.json` having a `dev` script → `npm run dev`, passing the port
  as env `PORT` and, for Vite, `-- --port {port} --strictPort --host 127.0.0.1`.
- `devCommand` placeholders: `{port}`, `{worktree}`, `{cwd}`, `{main}` (main checkout, resolved
  from the worktree's `.git` file). A `devCommand` owns its dependencies: the hub never installs
  for it (logs `install skipped`) and passes `HUB_PREVIEW_CONTAINER=project-hub-<id>`; on
  stop/exit the hub runs `docker rm -f` on that name.
- Auto-detected command, `node_modules` missing: in the main checkout run `npm install` first
  (logged); in a linked worktree never install, the preview fails with a hint to set `devCommand`.
- Parse dev server output for missing dependencies/tools (vite unresolved imports, node `Cannot find module`, shell `not found`) into `issues: string[]`
  (deduped, max 20; also the blocked-install case). Shown as an amber warning ("Fix in the project, not in the Hub."); the Hub never fixes them.
- Agent browser: `POST/DELETE /api/previews/:id/browser` ask the host helper (`deploy/browser-helper.py`, Unix socket) to open the
  preview in the project's CDP-enabled Chrome / close it; `Preview.browser = { status: "none"|"open", cdpUrl }`. Stopping a preview closes
  the browser unless another running preview of the project keeps it open. No reconciliation at hub boot (windows survive a restart).
- Keep a log ring buffer per preview; stream it with SSE (`/api/previews/:id/logs`).
- Detect the URL from stdout (`http://(localhost|127.0.0.1):\d+`), else `http://127.0.0.1:{port}`.
- Stop kills the process group. All previews are killed when the server exits.
- No detectable command → the UI says so and points to the config key.

## Open in VS Code

`POST /api/open { path, file?, line? }` → `{ url }` with `vscode://file/<path>` or
`vscode://file/<file>:<line>`; the browser opens it, so the host VS Code opens it even when the
server runs in a container. Only paths inside a
known project/worktree are accepted. Used from: project header, each worktree, each diff file
(opens at the first changed line), the backlog file.

## Pipelines

`GET /api/projects/:id/pipelines` → last 15 runs, normalized:
`{ id, status: success|failed|running|pending|canceled|skipped, ref, sha, title, createdAt, durationSec, url }`.
- GitHub: `GET /repos/{owner}/{repo}/actions/runs?per_page=15`.
- GitLab (any host): `GET https://{host}/api/v4/projects/{urlencoded path}/pipelines?per_page=15`
  (+ commit title via `sha` if cheap; else ref). Self-hosted SSH remotes on a custom port still
  use `https://{host}` for the API.
- No token → `{ error: "no_token", host }` and the UI offers a link to Settings. Cache 30 s.
- The dashboard shows the latest status per project (fetched lazily per row).

## Backlog — global convention: `docs/backlog.md`

`##` sections, items as `- [ ]` / `- [x]`. Plain bullets are allowed and rendered, but only
checkboxes count toward progress.
- `GET /api/projects/:id/backlog` → `{ exists, raw, items: [{ line, text, done, section }], open, done }`.
- `PATCH` toggle `{ line, done, expectedText }` → refuse (409) if that line no longer matches
  (another session edited the file); the UI refetches.
- `POST` add `{ section, text }` → appended at the end of that section (section created if absent).
- Missing file → UI offers "Create backlog" with a template (`# Backlog` + `## Next` + `## Done`).

## UI

Design: follow `design-system/project-hub/MASTER.md`
(ignore its "landing pattern" section — this is a dense dashboard). Dark by default, light
toggle. Mono font only for branches, hashes, paths. Style: emphasis by weight and
size, never colored background blocks; no yellow; a figure is a large number with a one-word
label; no explanatory blurbs inside cards. Status colors only on status badges.

Routes (URL is the state; F5 restores the view):
- `/` — Showcase (home): grid of live tiles, one per project with `projects[id].showcaseUrl` that
  answers (`GET /api/showcase`, refetched every 30 s). Same tile look as Previews; whole tile opens
  the app in a new tab; footer has the name, host:port (mono) and a small link to `/p/:id`.
  Offline entries are listed by name in one muted line below. Empty state points to Settings.
- `/projects` — project list: pinned first, then by last commit. Search box. Row: name, provider icon,
  current branch, dirty count, worktrees, last commit (relative), pipeline badge, backlog x/y.
  Row actions: pin, hide, open repository (new tab), open in VS Code. A small "N active" marker
  (tooltip) when Claude Code sessions in the project were active in the last 5 min. A compact
  "N running -> Previews" link next to the stats.
- `/p/:id/worktrees[/:wt]` — worktree list (each branch links to the remote `/tree/<branch>`,
  gitlab `/-/tree/<branch>`) + detail: preview panel first (start/stop, iframe, logs, open in
  browser tab), then commits ahead, files, diff viewer.
- `/previews` — grid of tiles, one per running server (`/api/running`): lazy iframe thumbnail
  (CSS-scaled, no pointer events), project, branch/worktree, port. Click opens a new tab; hub
  previews have a stop action and an "Open with agent" button (also in the worktree preview panel) that opens the
  preview in the agent browser and shows its CDP URL with a copy button; 503 shows "Browser helper not running — run deploy/up.sh". Empty state links to `/projects`. The top bar links here with
  the running count; each project header lists its own running servers.
- `/p/:id/sessions` — "Development": up to 20 Claude Code sessions (active dot, title, worktree,
  model, relative time), expandable to subagents (description, type, model, running/finished).
- `/p/:id/docs[/*note]` — only when the project has an Obsidian vault: note tree, rendered note
  (GFM, `[[wikilinks]]` by basename, mermaid in dark theme, frontmatter stripped, index.md
  default), "Open in Obsidian" button (`obsidian://open?path=`).
- Top bar: quota widget (Claude, Codex and agy, minus whatever is in config `quotaHidden`; hidden platforms are not read; Claude shows its enabled per-model weekly windows inline as small "Fable 7d 7%"; agy shows only its most-used model group inline, all groups in the tooltip; per window 5h/7d a small usage bar + percent + "resets in
  2h 10m"; red fill only at >= 90%; tooltip with reset time, data age and source live/local file;
  muted with its age when older than 1 h; refetched every 5 min and on window focus) and the Projects and Previews links; the logo goes to `/`.
- `/p/:id/pipelines` — table of runs with links.
- `/p/:id/backlog` — checklist with toggles, add item per section, rendered markdown below.
- `/settings` — roots, tokens per host (masked, editable), hidden projects, Quota (checkbox per platform and nested per model, saved to `quotaHidden`; opt-out so new sources appear by default), Showcase entries (project + http(s) URL).

## Done when

- `npm test` passes (backlog parse/toggle/add/409, remote parsing for the three URL shapes,
  dev-command detection).
- Against a real root: the list shows the repos; repos with worktrees show them; a GitHub repo
  shows Actions runs; a GitLab repo shows pipelines.
- Screenshots of every route at 1440 and 390 px reviewed against the MASTER checklist.
