/**
 * C7 unpaid Runloop CDP contract. Zero network, zero FakeProvider trees.
 * Real Chrome proof is opt-in c7-live; this file proves loopback argv,
 * helper source, AX mapping, and leftover click_element fail-closed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ComputerUseNotAvailable,
  MemoryRunloopControlPlane,
  RunloopProvider,
} from "../../src/lib/computers/index.js";
import {
  CDP_AX_HELPER_JS,
  CDP_DEBUG_ADDRESS,
  CDP_DEBUG_PORT,
  CDP_HELPER_PATH,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  ENSURE_INTERACTIVE_SH,
  CDP_NODE_BIN,
  chromeLaunchArgv,
  mapCdpAxDump,
  parseCdpAxHelperStdout,
  validateAction,
} from "../../src/lib/computers/providers/runloop-interactive.js";

function provider(): RunloopProvider {
  return new RunloopProvider({
    client: new MemoryRunloopControlPlane(),
    blueprint: "memory-linux-vm",
  });
}

describe("C7 Chrome loopback CDP argv", () => {
  it("listens on 127.0.0.1:9222 and never 0.0.0.0 or --no-sandbox", () => {
    const chrome = chromeLaunchArgv("https://example.com/");
    assert.ok(chrome.includes(`--remote-debugging-port=${CDP_DEBUG_PORT}`));
    assert.ok(chrome.includes(`--remote-debugging-address=${CDP_DEBUG_ADDRESS}`));
    assert.ok(chrome.includes("--remote-allow-origins=*"));
    assert.equal(CDP_DEBUG_ADDRESS, "127.0.0.1");
    assert.equal(CDP_DEBUG_PORT, 9222);
    assert.equal(chrome.includes("0.0.0.0"), false);
    assert.equal(chrome.some((a) => a.includes("0.0.0.0")), false);
    assert.equal(chrome.includes("--no-sandbox"), false);
    assert.equal(chrome.includes("--disable-setuid-sandbox"), false);
    assert.equal(chrome[0], "runuser");
    assert.equal(chrome[2], "flok-ui");
  });

  it("guest helper speaks loopback CDP over Node WebSocket", () => {
    assert.equal(CDP_HELPER_PATH, "/home/user/flok/.flok/cdp-ax.mjs");
    assert.match(CDP_AX_HELPER_JS, /const BASE = 'http:\/\/127\.0\.0\.1:9222'/);
    assert.match(CDP_AX_HELPER_JS, /assertLoopbackWs\(page\.webSocketDebuggerUrl\)/);
    assert.match(CDP_AX_HELPER_JS, /new WebSocket\(page\.webSocketDebuggerUrl\)/);
    assert.match(CDP_AX_HELPER_JS, /u\.protocol !== 'ws:'/);
    assert.match(CDP_AX_HELPER_JS, /u\.hostname !== '127\.0\.0\.1'/);
    assert.match(CDP_AX_HELPER_JS, /u\.port !== '9222'/);
    assert.match(CDP_AX_HELPER_JS, /typeof n\.backendDOMNodeId !== 'number'/);
    assert.match(CDP_AX_HELPER_JS, /cdp ax tree missing nodes/);
    assert.doesNotMatch(CDP_AX_HELPER_JS, /\? tree\.nodes : \[\]/);
    assert.match(CDP_AX_HELPER_JS, /WebSocket/);
    assert.match(CDP_AX_HELPER_JS, /Accessibility\.enable/);
    assert.match(CDP_AX_HELPER_JS, /Accessibility\.getFullAXTree/);
    assert.match(CDP_AX_HELPER_JS, /DOM\.getBoxModel/);
    assert.match(CDP_AX_HELPER_JS, /DOM\.getDocument/);
    assert.match(CDP_AX_HELPER_JS, /cdp page target missing/);
    assert.match(CDP_AX_HELPER_JS, /return \[backendNodeId, undefined\]/);
    assert.match(CDP_AX_HELPER_JS, /cdp helper deadline/);
    assert.match(CDP_AX_HELPER_JS, /p\.name === 'focused'/);
    assert.doesNotMatch(CDP_AX_HELPER_JS, /0\.0\.0\.0/);
    assert.doesNotMatch(CDP_AX_HELPER_JS, /--no-sandbox/);
  });

  it("ensure script and SDK root-lock the guest CDP helper", () => {
    assert.match(ENSURE_INTERACTIVE_SH, /chown root:root \/home\/user\/flok\/\.flok\/cdp-ax\.mjs/);
    assert.match(ENSURE_INTERACTIVE_SH, /chmod 755 \/home\/user\/flok\/\.flok\/cdp-ax\.mjs/);
    const here = dirname(fileURLToPath(import.meta.url));
    const sdk = readFileSync(join(here, "../../src/lib/computers/providers/runloop-sdk.ts"), "utf8");
    assert.match(sdk, /\.\.\.chromeLaunchArgv\(/);
    assert.match(sdk, /Popen\(sys\.argv\[1:\], start_new_session=True/);
    assert.doesNotMatch(sdk, /remote-debugging-address=0\.0\.0\.0/);
    assert.doesNotMatch(sdk, /sys\.argv\[1:\] \+ /);
    const writeAt = sdk.indexOf("fsWrite(CDP_HELPER_PATH, Buffer.from(CDP_AX_HELPER_JS");
    const lockAt = sdk.indexOf("lockRootExecutedAssets()");
    const lastLock = sdk.lastIndexOf("await this.lockRootExecutedAssets()");
    assert.ok(writeAt >= 0);
    assert.ok(lockAt >= 0);
    assert.ok(lastLock > writeAt);
    assert.match(sdk, /argv: \[nodeBin, CDP_HELPER_PATH\]/);
    assert.match(sdk, /command -v node/);
    assert.doesNotMatch(sdk, /argvAsUiUser\(\[CDP_NODE_BIN, CDP_HELPER_PATH\]\)/);
    assert.doesNotMatch(sdk, /argvAsUiUser\(\["node", CDP_HELPER_PATH\]\)/);
    assert.equal(CDP_NODE_BIN, "/usr/bin/node");
    assert.match(sdk, /chmod 755 \$\{cdpHelper\}/);
    assert.match(sdk, /CdpAxDumpSchema\.safeParse\(parsed\)/);
  });
});

describe("C7 CDP AX mapping", () => {
  it("maps Chrome box-model nodes and refuses guessed bounds", () => {
    const mapped = mapCdpAxDump({
      nodes: [
        {
          backendDOMNodeId: 12,
          ignored: false,
          role: "button",
          name: "Submit",
          contentQuad: [10, 20, 50, 20, 50, 40, 10, 40],
        },
        {
          backendDOMNodeId: 13,
          ignored: false,
          role: "link",
          name: "Skip",
        },
      ],
    });
    assert.equal(mapped.source, "cdp");
    assert.equal(mapped.nodes.length, 2);
    const button = mapped.nodes.find((n) => n.role === "button");
    assert.ok(button);
    assert.equal(button.name, "Submit");
    assert.deepEqual(button.bounds, { x: 10, y: 20, width: 40, height: 20 });
    assert.ok(button.bounds);
    const skipped = mapped.nodes.find((n) => n.role === "link");
    assert.ok(skipped);
    assert.equal(skipped.bounds, undefined);
    const x = button.bounds.x + Math.floor(button.bounds.width / 2);
    const y = button.bounds.y + Math.floor(button.bounds.height / 2);
    assert.equal(x, 30);
    assert.equal(y, 30);
    assert.ok(x >= 0 && x < DISPLAY_WIDTH);
    assert.ok(y >= 0 && y < DISPLAY_HEIGHT);
    assert.equal(validateAction({ type: "click_coordinates", x, y }), null);
  });

  it("preserves focused from the dump flag", () => {
    const mapped = mapCdpAxDump({
      nodes: [
        {
          backendDOMNodeId: 3,
          role: "textbox",
          name: "Q",
          focused: true,
        },
      ],
    });
    assert.equal(mapped.nodes[0]?.focused, true);
  });

  it("rejects garbage dumps instead of inventing AX", () => {
    assert.throws(() => mapCdpAxDump(null));
    assert.throws(() => mapCdpAxDump({}));
    assert.throws(() => mapCdpAxDump({ nodes: "nope" }));
    assert.throws(() => mapCdpAxDump({ nodes: [], error: "nope" }));
  });

  it("fail-closes empty or fully-filtered dumps", () => {
    assert.throws(() => mapCdpAxDump({ nodes: [] }), /cdp ax tree empty/);
    assert.throws(
      () =>
        mapCdpAxDump({
          nodes: [{ ignored: true, backendDOMNodeId: 1, role: "button" }],
        }),
      /cdp ax tree empty/,
    );
    assert.throws(
      () => mapCdpAxDump({ nodes: [{ backendDOMNodeId: 2, role: 1 }] }),
      /cdp ax tree empty/,
    );
  });

  it("keeps helper nodes that have a role even without backendDOMNodeId", () => {
    const mapped = mapCdpAxDump({
      nodes: [
        { role: 1 },
        { backendDOMNodeId: null, role: "button", name: "NullId" },
        {
          backendDOMNodeId: 7,
          role: "custom-role-that-is-definitely-longer-than-sixty-four-characters-xx",
          name: "Keep",
          contentQuad: [0, 0, 8, 0, 8, 8, 0, 8],
        },
      ],
    });
    assert.equal(mapped.source, "cdp");
    assert.equal(mapped.nodes.length, 2);
    assert.equal(mapped.nodes.some((n) => n.name === "NullId"), true);
    const keep = mapped.nodes.find((n) => n.name === "Keep");
    assert.ok(keep);
    assert.equal(keep.role.length, 64);
  });

  it("maps mixed helper stdout JSON", () => {
    const parsed = parseCdpAxHelperStdout('warn\n{"nodes":[{"role":"link","name":"Go"}]}\n');
    const mapped = mapCdpAxDump(parsed);
    assert.equal(mapped.source, "cdp");
    assert.equal(mapped.nodes[0]?.name, "Go");
  });

  it("maps Chrome AXValue-shaped roles instead of dropping the dump", () => {
    const mapped = mapCdpAxDump({
      nodes: [
        {
          backendDOMNodeId: 1,
          role: { value: "RootWebArea" },
          name: { value: "Example Domain" },
        },
        {
          backendDOMNodeId: 2,
          role: { value: "link" },
          name: { value: "More information" },
          contentQuad: [10, 20, 50, 20, 50, 40, 10, 40],
        },
      ],
    });
    assert.equal(mapped.source, "cdp");
    assert.equal(mapped.nodes.length, 2);
    assert.equal(mapped.nodes[0]?.role, "RootWebArea");
    assert.equal(mapped.nodes[0]?.name, "Example Domain");
    assert.equal(mapped.nodes[1]?.name, "More information");
    assert.deepEqual(mapped.nodes[1]?.bounds, { x: 10, y: 20, width: 40, height: 20 });
  });

  it("skips one bad sibling and truncates long roles instead of dropping the dump", () => {
    const mapped = mapCdpAxDump({
      nodes: [
        { role: 1 },
        {
          backendDOMNodeId: 7,
          role: "custom-role-that-is-definitely-longer-than-sixty-four-characters-xx",
          name: "Keep",
          contentQuad: [0, 0, 8, 0, 8, 8, 0, 8],
        },
      ],
    });
    assert.equal(mapped.source, "cdp");
    assert.equal(mapped.nodes.length, 1);
    assert.equal(mapped.nodes[0]?.name, "Keep");
    assert.equal(mapped.nodes[0]?.role.length, 64);
  });

  it("does not clamp off-screen quads into fake on-screen clicks", () => {
    const mapped = mapCdpAxDump({
      nodes: [
        {
          backendDOMNodeId: 99,
          role: "button",
          name: "Off",
          contentQuad: [-10, -10, 10, -10, 10, 10, -10, 10],
        },
        {
          backendDOMNodeId: 100,
          role: "button",
          name: "Far",
          contentQuad: [2000, 0, 2010, 0, 2010, 10, 2000, 10],
        },
        {
          backendDOMNodeId: 101,
          role: "button",
          name: "Thin",
          contentQuad: [10, 10, 10.4, 10, 10.4, 20, 10, 20],
        },
        {
          backendDOMNodeId: 102,
          role: "button",
          name: "Short",
          contentQuad: [1, 2, 3],
        },
      ],
    });
    const off = mapped.nodes.find((n) => n.name === "Off");
    const far = mapped.nodes.find((n) => n.name === "Far");
    const thin = mapped.nodes.find((n) => n.name === "Thin");
    const short = mapped.nodes.find((n) => n.name === "Short");
    assert.equal(off?.bounds, undefined);
    assert.ok(far);
    if (far.bounds) {
      assert.ok(far.bounds.x >= 2000);
      assert.equal(far.bounds.x < DISPLAY_WIDTH, false);
    }
    assert.equal(thin?.bounds, undefined);
    assert.equal(short?.bounds, undefined);
  });

  it("drops ignored nodes and caps at 500", () => {
    const nodes = Array.from({ length: 520 }, (_, i) => ({
      backendDOMNodeId: i + 1,
      ignored: i === 0,
      role: "generic",
      name: `n${i}`,
      contentQuad: [0, 0, 1, 0, 1, 1, 0, 1],
    }));
    const mapped = mapCdpAxDump({ nodes });
    assert.equal(mapped.nodes.length, 500);
    assert.equal(mapped.nodes.some((n) => n.name === "n0"), false);
  });
});

describe("C7 leftover click_element stays fail-closed", () => {
  it("validateAction still rejects click_element", () => {
    const err = validateAction({ type: "click_element", elementId: "x" });
    assert.ok(err);
    assert.match(err, /unsupported/);
  });

  it("Runloop memory observe does not fabricate CDP AX", async () => {
    const p = provider();
    const a = await p.provision({ birdId: "c7-cdp", flockId: "f" });
    const caps = p.capabilities();
    assert.equal(caps.accessibility, false);
    const obs = await p.observe(a.providerRef, { includeScreenshot: true });
    assert.equal(obs.accessibilitySummary, undefined);
    await assert.rejects(
      () => p.observe(a.providerRef, { includeAccessibility: true }),
      (err: unknown) => {
        assert.ok(err instanceof ComputerUseNotAvailable);
        assert.match(
          err.message,
          /guest Chrome CDP is not available on the memory plane/,
        );
        return true;
      },
    );
    const bad = await p.act(a.providerRef, {
      actions: [{ type: "click_element", elementId: "nope" }],
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.results[0]?.success, false);
    assert.match(bad.results[0]?.error ?? "", /unsupported/);
  });
});
