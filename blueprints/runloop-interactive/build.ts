/**
 * Paid Blueprint builder. Invoked only by build.sh (never npm test / verify / PR CI).
 * Creates the Blueprint, then polls until a terminal status.
 */
import { readFileSync } from "node:fs";
import { RunloopSDK } from "@runloop/api-client";
import { classifyBlueprintBuildStatus } from "../../src/lib/computers/providers/runloop-interactive.js";

const name = process.env.FLOK_BP_NAME;
if (!name) {
  throw new Error("FLOK_BP_NAME missing");
}
if (!process.env.RUNLOOP_API_KEY) {
  throw new Error("RUNLOOP_API_KEY is required");
}

const timeoutSec = Number(process.env.FLOK_BLUEPRINT_BUILD_TIMEOUT_SEC ?? "1500");
const pollMs = Number(process.env.FLOK_BLUEPRINT_POLL_MS ?? "5000");
if (!Number.isFinite(timeoutSec) || timeoutSec < 30) {
  throw new Error("FLOK_BLUEPRINT_BUILD_TIMEOUT_SEC must be >= 30");
}
if (!Number.isFinite(pollMs) || pollMs < 500) {
  throw new Error("FLOK_BLUEPRINT_POLL_MS must be >= 500");
}

const dockerfile = readFileSync("blueprints/runloop-interactive/Dockerfile", "utf8");
const sdk = new RunloopSDK({ bearerToken: process.env.RUNLOOP_API_KEY });

console.log("creating blueprint", name);
const created = await sdk.api.blueprints.create({
  name,
  dockerfile,
  metadata: {
    "flok.purpose": "c3b-interactive",
    "flok.provider": "runloop",
    "flok.base": "runloop/universal-ubuntu-24.04-x86_64-dnd",
    "flok.ui_user": "flok-ui",
  },
  launch_parameters: { architecture: "x86_64" },
});

const id = created.id;
console.log("blueprint id", id);
console.log("name", created.name);
console.log("status", created.status);

async function dumpLogs(reason: string): Promise<void> {
  console.error(`blueprint ${reason}; dumping build logs`);
  try {
    const logs = await sdk.api.blueprints.logs(id);
    for (const line of logs.logs ?? []) {
      console.error(`${line.timestamp_ms} ${line.level} ${line.message}`);
    }
  } catch (e) {
    console.error("failed to fetch blueprint logs", e instanceof Error ? e.message : e);
  }
}

const deadline = Date.now() + timeoutSec * 1000;
let info = created;

while (true) {
  const phase = classifyBlueprintBuildStatus(info.status);
  if (phase === "success") {
    console.log("blueprint id", info.id);
    console.log("name", info.name);
    console.log("status", info.status);
    if (info.failure_reason) console.log("failure_reason", info.failure_reason);
    process.exit(0);
  }
  if (phase === "failure") {
    console.error("status", info.status);
    if (info.failure_reason) console.error("failure_reason", info.failure_reason);
    await dumpLogs("failed");
    process.exit(1);
  }
  if (Date.now() >= deadline) {
    console.error("status", info.status);
    await dumpLogs(`timed out after ${timeoutSec}s (still ${info.status})`);
    process.exit(1);
  }
  console.log("waiting", info.status);
  await new Promise((r) => setTimeout(r, pollMs));
  try {
    info = await sdk.api.blueprints.retrieve(id);
  } catch (e) {
    console.error("blueprint retrieve failed", e instanceof Error ? e.message : e);
    await dumpLogs("retrieve failed");
    process.exit(1);
  }
}
