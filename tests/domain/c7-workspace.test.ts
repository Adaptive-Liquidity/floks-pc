/**
 * C7 PR1: workspace aliases + per-machine Fake desktop isolation.
 * No accessibility/VNC/takeover (later C7 PRs). FakeProvider only.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ComputerService,
  FakeProvider,
  PathEscape,
  canonicalizeWorkspacePath,
  capabilityAuth,
  getDefaultWorkspaceRoot,
  workspaceRootForProvider,
} from "../../src/lib/computers/index.js";

const FLOCK = "flock-c7";
const ROOT = getDefaultWorkspaceRoot();

describe("C7 workspace aliases", () => {
  it("maps the three prefixes onto the Fake root with segment bounds", () => {
    const fakeRoot = workspaceRootForProvider("fake");
    assert.equal(fakeRoot, ROOT);
    assert.equal(
      canonicalizeWorkspacePath("/home/flok/project/a.txt", fakeRoot),
      `${ROOT}/project/a.txt`,
    );
    assert.equal(
      canonicalizeWorkspacePath("/home/user/flok/project/a.txt", fakeRoot),
      `${ROOT}/project/a.txt`,
    );
    assert.equal(
      canonicalizeWorkspacePath("/workspace/project/a.txt", fakeRoot),
      `${ROOT}/project/a.txt`,
    );
  });

  it("rejects prefix lookalikes and .. before rewrite", () => {
    const fakeRoot = workspaceRootForProvider("fake");
    assert.throws(
      () => canonicalizeWorkspacePath("/workspaceevil/x", fakeRoot),
      (err: unknown) => err instanceof PathEscape,
    );
    assert.throws(
      () => canonicalizeWorkspacePath("/home/flokevil/x", fakeRoot),
      (err: unknown) => err instanceof PathEscape,
    );
    assert.throws(
      () => canonicalizeWorkspacePath("/workspace/../etc/passwd", fakeRoot),
      (err: unknown) => err instanceof PathEscape,
    );
    assert.throws(
      () => canonicalizeWorkspacePath("", fakeRoot),
      (err: unknown) => err instanceof PathEscape,
    );
    assert.throws(
      () => canonicalizeWorkspacePath("/workspace/x\0y", fakeRoot),
      (err: unknown) => err instanceof PathEscape,
    );
    assert.throws(
      () => canonicalizeWorkspacePath("/home/flok2/x", fakeRoot),
      (err: unknown) => err instanceof PathEscape,
    );
    assert.throws(
      () => canonicalizeWorkspacePath("/workspace/proc/self", fakeRoot),
      (err: unknown) => err instanceof PathEscape,
    );
  });

  it("maps aliases onto docker-dev and runloop roots", () => {
    assert.equal(workspaceRootForProvider("docker-dev"), "/workspace");
    assert.equal(workspaceRootForProvider("runloop"), "/home/user/flok");
    assert.equal(
      canonicalizeWorkspacePath("/home/flok/project/a.txt", "/workspace"),
      "/workspace/project/a.txt",
    );
    assert.equal(
      canonicalizeWorkspacePath("/workspace/project/a.txt", "/home/user/flok"),
      "/home/user/flok/project/a.txt",
    );
  });
});

describe("C7 Fake per-machine desktop", () => {
  let provider: FakeProvider;
  let service: ComputerService;

  beforeEach(() => {
    provider = new FakeProvider();
    service = new ComputerService(provider);
  });

  async function provisionAndPair(birdId: string) {
    const computer = await service.requestComputer({ birdId, flockId: FLOCK });
    const issued = await service.issuePairCode(computer.id);
    const paired = await service.pair(issued.code, { birdId, flockId: FLOCK });
    return { computer, auth: capabilityAuth(paired.token) };
  }

  it("reads the same file through all three path prefixes", async () => {
    const { computer, auth } = await provisionAndPair("bird-alias");
    const write = await service.filesystem(auth, computer.id, {
      operation: "write",
      path: "/home/user/flok/project/a.txt",
      content: "alias-ok",
    });
    assert.equal(write.ok, true);
    const viaWorkspace = await service.filesystem(auth, computer.id, {
      operation: "read",
      path: "/workspace/project/a.txt",
    });
    assert.equal(viaWorkspace.ok, true);
    assert.equal(viaWorkspace.data, "alias-ok");
    const viaFlok = await service.filesystem(auth, computer.id, {
      operation: "read",
      path: "/home/flok/project/a.txt",
    });
    assert.equal(viaFlok.ok, true);
    assert.equal(viaFlok.data, "alias-ok");
  });

  it("keeps open_url last-url and profile markers isolated across three Bots", async () => {
    const noema = await provisionAndPair("bird-noema");
    const code = await provisionAndPair("bird-code");
    const research = await provisionAndPair("bird-research");

    const openNoema = await service.act(noema.auth, noema.computer.id, {
      actions: [{ type: "open_url", url: "https://noema.example/" }],
    });
    const openCode = await service.act(code.auth, code.computer.id, {
      actions: [{ type: "open_url", url: "https://code.example/" }],
    });
    assert.equal(openNoema.ok, true);
    assert.equal(openCode.ok, true);

    const obsNoema = await service.observe(noema.auth, noema.computer.id, {});
    const obsCode = await service.observe(code.auth, code.computer.id, {});
    const obsResearch = await service.observe(research.auth, research.computer.id, {});
    assert.equal(obsNoema.activeWindow, "https://noema.example/");
    assert.equal(obsCode.activeWindow, "https://code.example/");
    assert.equal(obsResearch.activeWindow, "Fake Desktop");
    assert.deepEqual(obsNoema.accessibilitySummary, { nodes: 0 });

    const markerNoema = await service.filesystem(noema.auth, noema.computer.id, {
      operation: "read",
      path: "/home/flok/.browser/profile/c7-marker",
    });
    const markerFromCode = await service.filesystem(code.auth, code.computer.id, {
      operation: "read",
      path: "/home/flok/.browser/profile/c7-marker",
    });
    assert.equal(markerNoema.ok, true);
    assert.equal(markerNoema.data, "https://noema.example/");
    assert.equal(markerFromCode.ok, true);
    assert.equal(markerFromCode.data, "https://code.example/");
  });

  it("returns PATH_ESCAPE for lookalike prefixes through ComputerService", async () => {
    const { computer, auth } = await provisionAndPair("bird-escape");
    const lookalike = await service.filesystem(auth, computer.id, {
      operation: "read",
      path: "/workspaceevil/x",
    });
    assert.equal(lookalike.ok, false);
    assert.equal(lookalike.errorCode, "PATH_ESCAPE");
  });

  it("rewrites exec cwd aliases and fail-closes escaped cwd", async () => {
    const { computer, auth } = await provisionAndPair("bird-cwd");
    const aliased = await service.exec(auth, computer.id, {
      argv: ["uname"],
      cwd: "/workspace/project",
    });
    assert.equal(aliased.exitCode, 0);
    assert.match(aliased.stdout, /uname/);
    const escaped = await service.exec(auth, computer.id, {
      argv: ["uname"],
      cwd: "/etc",
    });
    assert.equal(escaped.exitCode, 126);
    assert.match(escaped.stderr, /PATH_ESCAPE/);
  });

  it("fail-closes Fake click_element (no fake browser)", async () => {
    const { computer, auth } = await provisionAndPair("bird-click");
    const clicked = await service.act(auth, computer.id, {
      actions: [{ type: "click_element", elementId: "unused" }],
    });
    assert.equal(clicked.ok, false);
    assert.equal(clicked.results[0]?.success, false);
    assert.match(String(clicked.results[0]?.error), /unsupported/i);
  });

  it("does not delete a file when move aliases collapse to the same path", async () => {
    const { computer, auth } = await provisionAndPair("bird-move-alias");
    const write = await service.filesystem(auth, computer.id, {
      operation: "write",
      path: "/home/user/flok/keep.txt",
      content: "keep-me",
    });
    assert.equal(write.ok, true);
    const moved = await service.filesystem(auth, computer.id, {
      operation: "move",
      path: "/home/user/flok/keep.txt",
      destination: "/workspace/keep.txt",
    });
    assert.equal(moved.ok, true);
    const read = await service.filesystem(auth, computer.id, {
      operation: "read",
      path: "/home/flok/keep.txt",
    });
    assert.equal(read.ok, true);
    assert.equal(read.data, "keep-me");
  });

  it("rejects deleting the workspace root through any alias", async () => {
    const { computer, auth } = await provisionAndPair("bird-del-root");
    await service.filesystem(auth, computer.id, {
      operation: "write",
      path: "/home/flok/keep.txt",
      content: "stay",
    });
    const deleted = await service.filesystem(auth, computer.id, {
      operation: "delete",
      path: "/workspace",
    });
    assert.equal(deleted.ok, false);
    assert.equal(deleted.errorCode, "PATH_ESCAPE");
    const deletedSlash = await service.filesystem(auth, computer.id, {
      operation: "delete",
      path: "/workspace/",
    });
    assert.equal(deletedSlash.ok, false);
    assert.equal(deletedSlash.errorCode, "PATH_ESCAPE");
    const read = await service.filesystem(auth, computer.id, {
      operation: "read",
      path: "/home/flok/keep.txt",
    });
    assert.equal(read.ok, true);
    assert.equal(read.data, "stay");
  });

  it("rejects lookalike destinations and empty exec cwd", async () => {
    const { computer, auth } = await provisionAndPair("bird-dest");
    await service.filesystem(auth, computer.id, {
      operation: "write",
      path: "/home/flok/keep.txt",
      content: "stay",
    });
    const copy = await service.filesystem(auth, computer.id, {
      operation: "copy",
      path: "/home/flok/keep.txt",
      destination: "/workspaceevil/keep.txt",
    });
    assert.equal(copy.ok, false);
    assert.equal(copy.errorCode, "PATH_ESCAPE");
    const emptyCwd = await service.exec(auth, computer.id, {
      argv: ["uname"],
      cwd: "",
    });
    assert.equal(emptyCwd.exitCode, 126);
    assert.match(emptyCwd.stderr, /PATH_ESCAPE/);
  });
});
