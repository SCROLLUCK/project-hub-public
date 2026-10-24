#!/usr/bin/env bash
# Host-side job: agy keeps its login in the host keyring, so the container cannot run it.
# Writes `agy /quota` output to a file the server reads (same path inside the container).
set -u
# systemd user services do not get ~/.local/bin on PATH.
export PATH="$HOME/.local/bin:$PATH"
command -v agy >/dev/null 2>&1 || exit 0
# Settings > Quota: skip when agy is unchecked (quotaHidden in the Hub config).
if python3 -c 'import json,sys; sys.exit(0 if "agy" in json.load(open(sys.argv[1])).get("quotaHidden", []) else 1)' \
  "${PROJECT_HUB_CONFIG:-$HOME/.config/project-hub/config.json}" 2>/dev/null; then
  exit 0
fi
dir="${XDG_STATE_HOME:-$HOME/.local/state}/project-hub"
out="$(cd /tmp && timeout 60 agy -p /quota --print-timeout 40s 2>/dev/null)" || true
# valid line: group<TAB>limit<TAB>NN%<TAB>reset
printf '%s\n' "$out" | grep -qP '^[^\t]+\t[^\t]+\t[0-9.]+%\t[^\t]+$' || exit 0
mkdir -p "$dir"
tmp="$(mktemp "$dir/.agy-quota.XXXXXX")"
printf '%s\n' "$out" >"$tmp"
chmod 644 "$tmp"
mv -f "$tmp" "$dir/agy-quota.tsv"
