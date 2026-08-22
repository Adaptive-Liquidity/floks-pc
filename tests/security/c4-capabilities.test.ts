/**
 * C4 gate: pair codes + capability tokens.
 * MCP / account-level auth cannot identify a Bot and cannot access a computer.
 *
 * Gate: a valid NOEMA capability cannot access Code's machine even when both
 * Bots share the same account-level MCP connection.
 *
 * FakeProvider only. Zero network. Zero paid Runloop.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  CapabilityExpired,
  CapabilityInvalid,
  CapabilityMissing,
  CapabilityRevoked,
  ComputerService,
  CrossNodeDenied,
  DEFAULT_PAIR_SCOPES,
  FLAGS,
  FakeProvider,
  InsufficientScope,
  InvalidScope,
  MemoryRunloopControlPlane,
  PAIR_IDENTITY_FAILURE_LIMIT,
  PairCodeInvalid,
  RunloopProvider,
  assertNexusDisabled,
  capabilityAuth,
  hashPairCode,
  hashToken,
  sharedAccountAuth,
  sharedOperationAuth,
  NO_OPERATION_AUTH,
} from "../../src/lib/computers/index.js";

const FLOCK = "flock-adaptive";
const SHARED = sharedAccountAuth("xai-team-shared-mcp");
const SECRET_PATH = "/home/flok/workspace/secret.txt";

describe("C4 pairing + capability isolation", () => {
  let provider: FakeProvider;
  let service: ComputerService;

  beforeEach(() => {
    provider = new FakeProvider();
    service = new ComputerService(provider);
  });

  async function provisionAndPair(
    birdId: string,
    opts?: {
      flockId?: string;
      scopes?: readonly ("status" | "exec" | "fs" | "observe" | "act" | "lifecycle" | "shell")[];
      ttlMs?: number;
      capabilityTtlMs?: number;
    },
  ) {
    const flockId = opts?.flockId ?? FLOCK;
    const computer = await service.requestComputer({ birdId, flockId });
    const pairOpts =
      opts?.scopes !== undefined || opts?.ttlMs !== undefined || opts?.capabilityTtlMs !== undefined
        ? {
            ...(opts.scopes !== undefined ? { scopes: opts.scopes } : {}),
            ...(opts.ttlMs !== undefined ? { ttlMs: opts.ttlMs } : {}),
            ...(opts.capabilityTtlMs !== undefined
              ? { capabilityTtlMs: opts.capabilityTtlMs }
              : {}),
          }
        : undefined;
    const issued = await service.issuePairCode(computer.id, pairOpts);
    const paired = await service.pair(
      issued.code,
      { birdId, flockId },
      SHARED,
    );
    return { computer, issued, paired, auth: capabilityAuth(paired.token) };
  }

  async function write(auth: ReturnType<typeof capabilityAuth>, computerId: string, body: string) {
    const result = await service.filesystem(auth, computerId, {
      operation: "write",
      path: SECRET_PATH,
      content: body,
    });
    assert.equal(result.ok, true);
    return result;
  }

  async function read(auth: ReturnType<typeof capabilityAuth>, computerId: string) {
    return service.filesystem(auth, computerId, {
      operation: "read",
      path: SECRET_PATH,
    });
  }

  it("NOEMA cap can access NOEMA computer", async () => {
    const noema = await provisionAndPair("bird-noema");
    await write(noema.auth, noema.computer.id, "noema-private");
    const got = await read(noema.auth, noema.computer.id);
    assert.equal(got.ok, true);
    assert.equal(got.data, "noema-private");
    const st = await service.status(noema.auth, noema.computer.id);
    assert.equal(st.state, "ready");
    const exec = await service.exec(noema.auth, noema.computer.id, {
      argv: ["uname", "-s"],
    });
    assert.equal(exec.exitCode, 0);
  });

  it("Code cap can access Code computer", async () => {
    const code = await provisionAndPair("bird-code");
    await write(code.auth, code.computer.id, "code-private");
    const got = await read(code.auth, code.computer.id);
    assert.equal(got.ok, true);
    assert.equal(got.data, "code-private");
  });

  it("NOEMA cap cannot access Code computer", async () => {
    const noema = await provisionAndPair("bird-noema");
    const code = await provisionAndPair("bird-code");
    await write(code.auth, code.computer.id, "code-only");

    await assert.rejects(
      () => read(noema.auth, code.computer.id),
      (err: unknown) => err instanceof CrossNodeDenied,
    );
    await assert.rejects(
      () =>
        service.exec(noema.auth, code.computer.id, { argv: ["cat", SECRET_PATH] }),
      (err: unknown) => err instanceof CrossNodeDenied,
    );
    await assert.rejects(
      () => service.status(noema.auth, code.computer.id),
      (err: unknown) => err instanceof CrossNodeDenied,
    );

    const still = await read(code.auth, code.computer.id);
    assert.equal(still.data, "code-only");
  });

  it("Code cap cannot access NOEMA computer", async () => {
    const noema = await provisionAndPair("bird-noema");
    const code = await provisionAndPair("bird-code");
    await write(noema.auth, noema.computer.id, "noema-only");

    await assert.rejects(
      () => read(code.auth, noema.computer.id),
      (err: unknown) => err instanceof CrossNodeDenied,
    );
  });

  it("expired cap fails", async () => {
    const noema = await provisionAndPair("bird-noema", { capabilityTtlMs: -1000 });
    await assert.rejects(
      () => read(noema.auth, noema.computer.id),
      (err: unknown) =>
        err instanceof CapabilityExpired &&
        (err as CapabilityExpired).details?.capabilityId === noema.paired.capabilityId,
    );
  });

  it("revoked cap fails", async () => {
    const noema = await provisionAndPair("bird-noema");
    await service.revokeCapability(noema.paired.capabilityId);
    await assert.rejects(
      () => read(noema.auth, noema.computer.id),
      (err: unknown) =>
        err instanceof CapabilityRevoked &&
        (err as CapabilityRevoked).details?.capabilityId === noema.paired.capabilityId,
    );
    const stored = service.getCapability(noema.paired.capabilityId);
    assert.ok(stored.revokedAt);
  });

  it("wrong scope fails", async () => {
    const noema = await provisionAndPair("bird-noema", { scopes: ["status"] });
    const st = await service.status(noema.auth, noema.computer.id);
    assert.equal(st.state, "ready");
    await assert.rejects(
      () => read(noema.auth, noema.computer.id),
      (err: unknown) => err instanceof InsufficientScope,
    );
    await assert.rejects(
      () => service.exec(noema.auth, noema.computer.id, { argv: ["true"] }),
      (err: unknown) => err instanceof InsufficientScope,
    );
  });

  it("reused pair code fails", async () => {
    const computer = await service.requestComputer({
      birdId: "bird-noema",
      flockId: FLOCK,
    });
    const issued = await service.issuePairCode(computer.id);
    await service.pair(issued.code, { birdId: "bird-noema", flockId: FLOCK }, SHARED);
    await assert.rejects(
      () => service.pair(issued.code, { birdId: "bird-noema", flockId: FLOCK }, SHARED),
      (err: unknown) => err instanceof PairCodeInvalid,
    );
  });

  it("missing capability fails", async () => {
    const noema = await provisionAndPair("bird-noema");
    await assert.rejects(
      () =>
        service.filesystem(NO_OPERATION_AUTH, noema.computer.id, {
          operation: "read",
          path: SECRET_PATH,
        }),
      (err: unknown) => err instanceof CapabilityMissing,
    );
  });

  it("digest mismatch fails", async () => {
    const noema = await provisionAndPair("bird-noema");
    await assert.rejects(
      () => read(capabilityAuth("not-the-issued-token"), noema.computer.id),
      (err: unknown) => err instanceof CapabilityInvalid,
    );
  });

  it("raw shared auth without capability fails", async () => {
    const noema = await provisionAndPair("bird-noema");
    const code = await provisionAndPair("bird-code");
    const shared = sharedOperationAuth(SHARED.accountId);

    await assert.rejects(
      () =>
        service.filesystem(shared, noema.computer.id, {
          operation: "read",
          path: SECRET_PATH,
        }),
      (err: unknown) => err instanceof CapabilityMissing,
    );
    await assert.rejects(
      () =>
        service.filesystem(shared, code.computer.id, {
          operation: "write",
          path: SECRET_PATH,
          content: "from-shared-auth",
        }),
      (err: unknown) => err instanceof CapabilityMissing,
    );
    await assert.rejects(
      () => service.exec(shared, noema.computer.id, { argv: ["id"] }),
      (err: unknown) => err instanceof CapabilityMissing,
    );
    await assert.rejects(
      () => service.status(shared, noema.computer.id),
      (err: unknown) => err instanceof CapabilityMissing,
    );
  });

  it("stores only digests, never the raw pair code or capability secret", async () => {
    const computer = await service.requestComputer({
      birdId: "bird-noema",
      flockId: FLOCK,
    });
    const issued = await service.issuePairCode(computer.id);
    const paired = await service.pair(
      issued.code,
      { birdId: "bird-noema", flockId: FLOCK },
      SHARED,
    );

    const storedCode = service.getPairCode(issued.id);
    const storedCap = service.getCapability(paired.capabilityId);
    const blob = JSON.stringify({ storedCode, storedCap, computers: service.list() });

    assert.equal(storedCode.codeDigest, hashPairCode(issued.code));
    assert.equal(storedCap.tokenDigest, hashToken(paired.token));
    assert.equal(blob.includes(issued.code), false);
    assert.equal(blob.includes(paired.token), false);
    assert.equal("code" in storedCode, false);
    assert.equal("token" in storedCap, false);
    assert.equal(storedCap.birdId, "bird-noema");
    assert.equal(storedCap.flockId, FLOCK);
    assert.equal(storedCap.computerId, computer.id);
    for (const scope of DEFAULT_PAIR_SCOPES) {
      assert.ok(storedCap.scopes.includes(scope));
    }
    assert.equal(storedCap.scopes.includes("shell"), false);
  });

  it("exec mode shell requires the shell scope", async () => {
    const noema = await provisionAndPair("bird-noema");
    await assert.rejects(
      () =>
        service.exec(noema.auth, noema.computer.id, {
          argv: ["echo", "hi"],
          mode: "shell",
        }),
      (err: unknown) => err instanceof InsufficientScope,
    );
  });

  it("pair identity must match the computer/bird/flock", async () => {
    const computer = await service.requestComputer({
      birdId: "bird-code",
      flockId: FLOCK,
    });
    const issued = await service.issuePairCode(computer.id);
    await assert.rejects(
      () =>
        service.pair(issued.code, { birdId: "bird-noema", flockId: FLOCK }, SHARED),
      (err: unknown) => err instanceof PairCodeInvalid,
    );
    await assert.rejects(
      () =>
        service.pair(
          issued.code,
          { birdId: "bird-code", flockId: "other-flock" },
          SHARED,
        ),
      (err: unknown) => err instanceof PairCodeInvalid,
    );
  });

  it("expired pair code fails", async () => {
    const computer = await service.requestComputer({
      birdId: "bird-noema",
      flockId: FLOCK,
    });
    const issued = await service.issuePairCode(computer.id, { ttlMs: -1000 });
    await assert.rejects(
      () =>
        service.pair(issued.code, { birdId: "bird-noema", flockId: FLOCK }, SHARED),
      (err: unknown) => err instanceof PairCodeInvalid,
    );
  });

  it("deleting a computer revokes its capabilities", async () => {
    const noema = await provisionAndPair("bird-noema");
    await service.transition(noema.computer.id, "deleting");
    await service.transition(noema.computer.id, "deleted");
    await assert.rejects(
      () => read(noema.auth, noema.computer.id),
      (err: unknown) => err instanceof CapabilityRevoked,
    );
  });

  it("omitted sharedAuth still counts digest misses against Node identity", async () => {
    const identity = { birdId: "bird-noema", flockId: FLOCK };
    await service.requestComputer(identity);
    for (let i = 0; i < PAIR_IDENTITY_FAILURE_LIMIT; i += 1) {
      await assert.rejects(
        () => service.pair(`NOPE-MISS-${i}`, identity),
        (err: unknown) => err instanceof PairCodeInvalid,
      );
    }
    await assert.rejects(
      () => service.pair("NOPE-LIMITED", identity),
      (err: unknown) =>
        err instanceof PairCodeInvalid && (err as PairCodeInvalid).details?.reason === "too many attempts",
    );
  });

  it("digest misses do not DoS a different Bot on the same shared MCP account", async () => {
    const noemaId = { birdId: "bird-noema", flockId: FLOCK };
    const codeId = { birdId: "bird-code", flockId: FLOCK };
    const noemaComputer = await service.requestComputer(noemaId);
    const codeComputer = await service.requestComputer(codeId);
    const codePair = await service.issuePairCode(codeComputer.id);

    for (let i = 0; i < PAIR_IDENTITY_FAILURE_LIMIT; i += 1) {
      await assert.rejects(
        () => service.pair(`NOPE-NOEMA-${i}`, noemaId, SHARED),
        (err: unknown) => err instanceof PairCodeInvalid,
      );
    }
    await assert.rejects(
      () => service.pair("NOPE-NOEMA-BLOCKED", noemaId, SHARED),
      (err: unknown) =>
        err instanceof PairCodeInvalid && (err as PairCodeInvalid).details?.reason === "too many attempts",
    );

    const paired = await service.pair(codePair.code, codeId, SHARED);
    assert.equal(paired.computerHandle, codeComputer.id);
    void noemaComputer;
  });

  it("getCapability scopes.push does not grant shell", async () => {
    const noema = await provisionAndPair("bird-noema");
    await service.status(noema.auth, noema.computer.id);
    const leaked = service.getCapability(noema.paired.capabilityId);
    leaked.scopes.push("shell");
    await assert.rejects(
      () =>
        service.exec(noema.auth, noema.computer.id, {
          argv: ["echo", "hi"],
          mode: "shell",
        }),
      (err: unknown) => err instanceof InsufficientScope,
    );
    const stored = service.getCapability(noema.paired.capabilityId);
    assert.equal(stored.scopes.includes("shell"), false);
  });

  it("invalid issuePairCode scopes leave the previous pair code usable", async () => {
    const computer = await service.requestComputer({
      birdId: "bird-noema",
      flockId: FLOCK,
    });
    const first = await service.issuePairCode(computer.id);
    await assert.rejects(
      () =>
        service.issuePairCode(computer.id, {
          scopes: ["not-a-scope"] as unknown as typeof DEFAULT_PAIR_SCOPES,
        }),
      (err: unknown) => err instanceof InvalidScope,
    );
    const paired = await service.pair(
      first.code,
      { birdId: "bird-noema", flockId: FLOCK },
    );
    assert.ok(paired.token);
    assert.equal(paired.computerHandle, computer.id);
  });

  it("Nexus/graph flags stay locked and C3B Runloop flags are preserved", () => {
    assert.equal(FLAGS.FLOK_NEXUS_IQ_ENABLED, false);
    assert.equal(FLAGS.FLOK_GRAPH_MEMORY_ENABLED, false);
    assertNexusDisabled();
    const runloop = new RunloopProvider({
      client: new MemoryRunloopControlPlane(),
      blueprint: "memory-linux-vm",
    });
    const caps = runloop.capabilities();
    assert.equal(caps.computerUse, true);
    assert.equal(caps.accessibility, false);
    assert.equal(caps.vnc, false);
    assert.equal(caps.pauseMemory, false);
  });
});
