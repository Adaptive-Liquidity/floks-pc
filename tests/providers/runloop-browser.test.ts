/**
 * Unpaid visible-browser checks. No Runloop calls.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { MCP_TOOL_NAMES, MCP_TOOLS } from "../../src/lib/mcp/tools.ts";
import {
  BROWSER_START_URL,
  BrowserNotReady,
  NavigationFailed,
  bringManagedBrowserToFront,
  ensureManagedBrowser,
  navigateManagedPage,
  navigationReached,
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
    assert.equal(stack.split("ensureBrowser()").length - 1, 2);
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
    assert.equal(navigationReached("https://example.com", "https://example.com/"), true);
    assert.equal(navigationReached("https://example.com/", "https://www.example.com/"), true);
    assert.equal(navigationReached("https://example.com/", "https://example.com/other"), false);
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
    assert.match(CDP_NAV_HELPER_JS, /Page\.navigate/);
    assert.match(CDP_NAV_HELPER_JS, /127\.0\.0\.1/);
    assert.doesNotMatch(CDP_NAV_HELPER_JS, /0\.0\.0\.0/);
    assert.doesNotMatch(CDP_NAV_HELPER_JS, /--no-sandbox/);
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
  });

  it("keeps the fixture out of customer source and starts a visible background", () => {
    assert.match(ENSURE_INTERACTIVE_SH, /xsetroot -solid '#1f2933'/);
    assert.match(ENSURE_INTERACTIVE_SH, /rm -f \/home\/user\/flok\/\.flok\/fixture\.html/);
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
    assert.match(act?.description ?? "", /NAVIGATION_FAILED/);
    assert.equal(MCP_TOOL_NAMES.length, 8);
  });
});
