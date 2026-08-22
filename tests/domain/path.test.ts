/**
 * Path jail unit tests.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertInsideRoot,
  getDefaultWorkspaceRoot,
  PathEscape,
} from "../../src/lib/computers/index.js";

const ROOT = getDefaultWorkspaceRoot();

describe("path jail", () => {
  it("accepts normal relative paths under root", () => {
    const p = assertInsideRoot("workspace/project/file.txt");
    assert.ok(p.startsWith(ROOT));
    assert.ok(p.includes("workspace/project/file.txt"));
  });

  it("accepts absolute paths that stay under root", () => {
    const p = assertInsideRoot("/home/flok/workspace/x");
    assert.equal(p, "/home/flok/workspace/x");
  });

  it("rejects ../ escape", () => {
    assert.throws(
      () => assertInsideRoot("../etc/passwd"),
      (err: unknown) => err instanceof PathEscape,
    );
  });

  it("rejects deep ../ escape", () => {
    assert.throws(
      () => assertInsideRoot("workspace/../../etc/passwd"),
      (err: unknown) => err instanceof PathEscape,
    );
  });

  it("rejects null bytes", () => {
    assert.throws(
      () => assertInsideRoot("workspace/\0secret"),
      (err: unknown) => err instanceof PathEscape,
    );
  });

  it("rejects empty path", () => {
    assert.throws(
      () => assertInsideRoot(""),
      (err: unknown) => err instanceof PathEscape,
    );
  });

  it("rejects /proc and /sys style paths", () => {
    assert.throws(
      () => assertInsideRoot("proc/self/environ"),
      (err: unknown) => err instanceof PathEscape,
    );
  });
});
