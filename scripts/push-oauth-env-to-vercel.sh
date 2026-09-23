#!/usr/bin/env bash
# Push social-login OAuth client id/secret pairs into a linked Vercel
# project's Environment Variables. Public shape (which vars, which
# environment) comes from a .config JSON file; secret values come from the
# local env file (the one automation/paths.yaml points at — same resolution
# as lib/env-loader.ts and automation/sync-config.sh — unless the config's
# "envFile" field explicitly overrides it). Values are piped directly into
# `vercel env add` via stdin and are never printed or logged.
#
# Prereqs:
#   1. npm i -g vercel   (or use `npx vercel` and adjust the VERCEL var below)
#   2. vercel login      (one-time device/browser auth)
#   3. cd into the directory that IS the linked Vercel project
#      (wherever you ran `vercel link`), then run this script from there.
#
# Usage:
#   chat/scripts/push-oauth-env-to-vercel.sh [config-file] [environment]
#   config-file: defaults to vercel-env.config.json next to this script
#   environment: overrides the "environment" field in the config file

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${1:-$SCRIPT_DIR/vercel-env.config.json}"
VERCEL="${VERCEL:-vercel}"
AUTOMATION_DIR="$SCRIPT_DIR/../../automation"

if ! command -v "$VERCEL" >/dev/null 2>&1; then
  echo "vercel CLI not found. Install with: npm i -g vercel" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq not found. Install with: brew install jq" >&2
  exit 1
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Config file not found: $CONFIG_FILE" >&2
  exit 1
fi

CONFIG_DIR="$(cd "$(dirname "$CONFIG_FILE")" && pwd)"
ENV_FILE_REL="$(jq -r '.envFile // empty' "$CONFIG_FILE")"
ENVIRONMENT="${2:-$(jq -r '.environment' "$CONFIG_FILE")}"

if [ -n "$ENV_FILE_REL" ]; then
  # Explicit override in the config file, relative to the config's own dir.
  ENV_FILE="$CONFIG_DIR/$ENV_FILE_REL"
elif [ -f "$AUTOMATION_DIR/paths.yaml" ] && yaml_value="$(grep -E '^env_file:' "$AUTOMATION_DIR/paths.yaml" | tail -n1 | cut -d ':' -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//')" && [ -n "$yaml_value" ]; then
  ENV_FILE="$AUTOMATION_DIR/$yaml_value"
else
  echo "No env file configured: pass one as [config-file]'s \"envFile\", or set env_file: in $AUTOMATION_DIR/paths.yaml (run automation/sync-config.sh once, or add it by hand)." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE" >&2
  echo "(source: $([ -n "$ENV_FILE_REL" ] && echo "envFile in $CONFIG_FILE" || echo "automation/paths.yaml"))" >&2
  exit 1
fi

if [ ! -f ".vercel/project.json" ]; then
  echo "No linked Vercel project in $(pwd). Run 'vercel link' here first." >&2
  exit 1
fi

get_value() {
  local key="$1" line val
  line="$(grep -m1 "^${key}=" "$ENV_FILE" || true)"
  [ -z "$line" ] && return 1
  val="${line#*=}"
  val="${val%\"}"; val="${val#\"}"
  val="${val%\'}"; val="${val#\'}"
  printf '%s' "$val"
}

echo "Config: $CONFIG_FILE"
echo "Target environment: $ENVIRONMENT"

mapfile -t VAR_ROWS < <(jq -c '.vars[]' "$CONFIG_FILE")
for row in "${VAR_ROWS[@]}"; do
  src="$(jq -r '.source' <<<"$row")"
  dst="$(jq -r '.target' <<<"$row")"
  if ! value="$(get_value "$src")"; then
    echo "  skip $dst (no value for $src in env file)"
    continue
  fi
  echo "  pushing $dst..."
  "$VERCEL" env rm "$dst" "$ENVIRONMENT" --yes >/dev/null 2>&1 || true
  printf '%s' "$value" | "$VERCEL" env add "$dst" "$ENVIRONMENT" >/dev/null
done

echo "Done. Vercel does not auto-rebuild on env var changes — trigger a new deployment."
