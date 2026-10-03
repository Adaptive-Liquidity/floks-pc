import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GUEST_NOFOLLOW_COPY_PY,
  GUEST_NOFOLLOW_DELETE_PY,
  GUEST_NOFOLLOW_LIST_PY,
  GUEST_NOFOLLOW_MKDIR_PY,
  GUEST_NOFOLLOW_READ_B64_PY,
  GUEST_NOFOLLOW_STAT_PY,
  GUEST_NOFOLLOW_WRITE_B64_PY,
  bufferFromBase64Stdout,
  bufferFromDownload,
  bufferFromUtf8Read,
  fileBytesForUpload,
  utf8RoundtripEquals,
} from "../../src/lib/computers/providers/runloop-fs.js";

describe("L1 Runloop guest file helpers", () => {
  it("treats empty download as a miss when the guest file has size", () => {
    const empty = bufferFromDownload(new ArrayBuffer(0), 12);
    assert.equal(empty, null);
  });

  it("keeps a non-empty download", () => {
    const src = Buffer.from("hello-agent");
    const got = bufferFromDownload(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength), 11);
    assert.ok(got);
    assert.equal(got.toString("utf8"), "hello-agent");
  });

  it("falls back from empty UTF-8 read when size is non-zero", () => {
    assert.equal(bufferFromUtf8Read("", 4), null);
    const ok = bufferFromUtf8Read("abcd", 4);
    assert.ok(ok);
    assert.equal(ok.toString("utf8"), "abcd");
  });

  it("decodes guest base64 stdout", () => {
    const buf = bufferFromBase64Stdout(Buffer.from("payload-bytes", "utf8").toString("base64"));
    assert.equal(buf.toString("utf8"), "payload-bytes");
  });

  it("uploads a Uint8Array copy, not a possibly-empty File Buffer view", () => {
    const body = Buffer.from("not-empty");
    const parts = fileBytesForUpload(body);
    assert.equal(parts.byteLength, body.length);
    assert.equal(Buffer.from(parts).toString("utf8"), "not-empty");
  });

  it("rejects UTF-8 writes that would preserve size while corrupting bytes", () => {
    const corrupted = Buffer.from([0xf0, 0x90, 0x80, 0x41]);
    assert.equal(utf8RoundtripEquals(corrupted), false);
    assert.equal(Buffer.from(corrupted.toString("utf8"), "utf8").length, corrupted.length);
    assert.equal(utf8RoundtripEquals(Buffer.from("ascii-ok", "utf8")), true);
  });

  it("customer guest scripts open with O_NOFOLLOW and refuse symlinks", () => {
    for (const src of [
      GUEST_NOFOLLOW_STAT_PY,
      GUEST_NOFOLLOW_LIST_PY,
      GUEST_NOFOLLOW_READ_B64_PY,
      GUEST_NOFOLLOW_WRITE_B64_PY,
      GUEST_NOFOLLOW_MKDIR_PY,
      GUEST_NOFOLLOW_DELETE_PY,
      GUEST_NOFOLLOW_COPY_PY,
    ]) {
      assert.match(src, /O_NOFOLLOW|refuse_symlink|followlinks=False/);
      assert.equal(src.includes("os.path.realpath"), false);
      assert.equal(src.includes("Function.toString"), false);
    }
    assert.match(GUEST_NOFOLLOW_WRITE_B64_PY, /base64.b64decode\(sys.argv\[2\]\)/);
  });
});
