# Running the hub in a container

The deployed hub is one container serving the API and the built web app on
**http://127.0.0.1:4380** (outside the ports other projects use and below the ephemeral range
that previews take ports from). `npm run dev` (4310/4311) stays for working on the hub itself.

Optional local name **http://project-hub.local:4380** — one line in `/etc/hosts` (once per
machine):

```bash
echo '127.0.0.1 project-hub.local' | sudo tee -a /etc/hosts
```

Scripts and agents call the API on `127.0.0.1:4380`, so they work without the hosts entry.

```bash
./deploy/up.sh                 # build + (re)start, waits until the API answers
docker logs -f project-hub     # logs
docker compose down            # stop (previews die with it)
```

Redeploy after merging to master: `./deploy/up.sh` from the main checkout.

## Why the compose file looks like this

The hub drives the host: it runs git on every repo, starts dev servers, lists docker stacks and
reads Claude/Codex data. So the container is a thin wrapper, not a sandbox:

| Setting | Reason |
|---|---|
| `${HOME}:${HOME}` mount, `HOME` env | Roots, worktrees, `~/.config/project-hub`, `~/.claude`, `~/.codex`, Obsidian's vault list and the cwd paths stored in Claude sessions resolve to the same paths as on the host. Any root added in Settings under `$HOME` works. |
| `user: HUB_UID:HUB_GID` | Files it writes (backlog, `node_modules`, config) belong to you. |
| `network_mode: host` | Previews bind `127.0.0.1:<port>` and the browser reaches them; `ss` sees host listeners. |
| `pid: host` | `/proc/<pid>/cwd` maps a listening process to its project (`/api/running`). |
| docker socket + `group_add DOCKER_GID` | `docker ps` for compose stacks, and `docker compose` dev commands. |
| `GITHUB_TOKEN` env | `gh` keeps its token in the system keyring, which the container cannot read; `up.sh` passes `gh auth token`. |
| Ubuntu 24.04 base, Node 24.15, python3 | Same glibc/python as an Ubuntu 24.04-based host, so `node_modules` and venvs work on both sides. |

Projects whose dev command needs another toolchain (Go, Ruby, a different Node major) need it in
the `Dockerfile`, or a `devCommand` that runs through `docker compose`.

## agy quota

`agy` (Antigravity CLI) keeps its login in the host keyring, so it cannot run in the container.
`deploy/up.sh` installs a user timer (`project-hub-agy-quota.timer`, every 5 min) that runs
`deploy/agy-quota.sh` on the host and writes `~/.local/state/project-hub/agy-quota.tsv`
(`$XDG_STATE_HOME` respected); the server reads that file through the `$HOME` mount. The file is
only replaced when agy returns valid lines, so a failed run keeps the last reading (shown muted
as stale after 1 h). Check with `systemctl --user list-timers project-hub-agy-quota.timer`.

## Browser helper

Chrome needs the host's display, which the container does not have. `deploy/up.sh` installs a user
service (`project-hub-browser.service`, gets `DISPLAY`/`XAUTHORITY`/`WAYLAND_DISPLAY` from the
graphical session via `systemctl --user import-environment`) running `deploy/browser-helper.py`,
which listens on `~/.local/state/project-hub/browser.sock` (JSON line per connection: `launch`,
`close`, `list`). It launches `/usr/bin/google-chrome` (override: `PROJECT_HUB_CHROME`) with
`--remote-debugging-port=0` on `127.0.0.1`, one persistent profile per project in
`~/.local/state/project-hub/browser-profiles/<projectId>`, and reuses the project's Chrome (new tab)
when its `DevToolsActivePort` still answers, including one an agent started by hand. Tests:
`python3 -m unittest discover -s deploy/test`.

Security: the socket is mode 0600; only `http://localhost|127.0.0.1:<port>/...` URLs are accepted and
Chrome gets no free-form args; projectId is `[A-Za-z0-9._-]+`. CDP on 127.0.0.1 is full control of
that profile (cookies, tokens) for any local process, fine on a single-user dev machine. Never point
the helper at the daily Chrome profile. `close` only stops Chromes the helper launched.

## Open in VS Code

The server returns a `vscode://file/...` URL and the browser opens it (the first time, the
browser asks to allow opening VS Code links). A file click opens that file at the line in the
VS Code window that has it, or in the last active one.
