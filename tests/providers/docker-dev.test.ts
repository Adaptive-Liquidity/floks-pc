/**
 * DockerDevProvider — non-live tests. Zero Docker required.
 * NODE_ENV=production reject + image pin + honest capabilities.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DockerDevProvider,
  DockerDevForbiddenInProduction,
} from "../../src/lib/computers/providers/index.js";

describe("DockerDevProvider (no Docker)", () => {
  it("rejects construction when NODE_ENV=production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      assert.throws(
        () => new DockerDevProvider(),
        (err: unknown) =>
          err instanceof DockerDevForbiddenInProduction &&
          err.code === "PROVIDER_FORBIDDEN_IN_PRODUCTION",
      );
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("constructs without Docker when NODE_ENV is not production", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      const p = new DockerDevProvider();
      assert.ok(p);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("advertises honest (non-VM) capabilities", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      const caps = new DockerDevProvider().capabilities();
      assert.equal(caps.linuxVm, false);
      assert.equal(caps.pauseMemory, false);
      assert.equal(caps.networkPolicy, true);
      assert.equal(caps.vnc, false);
      assert.equal(caps.computerUse, false);
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  it("rejects :latest image pins", () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    try {
      assert.throws(
        () => new DockerDevProvider({ image: "ubuntu:latest" }),
        (err: unknown) =>
          err instanceof Error &&
          "code" in err &&
          (err as { code: string }).code === "IMAGE_PIN_REQUIRED",
      );
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });
});
