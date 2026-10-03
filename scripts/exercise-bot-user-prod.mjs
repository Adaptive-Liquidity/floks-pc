#!/usr/bin/env node
/**
 * Exercise unprivileged-bot-user paths against `tsc` dist output.
 * Minifiers have broken Function.toString() guest scripts here before.
 * Memory plane only — not live Runloop proof.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distBot = join(root, "dist/lib/computers/providers/runloop-bot-user.js");
const distIndex = join(root, "dist/lib/computers/index.js");
const distMcp = join(root, "dist/lib/mcp/tools.js");

if (!existsSync(distBot) || !existsSync(distIndex) || !existsSync(distMcp)) {
  throw new Error("dist/ missing — run `npm run build` first");
}

const src = readFileSync(distBot, "utf8");
assert.doesNotMatch(src, /ENSURE_BOT_USER_SH\s*=\s*[^;]*\.toString\s*\(/);
assert.match(src, /nosudo=1/);
assert.match(src, /useradd -M -u/);
assert.match(src, /\/var\/lib\/flok/);

const bot = await import(pathToFileURL(distBot).href);
assert.equal(bot.FLOK_BOT_USER, "flok");
assert.equal(bot.FLOK_BOT_UID, 1501);
assert.deepEqual(bot.argvAsBotUser(["whoami"]).slice(0, 5), [
  "runuser",
  "-u",
  "flok",
  "--",
  "env",
]);
assert.equal(typeof bot.ENSURE_BOT_USER_SH, "string");
assert.match(bot.ENSURE_BOT_USER_SH, /nosudo=1/);
assert.doesNotMatch(bot.ENSURE_BOT_USER_SH, /NOPASSWD/);
assert.equal(bot.isReservedControlPlanePath("/var/lib/flok/execvp.py"), true);
assert.equal(bot.isReservedControlPlanePath("/home/user/flok/.flok/cdp-ax.mjs"), true);
assert.equal(bot.isReservedControlPlanePath("/run/flok-cdp/ws"), true);
assert.equal(bot.isReservedControlPlanePath("/home/user/flok/.browser/profile/Cookies"), true);
assert.equal(bot.isReservedControlPlanePath("/home/user/flok/notes.txt"), false);
assert.match(bot.ENSURE_BOT_USER_SH, /chown -hP -R/);
assert.match(bot.ENSURE_BOT_USER_SH, /chown -h /);
assert.match(bot.ENSURE_BOT_USER_SH, /chmod 1775/);
assert.match(bot.ENSURE_BOT_USER_SH, /replacing symlink/);

const computers = await import(pathToFileURL(distIndex).href);
const plane = new computers.MemoryRunloopControlPlane();
const p = new computers.RunloopProvider({ client: plane, blueprint: "memory-linux-vm" });
const a = await p.provision({ birdId: "prod-bot", flockId: "f" });
const who = await p.exec(a.providerRef, { argv: ["whoami"] });
assert.equal(who.stdout.trim(), "flok");
const denied = await p.filesystem(a.providerRef, {
  operation: "read",
  path: "/var/lib/flok/execvp.py",
});
assert.equal(denied.ok, false);
const leftover = await p.filesystem(a.providerRef, {
  operation: "list",
  path: "/home/user/flok/.flok",
});
assert.equal(leftover.ok, false);
const cookies = await p.filesystem(a.providerRef, {
  operation: "read",
  path: "/home/user/flok/.browser/profile/Cookies",
});
assert.equal(cookies.ok, false);
const profileList = await p.filesystem(a.providerRef, {
  operation: "list",
  path: "/home/user/flok/.browser",
});
assert.equal(profileList.ok, false);
const obs = await p.observe(a.providerRef, { includeScreenshot: true });
assert.equal(obs.screenWidth, 1440);
assert.ok(obs.screenshotBase64 && obs.screenshotBase64.length > 10);

const mcp = await import(pathToFileURL(distMcp).href);
assert.equal(mcp.MCP_TOOL_NAMES.length, 8);
assert.deepEqual([...mcp.MCP_TOOL_NAMES], [
  "computer_pair",
  "computer_status",
  "computer_exec",
  "computer_fs",
  "computer_observe",
  "computer_act",
  "handoff_send",
  "handoff_receive",
]);

const distFs = join(root, "dist/lib/computers/providers/runloop-fs.js");
if (existsSync(distFs)) {
  const fsSrc = readFileSync(distFs, "utf8");
  assert.match(fsSrc, /O_NOFOLLOW/);
  assert.match(fsSrc, /dir_fd=/);
  assert.match(fsSrc, /sys\.stdin\.buffer/);
  assert.match(fsSrc, /file too large/);
  assert.doesNotMatch(fsSrc, /GUEST_NOFOLLOW_\w+\s*=\s*[^;]*\.toString\s*\(/);
}

const nextChunkDir = join(root, "web/.next/server/chunks");
if (existsSync(nextChunkDir)) {
  const { readdirSync } = await import("node:fs");
  const chunks = readdirSync(nextChunkDir).filter((name) => name.endsWith(".js"));
  const hits = [];
  for (const name of chunks) {
    const body = readFileSync(join(nextChunkDir, name), "utf8");
    if (body.includes("nosudo=1") && body.includes("useradd -M -u")) hits.push(name);
  }
  assert.ok(hits.length >= 1, "next production server chunk must keep ENSURE_BOT_USER_SH literals");
  for (const name of hits) {
    const body = readFileSync(join(nextChunkDir, name), "utf8");
    assert.match(body, /nosudo=1/);
    assert.match(body, /useradd -M -u/);
    assert.match(body, /\/var\/lib\/flok/);
    assert.doesNotMatch(body, /ENSURE_BOT_USER_SH\s*=\s*[^;]*\.toString\s*\(/);
    assert.match(body, /\["runuser","-u",/);
    assert.match(body, /="flok"/);
    assert.match(body, /chown -hP -R/);
  }
  const nofollowHits = chunks.filter((name) => {
    const body = readFileSync(join(nextChunkDir, name), "utf8");
    return body.includes("O_NOFOLLOW") && body.includes("dir_fd=");
  });
  assert.ok(nofollowHits.length >= 1, "next production server chunk must keep O_NOFOLLOW guest fs scripts");
}

console.log("exercise-bot-user-prod: ok (memory plane + next chunk literals, not live Runloop)");
