# Project Hub server API

Base: `http://127.0.0.1:4380` (container, see docs/container.md; `npm run dev`: `http://127.0.0.1:4310`), everything under `/api`. JSON in/out. Errors: `{ "error": "<code>" , ... }` with a 4xx status
(except pipelines, see below). Env: `PROJECT_HUB_PORT`, `PROJECT_HUB_CONFIG` (config path override).

## Types

```ts
Commit   = { hash, subject, date /* ISO */ }
Project  = { id, name, path, remoteUrl: string|null, provider: "github"|"gitlab"|"other"|null, host: string|null,
             remotePath: string|null, defaultBranch, branch: string|null, dirty: number, lastCommit: Commit|null,
             ahead, behind /* vs upstream */, worktreeCount, stack: ("node"|"django"|"docker"|"python")[],
             backlog: {open, done}|null, pinned: boolean, hidden: boolean }
Worktree = { path, branch: string|null, head, isMain: boolean, dirty, ahead, behind /* vs origin/<default> */, commitsAhead: Commit[] /* max 50 */ }
Preview  = { id, projectId, worktreePath, port, url, status: "installing"|"starting"|"running"|"stopped"|"failed", command, cwd, issues: string[], browser: { status: "none"|"open", cdpUrl: string|null } }
  `issues`: deduped (max 20) problems parsed from the dev server output, e.g. `missing dependency: zustand`, `missing tool: vite`,
  `node_modules missing in worktree: set devCommand`. The Hub never fixes them; the project's own agents read and fix them.
```

Project id = folder name; on collision `<parent>-<name>`.

## Projects
- `GET /api/projects[?all=1]` -> `Project[]` (pinned first, then last commit desc; hidden excluded unless `all=1`).
- `GET /api/projects/:id` -> `Project & { worktrees: Worktree[] }`.
- `POST /api/projects/:id/pin` | `/hide` -> toggle, `{ id, pinned }` / `{ id, hidden }`.

## Worktrees
- `GET /api/projects/:id/worktrees` -> `Worktree[]` (first is the main checkout).
- `GET /api/projects/:id/worktrees/diff?path=<worktree path>` ->
  `{ commits: Commit[], files: [{path, additions, deletions, firstChangedLine}], patch: string, truncated: boolean }`.
  Diff = working tree vs merge-base with `origin/<default>` (includes uncommitted tracked changes). Patch capped at 200 KB.
  404 `worktree_not_found` if `path` is not one of the project's worktrees.

## Previews
- `POST /api/previews { projectId, worktreePath }` -> `Preview`. 422 `{ error: "no_dev_command", hint }` when nothing detectable.
  Status goes `installing` (npm install, only if node_modules missing) -> `starting` -> `running` (port accepts TCP) | `failed` | `stopped`.
  `url` is replaced by the first `http://localhost|127.0.0.1:PORT` seen in output.
- `GET /api/previews` -> `Preview[]`. `GET /api/previews/:id` -> `Preview` (404 `preview_not_found`).
  `DELETE /api/previews/:id` -> `{ ok: true }` (kills the process group). If this preview had the agent browser open and no other
  running preview of the project does, the project's browser is closed too (helper errors ignored).
- `POST /api/previews/:id/browser` -> `{ cdpUrl, reused }`: opens the preview URL in the project's agent Chrome (one per project, CDP on 127.0.0.1;
  launched by the host helper over `~/.local/state/project-hub/browser.sock`, env `PROJECT_HUB_BROWSER_SOCK` overrides). A running browser gets a new tab (`reused: true`).
  404 `preview_not_found`, 409 `preview_not_running`, 503 `browser_helper_unavailable`, 502 with the helper's error code otherwise. Can take ~20 s on a cold start.
- `DELETE /api/previews/:id/browser` -> `{ ok: true }`: closes the project's browser; every preview of the project goes back to `browser.status: "none"`.
  409 `browser_not_owned` when the Chrome was not launched by the helper. The Hub does not reconcile browsers at boot.
- `GET /api/previews/:id/logs` -> SSE. Events: `log` (data = JSON string, one line; backlog replayed first, ring of 1000) `status` (data = JSON string) and `issues` (data = JSON string[], sent on connect and on change).

## Showcase
- `GET /api/showcase` -> `[{ projectId, name, url, up, embeddable }]` for every project with `projects[id].showcaseUrl`
  (ids that no longer exist are skipped), pinned first then by name. `up` = `GET url` answers with status < 500 within 3 s;
  `embeddable` = framing allowed (false when down).

## Running servers
- `GET /api/running` -> `RunningItem[]`: `{ kind: "hub"|"process"|"docker", url, port, projectId?, worktreePath?, branch?, label, pid?, container?, previewId? }`.
  Hub previews (not stopped/failed) plus every TCP listener (`ss -ltnpH`) whose process cwd lies in a project/worktree,
  plus docker containers (compose `working_dir` label). Hub ports and the hub itself are excluded; deduped by port.
  `previewId` is set for `hub` items (stop via `DELETE /api/previews/:id`).

## Quota
- `GET /api/quota` -> `{ claude, codex, agy, available }`; platforms listed in config `quotaHidden` are not read at all and come back `null`, hidden models (`claude:<model>`, `agy:<group>`) are filtered out; `available` is every id Settings can toggle (`claude`, `codex`, `agy` always, plus the model ids of the platforms that were read, before filtering); claude may carry `models: Array<{ name, sevenDay }>` (per-model weekly windows, live source only); claude/codex are `{ fiveHour, sevenDay, updatedAt, plan?, source? } | null`, agy is `Array<{ name } & that> | null` (one per model group, read from `~/.local/state/project-hub/agy-quota.tsv`, written by the host timer `deploy/agy-quota.sh`); `source` is `live` or `file`; window = `{ pct, resetsAt (ISO|null), reset }`.
  Claude is read live from `api.anthropic.com/api/oauth/usage` using the OAuth token in `~/.claude/.credentials.json` (server-side only), cached 5 min and shared across clients; on any failure it falls back to `~/.claude/state/usage/latest.json` (`source: file`). Codex comes from the newest rollout files.
  A window already past its reset reports `pct: 0, reset: true`.

## Sessions
- `GET /api/projects/:id/sessions` -> up to 20 `{ id, cwd, lastActivity, active, title, model, subagents[] }`, newest first.
  `active` = file changed in the last 5 min. Subagent = `{ id, description, agentType, model, finished, lastActivity, active }`.
  Includes sessions started in the project's worktrees.

## Obsidian vault
- `GET /api/projects/:id/vault` -> `{ exists, root, notes: [{ path, title, summary? }] }`. A vault is a directory with `.obsidian` (project root or `docs/`).
- `GET /api/projects/:id/vault/note?path=<rel.md>` -> `text/markdown`. 400 on traversal/absolute/non-`.md`/dot segments; 404 `note_not_found`.

## Open in VS Code
- `POST /api/open { path, file?, line? }` -> `{ ok: true, url: "vscode://file/<abs>[:<line>]" }`; the web
  app navigates to `url` so the host's VS Code opens it (the server may run in a container). `path` absolute, must be inside a project or one of its worktrees,
  `file` relative to `path` (or absolute, same containment). Else 400 `{ error }`.

## Pipelines
- `GET /api/projects/:id/pipelines` -> always HTTP 200 (404 only for unknown project):
  `{ host, provider, runs: [{ id, status: "success"|"failed"|"running"|"pending"|"canceled"|"skipped", ref, sha, title, createdAt, durationSec: number|null, url }] }`
  or `{ error: "no_token"|"not_found"|"unsupported"|"upstream", host }`. Cached 30 s per project.
  GitLab runs get `durationSec` from `GET /pipelines/:pid` and `title` from the commit (`/repository/commits/:sha`); each falls back to `null` / `ref` on per-item failure. 401 -> `no_token`, 404 -> `not_found`, other -> `upstream`.

## Backlog (`<project>/docs/backlog.md`)
```ts
BacklogState = { exists, raw, items: [{ line /* 1-based */, text /* first line */, body /* first line + indented continuation lines, \n-joined */, done: boolean|null /* null = plain bullet */, section }], open, done }
```
- `GET /api/projects/:id/backlog` -> `BacklogState` (`exists:false` when missing).
- `PATCH /api/projects/:id/backlog { line, done, expectedText }` -> new `BacklogState`; 409 `{ error: "mismatch" }` if line no longer matches.
- `POST /api/projects/:id/backlog { section, text }` -> new `BacklogState` (item appended at end of section, section created if absent).
- `POST /api/projects/:id/backlog/create` -> `BacklogState` from template (`# Backlog`, `## Next`, `## Done`); 409 `exists` if present.

## Settings (`~/.config/project-hub/config.json`, mode 600)
- `GET /api/settings` -> `{ roots, scanDepth, pinned, hidden, quotaHidden, tokens: {host: "glpa…4f2c"}, projects: {id: {devCommand?, devCwd?, showcaseUrl?}} }`.
- `PUT /api/settings` (partial body, same shape) -> updated view. A token equal to its mask keeps the stored value; empty string removes it.
  `tokens` in the body replaces the whole map (hosts omitted are removed).
