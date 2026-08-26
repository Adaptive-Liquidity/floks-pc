import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ComputerService, FakeProvider } from "../../src/lib/computers/index.js";
import {
  JsonFileControlPlaneStore,
  MemoryControlPlaneStore,
} from "../../src/lib/computers/control-plane-store.js";

describe("L1 control-plane durability", () => {
  it("survives MCP-equivalent restart without storing raw capability tokens", async () => {
    const store = new MemoryControlPlaneStore();
    const provider = new FakeProvider();
    const first = new ComputerService(provider, { store, ownerId: "op-1", workspaceId: "ws-1" });
    const computer = await first.requestComputer({ birdId: "bird-a", flockId: "flock-a" });
    const issued = await first.issuePairCode(computer.id);
    const paired = await first.pair(issued.code, { birdId: "bird-a", flockId: "flock-a" });

    const second = new ComputerService(provider, { store, ownerId: "op-1", workspaceId: "ws-1" });
    await second.hydrate();
    const remembered = await second.getByBird("bird-a");
    assert.ok(remembered);
    assert.equal(remembered.providerRef, computer.providerRef);
    assert.equal(remembered.birdId, "bird-a");
    assert.equal(remembered.flockId, "flock-a");
    const status = await second.status(
      { kind: "capability", token: paired.token },
      remembered.id,
    );
    assert.equal(status.state, "ready");
  });

  it("json file store never writes a raw capability token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "flok-cp-"));
    const path = join(dir, "control-plane.json");
    const store = new JsonFileControlPlaneStore(path);
    const service = new ComputerService(new FakeProvider(), { store });
    const computer = await service.requestComputer({ birdId: "bird-b", flockId: "flock-b" });
    const issued = await service.issuePairCode(computer.id);
    await service.pair(issued.code, { birdId: "bird-b", flockId: "flock-b" });
    const raw = await readFile(path, "utf8");
    assert.equal(raw.includes(issued.code), false);
    assert.doesNotMatch(raw, /"token":\s*"[A-Za-z0-9+/=_-]{20,}"/);
    assert.match(raw, /"tokenDigest"/);
  });
});
