#!/usr/bin/env bash
# Build and (re)start the Project Hub container: http://project-hub.local:${PROJECT_HUB_PORT:-4380}
set -euo pipefail
cd "$(dirname "$0")/.."
export HUB_UID="$(id -u)" HUB_GID="$(id -g)"
export DOCKER_GID="$(stat -c %g /var/run/docker.sock)"
# gh keeps its token in the system keyring, which the container cannot read.
export GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
# agy cannot run in the container (login in the host keyring): a host timer writes its quota to a file.
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$unit_dir"
sed "s|^ExecStart=.*|ExecStart=$PWD/deploy/agy-quota.sh|" deploy/systemd/project-hub-agy-quota.service >"$unit_dir/project-hub-agy-quota.service"
cp deploy/systemd/project-hub-agy-quota.timer "$unit_dir/"
systemctl --user daemon-reload
systemctl --user enable --now project-hub-agy-quota.timer
# Chrome needs the host's display: the browser helper unit gets the graphical session env (unset ones are skipped).
sed "s|^ExecStart=.*|ExecStart=$PWD/deploy/browser-helper.py|" deploy/systemd/project-hub-browser.service >"$unit_dir/project-hub-browser.service"
systemctl --user daemon-reload
systemctl --user import-environment DISPLAY XAUTHORITY WAYLAND_DISPLAY || true
systemctl --user enable project-hub-browser.service
systemctl --user restart project-hub-browser.service
docker compose up -d --build "$@"
port="${PROJECT_HUB_PORT:-4380}"
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:${port}/api/projects" >/dev/null && { echo "Project Hub up: http://project-hub.local:${port} (http://127.0.0.1:${port})"; exit 0; }
  sleep 1
done
echo "Project Hub did not answer on ${port}; see: docker logs project-hub" >&2
exit 1
