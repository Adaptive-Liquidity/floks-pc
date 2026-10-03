/**
 * Unpaid visible-browser checks. No Runloop calls.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { crc32, deflateSync } from "node:zlib";
import { MCP_TOOL_NAMES, MCP_TOOLS } from "../../src/lib/mcp/tools.ts";
import { MemoryRunloopControlPlane, RunloopProvider } from "../../src/lib/computers/providers/runloop.ts";
import {
  BROWSER_START_URL,
  BrowserNotReady,
  NavigationFailed,
  bringManagedBrowserToFront,
  ensureManagedBrowser,
  navigateManagedPage,
  navigationReached,
  NAVIGATION_REACHED_JS,
  parseNavHelperStdout,
  runValidatedActions,
  screenIsBlank,
  type GuestExecResult,
} from "../../src/lib/computers/providers/runloop-browser.ts";
import {
  CDP_AX_HELPER_JS,
  CDP_NAV_HELPER_JS,
  CDP_NAV_HELPER_PATH,
  SELECT_PAGE_TARGET_JS,
  selectPageTarget,
} from "../../src/lib/computers/providers/runloop-cdp.ts";
import { ENSURE_INTERACTIVE_SH, chromeLaunchArgv } from "../../src/lib/computers/providers/runloop-interactive.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function ok(stdout = ""): GuestExecResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([length, body, checksum]);
}

function rgbPng(width: number, pixels: Array<[number, number, number]>): Buffer {
  const height = pixels.length / width;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = pixels[y * width + x]!;
      const at = row + 1 + x * 3;
      raw[at] = pixel[0];
      raw[at + 1] = pixel[1];
      raw[at + 2] = pixel[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function blackWithTextLine(): Buffer {
  const width = 180;
  const height = 40;
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(height * stride);
  for (let y = 8; y < 32; y++) {
    for (const x of [12, 13, 14, 22, 30, 31, 40, 48, 49, 56]) {
      const at = y * stride + 1 + x * 3;
      raw[at] = 255;
      raw[at + 1] = 255;
      raw[at + 2] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else out.push(path);
  }
  return out;
}

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function wsAccept(key: string): string {
  return createHash("sha1").update(key + WS_GUID).digest("base64");
}

function encodeServerFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function takeClientFrame(buf: Buffer): { opcode: number; text: string; rest: Buffer } | null {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let length = buf[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buf.length < 4) return null;
    length = buf.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    return null;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + length) return null;
  const mask = masked ? buf.subarray(offset, offset + 4) : null;
  offset += maskLen;
  const payload = Buffer.from(buf.subarray(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i++) payload[i] = payload[i]! ^ mask[i & 3]!;
  }
  return { opcode, text: opcode === 1 ? payload.toString("utf8") : "", rest: buf.subarray(offset + length) };
}

function hrefFor(requested: string, evalCount: number): { href?: string; error?: string } {
  if (requested.includes("throw-once") && evalCount === 1) {
    return { error: "Execution context was destroyed" };
  }
  if (requested.includes("chrome-error")) return { href: "chrome-error://chromewebdata/" };
  if (requested === "https://host:8443/p") return { href: "https://host:9443/other" };
  if (requested.startsWith("http://example.com")) return { href: "https://example.com/home" };
  return { href: "https://example.com/landed" };
}

async function withFakeCdp(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "flok-cdp-"));
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url?.startsWith("/json/version")) {
      res.end("{}");
      return;
    }
    res.end(
      JSON.stringify([
        {
          id: "p1",
          type: "page",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/p1",
        },
      ]),
    );
  });
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`,
    );
    let pending = Buffer.alloc(0);
    let requested = "";
    let evalCount = 0;
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        const frame = takeClientFrame(pending);
        if (!frame) break;
        pending = Buffer.from(frame.rest);
        if (frame.opcode === 8) {
          socket.end();
          break;
        }
        if (!frame.text) continue;
        const msg = JSON.parse(frame.text) as { id?: number; method?: string; params?: { url?: string } };
        if (msg.method === "Page.navigate") requested = msg.params?.url ?? "";
        if (msg.method === "Runtime.evaluate") evalCount += 1;
        const next = msg.method === "Runtime.evaluate" ? hrefFor(requested, evalCount) : {};
        const body = next.error
          ? { id: msg.id, error: { message: next.error } }
          : {
              id: msg.id,
              result:
                msg.method === "Runtime.evaluate"
                  ? { result: { type: "string", value: next.href } }
                  : {},
            };
        socket.write(encodeServerFrame(JSON.stringify(body)));
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(9222, "127.0.0.1", () => resolve());
  });
  try {
    await run(dir);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}

function runHelper(dir: string, url: string): Promise<{ stdout: string; code: number | null }> {
  const file = join(dir, "cdp-nav.mjs");
  writeFileSync(file, CDP_NAV_HELPER_JS);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, url], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`nav helper timed out for ${url}\n${stderr}\n${stdout}`));
    }, 25_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, code });
    });
  });
}

describe("visible browser ensure", () => {
  it("kills a fixture Chrome on 9222 and launches one about:blank Chrome", async () => {
    let up = true;
    let launches = 0;
    const order: string[] = [];
    const launchArgv = chromeLaunchArgv(BROWSER_START_URL);
    const result = await ensureManagedBrowser({
      launchArgv,
      sleep: async () => {},
      exec: async (argv) => {
        const text = argv.join(" ");
        if (text.includes("pkill")) {
          order.push("cleanup");
          up = false;
          return ok();
        }
        if (text.includes("json/version")) {
          order.push(up ? "probe-up" : "probe-down");
          return up ? ok("cdp-ready\n") : { exitCode: 1, stdout: "cdp-down\n", stderr: "" };
        }
        if (text.includes("about:blank")) {
          launches += 1;
          up = true;
          order.push("launch");
          assert.equal(text.includes("--no-sandbox"), false);
          assert.equal(text.includes("--disable-setuid-sandbox"), false);
          return ok("launched\n");
        }
        return ok();
      },
    });
    assert.equal(result.started, true);
    assert.equal(launches, 1);
    assert.deepEqual(order, ["cleanup", "probe-down", "launch", "probe-up"]);
    assert.equal(launchArgv.join(" ").includes("google-chrome-stable"), true);
  });

  it("does not launch a second Chrome when CDP is already up", async () => {
    let launches = 0;
    const result = await ensureManagedBrowser({
      launchArgv: chromeLaunchArgv(BROWSER_START_URL),
      sleep: async () => {},
      exec: async (argv) => {
        const text = argv.join(" ");
        if (text.includes("about:blank")) {
          launches += 1;
          return ok("launched\n");
        }
        if (text.includes("json/version")) return ok("cdp-ready\n");
        return ok();
      },
    });
    assert.equal(result.started, false);
    assert.equal(launches, 0);
  });

  it("screenshots only after Chrome is launched", async () => {
    const order: string[] = [];
    let up = false;
    await ensureManagedBrowser({
      launchArgv: chromeLaunchArgv(BROWSER_START_URL),
      sleep: async () => {},
      exec: async (argv) => {
        const text = argv.join(" ");
        if (text.includes("pkill")) {
          order.push("cleanup");
          return ok();
        }
        if (text.includes("json/version")) {
          order.push("probe");
          return up ? ok("cdp-ready\n") : { exitCode: 1, stdout: "cdp-down\n", stderr: "" };
        }
        if (text.includes("about:blank")) {
          order.push("launch");
          up = true;
          return ok("launched\n");
        }
        return ok();
      },
    });
    order.push("screenshot");
    const observe = readFileSync(join(root, "src/lib/computers/providers/runloop.ts"), "utf8");
    const body = observe.slice(observe.indexOf("async observe"), observe.indexOf("async act"));
    assert.ok(body.indexOf("ensureInteractiveStack") < body.indexOf("screenshot("));
    assert.ok(order.indexOf("launch") < order.indexOf("screenshot"));
    const sdk = readFileSync(join(root, "src/lib/computers/providers/runloop-sdk.ts"), "utf8");
    const stack = sdk.slice(sdk.indexOf("async ensureInteractiveStack"), sdk.indexOf("async screenshot"));
    assert.equal(stack.split("await this.finishBrowser(").length - 1, 2);
    assert.match(sdk, /PNG24:/);
    assert.match(sdk, /best-effort" \? 5_000/);
  });

  it("times out instead of hanging when Chrome never answers", async () => {
    let clock = 0;
    await assert.rejects(
      () =>
        ensureManagedBrowser({
          launchArgv: ["about:blank"],
          timeoutMs: 1000,
          pollMs: 500,
          now: () => clock,
          sleep: async () => {
            clock += 500;
          },
          exec: async (argv) => {
            if (argv.join(" ").includes("json/version")) {
              return { exitCode: 1, stdout: "cdp-down\n", stderr: "" };
            }
            return ok();
          },
        }),
      (err: unknown) => err instanceof BrowserNotReady,
    );
  });
});

describe("honest open_url", () => {
  it("navigates the selected page and never starts Chrome", async () => {
    const seen: string[] = [];
    const result = await navigateManagedPage({
      url: "https://example.com",
      ensureBrowser: async () => {
        seen.push("ensure");
      },
      navArgv: ["node", CDP_NAV_HELPER_PATH, "https://example.com"],
      exec: async (argv) => {
        seen.push(argv.join(" "));
        return ok(JSON.stringify({ ok: true, finalUrl: "https://example.com/" }));
      },
    });
    assert.equal(result.finalUrl, "https://example.com/");
    assert.equal(seen.some((line) => /google-chrome|Popen/.test(line)), false);
    assert.equal(navigationReached("http://example.com/", "https://example.com/"), true);
    assert.equal(navigationReached("https://example.com", "https://example.com/"), true);
    assert.equal(navigationReached("https://example.com/", "https://www.example.com/"), true);
    assert.equal(navigationReached("https://x.com/", "https://x.com/home"), true);
    assert.equal(navigationReached("https://host:8443/p", "https://host:9443/p"), false);
    assert.equal(navigationReached("https://example.com/", "https://evil.test/"), false);
    assert.equal(navigationReached("https://twitter.com/", "https://x.com/"), false);
    assert.equal(navigationReached("file:///home/user/flok/a.html", "file:///home/user/flok/b.html"), false);
  });

  it("fails the rest of the batch when the origin is missed", async () => {
    await assert.rejects(
      () =>
        navigateManagedPage({
          url: "https://example.com/",
          ensureBrowser: async () => {},
          navArgv: ["node", CDP_NAV_HELPER_PATH, "https://example.com/"],
          exec: async () => ok(JSON.stringify({ ok: false, href: "https://evil.test/" })),
        }),
      (err: unknown) => {
        assert.ok(err instanceof NavigationFailed);
        assert.equal(err.code, "NAVIGATION_FAILED");
        assert.match(err.message, /https:\/\/example\.com/);
        assert.match(err.message, /evil\.test/);
        return true;
      },
    );
    await assert.rejects(
      () =>
        navigateManagedPage({
          url: "https://nonexistent.invalid/",
          ensureBrowser: async () => {},
          navArgv: ["node", "cdp-nav.mjs", "https://nonexistent.invalid/"],
          exec: async () =>
            ok(JSON.stringify({ ok: false, href: "", errorText: "net::ERR_NAME_NOT_RESOLVED" })),
        }),
      (err: unknown) => {
        assert.ok(err instanceof NavigationFailed);
        assert.match(err.message, /unknown/);
        return true;
      },
    );
    const batch = await runValidatedActions(
      [
        { type: "open_url", url: "https://example.com/" },
        { type: "type", text: "should-not-run" },
      ],
      () => null,
      async () => {
        throw new NavigationFailed("page did not reach https://example.com; now at https://evil.test/");
      },
    );
    assert.equal(batch.ok, false);
    assert.equal(batch.results[0]?.code, "NAVIGATION_FAILED");
    assert.match(batch.results[0]?.error ?? "", /evil\.test/);
    assert.equal(batch.results[1]?.error, "not executed");
  });

  it("rejects nav helper stdout that fails the schema", () => {
    assert.equal(parseNavHelperStdout(JSON.stringify({ ok: true, href: "https://example.com/", extra: 1 })), null);
    assert.equal(parseNavHelperStdout(JSON.stringify({ ok: "yes", href: "https://example.com/" })), null);
    assert.equal(parseNavHelperStdout(JSON.stringify({ ok: true, href: "h".repeat(2049) })), null);
    const okHref = parseNavHelperStdout(JSON.stringify({ ok: true, href: "https://example.com/" }));
    assert.equal(okHref?.ok, true);
    assert.equal(okHref?.href, "https://example.com/");
  });

  it("shares selectPageTarget between the AX helper and open_url", () => {
    const pages = [
      { id: "first", type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/first" },
      { id: "recorded", type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/recorded" },
    ];
    assert.equal(selectPageTarget(pages, "recorded")?.id, "recorded");
    assert.equal(selectPageTarget(pages, "recorded")?.id, "recorded");
    assert.equal(selectPageTarget(pages)?.id, "first");
    assert.equal(CDP_AX_HELPER_JS.includes(SELECT_PAGE_TARGET_JS), true);
    assert.equal(CDP_NAV_HELPER_JS.includes(SELECT_PAGE_TARGET_JS), true);
    assert.equal(CDP_NAV_HELPER_JS.includes(NAVIGATION_REACHED_JS), true);
    assert.match(CDP_NAV_HELPER_JS, /function navigationReached\(/);
    assert.doesNotMatch(CDP_NAV_HELPER_JS, /__name\(/);
    assert.match(CDP_NAV_HELPER_JS, /chrome-error:\/\//);
    assert.match(CDP_NAV_HELPER_JS, /try \{\s*href = await hrefOf\(call\);/);
    assert.match(CDP_NAV_HELPER_JS, /Page\.navigate/);
    assert.match(CDP_NAV_HELPER_JS, /127\.0\.0\.1/);
    assert.doesNotMatch(CDP_NAV_HELPER_JS, /0\.0\.0\.0/);
    assert.doesNotMatch(CDP_NAV_HELPER_JS, /--no-sandbox/);
    assert.doesNotMatch(CDP_AX_HELPER_JS, /\/tmp\/flok-interactive/);
    assert.doesNotMatch(CDP_NAV_HELPER_JS, /\/tmp\/flok-interactive/);
    assert.match(SELECT_PAGE_TARGET_JS, /O_NOFOLLOW/);
    assert.match(SELECT_PAGE_TARGET_JS, /renameSync/);
  });

  it("focuses the managed browser without a fixture URL", async () => {
    const seen: string[] = [];
    await bringManagedBrowserToFront({
      ensureBrowser: async () => {
        seen.push("ensure");
      },
      frontArgv: ["node", CDP_NAV_HELPER_PATH, "--front"],
      exec: async (argv) => {
        seen.push(argv.join(" "));
        return ok('{"ok":true}');
      },
    });
    assert.deepEqual(seen, ["ensure", `node ${CDP_NAV_HELPER_PATH} --front`]);
    assert.equal(seen.some((line) => line.includes("fixture")), false);
    const sdk = readFileSync(join(root, "src/lib/computers/providers/runloop-sdk.ts"), "utf8");
    const ui = sdk.slice(sdk.indexOf("async uiAction"), sdk.indexOf("private requireFs"));
    assert.doesNotMatch(ui, /chromePopenArgv|google-chrome|Popen/);
  });

  it("guest navigationReached matches the host function", () => {
    const guestValue: unknown = runInNewContext(`${NAVIGATION_REACHED_JS}\nnavigationReached`, { URL });
    if (typeof guestValue !== "function") throw new Error("guest navigationReached missing");
    const guest = guestValue as (requested: string, current: string) => boolean;
    const matrix: Array<[string, string, boolean]> = [
      ["http://example.com/", "https://example.com/", true],
      ["https://example.com", "https://example.com/", true],
      ["https://example.com/", "https://www.example.com/home", true],
      ["https://x.com/", "https://x.com/home", true],
      ["https://example.com/a?q=1#h", "https://example.com/b", true],
      ["https://host:8443/p", "https://host:9443/p", false],
      ["https://example.com/", "https://evil.test/", false],
      ["https://twitter.com/", "https://x.com/", false],
      ["http://example.com:8080/", "https://example.com/", false],
      ["https://example.com:8443/p", "https://example.com:8443/other", true],
      ["file:///home/user/flok/a.html", "file:///home/user/flok/a.html", true],
      ["file:///home/user/flok/dir/", "file:///home/user/flok/dir", true],
      ["file:///home/user/flok/a.html", "file:///home/user/flok/b.html", false],
      ["file:///home/user/flok/a.html", "https://example.com/", false],
      ["https://example.com/", "not a url", false],
    ];
    for (const [requested, current, expected] of matrix) {
      assert.equal(navigationReached(requested, current), expected, `${requested} -> ${current}`);
      assert.equal(guest(requested, current), navigationReached(requested, current), `${requested} -> ${current}`);
    }
  });

  it("runs the nav helper against a loopback CDP", async () => {
    await withFakeCdp(async (dir) => {
      const same = await runHelper(dir, "https://example.com/");
      const sameBody = JSON.parse(same.stdout) as { ok?: boolean; finalUrl?: string };
      assert.equal(same.code, 0);
      assert.equal(sameBody.ok, true);
      assert.equal(sameBody.finalUrl, "https://example.com/landed");

      const upgraded = await runHelper(dir, "http://example.com/start");
      const upgradedBody = JSON.parse(upgraded.stdout) as { ok?: boolean; finalUrl?: string };
      assert.equal(upgradedBody.ok, true);
      assert.equal(upgradedBody.finalUrl, "https://example.com/home");

      const errored = await runHelper(dir, "https://example.com/chrome-error");
      const erroredBody = JSON.parse(errored.stdout) as { ok?: boolean; errorText?: string; href?: string };
      assert.equal(erroredBody.ok, false);
      assert.equal(erroredBody.errorText, "navigation error page");
      assert.match(erroredBody.href ?? "", /^chrome-error:/);

      const thrown = await runHelper(dir, "https://example.com/throw-once");
      const thrownBody = JSON.parse(thrown.stdout) as { ok?: boolean; finalUrl?: string };
      assert.equal(thrownBody.ok, true);
      assert.equal(thrownBody.finalUrl, "https://example.com/landed");

      const port = await runHelper(dir, "https://host:8443/p");
      const portBody = JSON.parse(port.stdout) as { ok?: boolean; href?: string };
      assert.equal(portBody.ok, false);
      assert.equal(portBody.href, "https://host:9443/other");
    });
  });
});

describe("screen truth and fixture removal", () => {
  it("marks a one-colour PNG blank and a two-colour PNG not blank", () => {
    assert.equal(screenIsBlank(PNG_1X1), true);
    assert.equal(screenIsBlank(rgbPng(1, [[0, 0, 0]])), true);
    assert.equal(
      screenIsBlank(
        rgbPng(2, [
          [0, 0, 0],
          [255, 255, 255],
        ]),
      ),
      false,
    );
    assert.equal(screenIsBlank(Buffer.from("not-png")), false);
    const gray = readFileSync(join(root, "tests/fixtures/png/black-1bit-gray.png"));
    const palette = readFileSync(join(root, "tests/fixtures/png/palette-1bit.png"));
    const solid = readFileSync(join(root, "tests/fixtures/png/solid-8bit-rgb.png"));
    assert.equal(screenIsBlank(gray), false);
    assert.equal(screenIsBlank(palette), false);
    assert.equal(screenIsBlank(solid), true);
    assert.equal(screenIsBlank(blackWithTextLine()), false);
  });

  it("keeps the fixture out of customer source and starts a visible background", () => {
    assert.match(ENSURE_INTERACTIVE_SH, /xsetroot -solid '#1f2933'/);
    assert.match(ENSURE_INTERACTIVE_SH, /rm -rf \/home\/user\/flok\/\.flok/);
    const banned = ["FLOKS C3B fixture", "FIXTURE_HTML", "fixture.html"];
    for (const dir of ["src", "web"]) {
      for (const file of filesUnder(join(root, dir))) {
        const text = readFileSync(file, "utf8");
        const kept = text
          .split(/\r?\n/)
          .filter((line) => !line.includes("rm -f") && !line.includes("pkill"))
          .join("\n");
        for (const word of banned) {
          assert.equal(kept.includes(word), false, `${file} contains ${word}`);
        }
      }
    }
    const observe = MCP_TOOLS.find((tool) => tool.name === "computer_observe");
    const act = MCP_TOOLS.find((tool) => tool.name === "computer_act");
    assert.match(observe?.description ?? "", /coordinate_space screen_pixels/);
    assert.match(observe?.description ?? "", /single colour/);
    assert.match(act?.description ?? "", /NAVIGATION_FAILED/);
    assert.equal(MCP_TOOL_NAMES.length, 8);
  });
});

describe("wake when Chrome will not start", () => {
  it("resolves wake without suspending and still fail-closes observe", async () => {
    const plane = new MemoryRunloopControlPlane();
    const provider = new RunloopProvider({ client: plane, blueprint: "memory" });
    const created = await provider.provision({ birdId: "wake-browser", flockId: "f" });
    const session = (await plane.get(created.providerRef)) as {
      failBrowserEnsure: boolean;
      suspendCalls: number;
    };
    session.failBrowserEnsure = true;
    await provider.wake(created.providerRef);
    assert.equal(session.suspendCalls, 0);
    await assert.rejects(() => provider.observe(created.providerRef, { includeScreenshot: true }));
  });
});
