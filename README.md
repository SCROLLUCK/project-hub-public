# Project Hub

A local dashboard for everyone who juggles many repositories and git worktrees on one machine.
It discovers your projects, shows their state at a glance, runs live previews of any worktree,
and keeps a Showcase grid of the apps you have deployed locally.

It runs only on your machine (it executes git and dev servers) and binds to `127.0.0.1`.

## Features

- **Project discovery** — scans configured root folders for git repos; per project: remote and
  provider (GitHub / GitLab), current branch, dirty files, last commit, ahead/behind, worktrees,
  stack hints.
- **Worktrees** — commits ahead of the default branch, changed files and a unified diff viewer.
- **Live previews** — starts a worktree's dev server on a free port, shows it in an iframe and
  streams its logs (SSE). Configurable `devCommand` with `{port}`, `{worktree}`, `{cwd}`,
  `{main}` placeholders; missing dependencies found in the log are surfaced as issues.
- **Running servers** — every listening dev server and docker compose stack mapped to its project.
- **Showcase** — home page grid of live tiles for the projects you deploy locally.
- **Pipelines** — latest GitHub Actions runs and GitLab pipelines (any host).
- **Backlog** — reads, toggles and adds items in each project's `docs/backlog.md` checklist.
- **Development** — recent Claude Code sessions and subagents per project.
- **Docs** — renders a project's Obsidian vault (wikilinks, mermaid).
- **Quota widget** — Claude, Codex and Antigravity (`agy`) usage, each platform optional.
- **Open in VS Code** — `vscode://` links for projects, worktrees, diff files and backlog lines.
- **Agent browser** — optional host helper that opens a preview in a per-project Chrome with
  CDP enabled, so a coding agent can drive the same page you are watching.

## Stack

- `server/` — Node 24, TypeScript, Fastify (run with `tsx`), vitest.
- `web/` — Vite, React, TypeScript, Tailwind CSS v4, shadcn/ui, react-router, TanStack Query.
- `deploy/` — Docker image + compose file, and small host-side helpers (Python / Bash, systemd
  user units).

## Requirements

- Linux with Node 24 and git (for development).
- Docker with the compose plugin (for the container).
- Optional: `gh` CLI (GitHub token), Google Chrome (agent browser), `agy` CLI (its quota),
  a systemd user session (host helpers installed by `deploy/up.sh`).

## Run in development

```bash
npm install
npm run dev      # API on 127.0.0.1:4310, web on http://127.0.0.1:4311 (proxies /api)
npm test         # server tests (vitest) + host helper tests (python unittest)
```

## Run as a container

```bash
cp .env.example .env   # optional: port and GitHub token
./deploy/up.sh         # build + (re)start, waits until the API answers
```

The hub is then on **http://127.0.0.1:4380**. `deploy/up.sh` also installs two systemd user
units on the host (the `agy` quota timer and the agent browser helper). Logs:
`docker logs -f project-hub`; stop: `docker compose down`.

The container is a thin wrapper, not a sandbox: it uses host networking and host PID, mounts
`$HOME` at the same path and the docker socket. See [docs/container.md](docs/container.md) for
why each setting is there and for the security notes on the browser helper.

## Configuration

Settings live in `~/.config/project-hub/config.json` (created on first run, never in the repo;
override the path with `PROJECT_HUB_CONFIG`) and are editable from the Settings page: root
folders, scan depth, pinned / hidden projects, tokens per git host (masked in the API), quota
sources and per-project `devCommand` / `showcaseUrl`. See
[config.example.json](config.example.json) and [.env.example](.env.example).

Tokens: GitHub uses `gh auth token` or `GITHUB_TOKEN`; GitLab uses the token set for that host
in Settings, with `GITLAB_TOKEN` as fallback for gitlab.com.

## Docs

- [SPEC.md](SPEC.md) — behavior of every feature and route.
- [server/API.md](server/API.md) — HTTP API reference.
- [docs/container.md](docs/container.md) — container and host helpers.

## License

MIT, see [LICENSE](LICENSE).
