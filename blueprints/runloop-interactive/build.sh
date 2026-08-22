#!/usr/bin/env bash
# Manually create/update the paid Runloop Blueprint. Do NOT run from ordinary CI.
# Requires RUNLOOP_API_KEY. Uses @runloop/api-client via a one-shot node script.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
if [ -z "${RUNLOOP_API_KEY:-}" ]; then
  echo "RUNLOOP_API_KEY is required" >&2
  exit 1
fi
export FLOK_BP_NAME="${FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT:-flok-runloop-interactive}"
node --input-type=module <<'EOF'
import { readFileSync } from "node:fs";
import { RunloopSDK } from "@runloop/api-client";

const name = process.env.FLOK_BP_NAME;
if (!name) {
  throw new Error("FLOK_BP_NAME missing");
}
const dockerfile = readFileSync("blueprints/runloop-interactive/Dockerfile", "utf8");
const sdk = new RunloopSDK({ bearerToken: process.env.RUNLOOP_API_KEY });
const bp = await sdk.blueprint.create({
  name,
  dockerfile,
  metadata: {
    "flok.purpose": "c3b-interactive",
    "flok.provider": "runloop",
  },
  launch_parameters: { architecture: "x86_64" },
});
const info = await bp.getInfo();
console.log("blueprint id", bp.id);
console.log("name", name);
console.log("status", info.status);
EOF
