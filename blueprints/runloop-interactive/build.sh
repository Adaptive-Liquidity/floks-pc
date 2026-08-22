#!/usr/bin/env bash
# Manually create/update the paid Runloop Blueprint. Do NOT run from ordinary CI.
# Requires RUNLOOP_API_KEY. Polls until build_complete, else dumps logs and fails.
# Do not dispatch runloop-c3b while this is still queued/building.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
if [ -z "${RUNLOOP_API_KEY:-}" ]; then
  echo "RUNLOOP_API_KEY is required" >&2
  exit 1
fi
export FLOK_BP_NAME="${FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT:-flok-runloop-interactive}"
export FLOK_BLUEPRINT_BUILD_TIMEOUT_SEC="${FLOK_BLUEPRINT_BUILD_TIMEOUT_SEC:-1500}"
export FLOK_BLUEPRINT_POLL_MS="${FLOK_BLUEPRINT_POLL_MS:-5000}"
exec node --experimental-vm-modules node_modules/tsx/dist/cli.mjs \
  blueprints/runloop-interactive/build.ts
