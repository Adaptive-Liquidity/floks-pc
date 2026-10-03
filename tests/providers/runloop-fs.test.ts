import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GUEST_FS_MAX_BYTES,
  GUEST_PRIV_FS_MAX_BYTES,
  GUEST_NOFOLLOW_COPY_PY,
  GUEST_NOFOLLOW_DELETE_PY,
  GUEST_NOFOLLOW_LIST_PY,
  GUEST_NOFOLLOW_MKDIR_PY,
  GUEST_NOFOLLOW_READ_B64_PY,
  GUEST_NOFOLLOW_STAT_PY,
  GUEST_NOFOLLOW_WRITE_STDIN_PY,
  GUEST_PRIV_READ_B64_PY,
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

  it("customer guest scripts openat-walk with O_NOFOLLOW and never take the body from argv", () => {
    for (const src of [
      GUEST_NOFOLLOW_STAT_PY,
      GUEST_NOFOLLOW_LIST_PY,
      GUEST_NOFOLLOW_READ_B64_PY,
      GUEST_NOFOLLOW_WRITE_STDIN_PY,
      GUEST_NOFOLLOW_MKDIR_PY,
      GUEST_NOFOLLOW_DELETE_PY,
      GUEST_NOFOLLOW_COPY_PY,
    ]) {
      assert.match(src, /O_NOFOLLOW/);
      assert.match(src, /dir_fd=/);
      assert.match(src, /O_DIRECTORY/);
      assert.equal(src.includes("os.path.realpath"), false);
      assert.equal(src.includes("Function.toString"), false);
    }
    assert.match(GUEST_NOFOLLOW_WRITE_STDIN_PY, /sys\.stdin\.buffer\.read/);
    assert.match(GUEST_NOFOLLOW_WRITE_STDIN_PY, /file too large/);
    assert.match(GUEST_NOFOLLOW_READ_B64_PY, /read_capped/);
    assert.match(GUEST_NOFOLLOW_READ_B64_PY, /file too large/);
    assert.match(GUEST_NOFOLLOW_READ_B64_PY, /def read_capped\(fd, cap=MAX\)/);
    assert.equal(GUEST_NOFOLLOW_WRITE_STDIN_PY.includes("sys.argv[2]"), false);
    assert.equal(GUEST_NOFOLLOW_WRITE_STDIN_PY.includes("b64decode"), false);
    assert.equal(GUEST_FS_MAX_BYTES, 1_000_000);
    assert.equal(GUEST_PRIV_FS_MAX_BYTES, 16_000_000);
    assert.match(GUEST_NOFOLLOW_READ_B64_PY, /MAX=1000000/);
    assert.match(GUEST_PRIV_READ_B64_PY, /MAX=16000000/);
    assert.match(GUEST_PRIV_READ_B64_PY, /ROOT="\/home\/flok-ui\/\.flok-browser"/);
    assert.match(GUEST_PRIV_READ_B64_PY, /def read_capped\(fd, cap=MAX\)/);
  });
});

describe("guest write stdin + openat (local python3)", () => {
  function patchRoot(code: string, root: string, from = "/home/user/flok"): string {
    return code.replace(`ROOT=${JSON.stringify(from)}`, `ROOT=${JSON.stringify(root)}`);
  }

  function runGuest(
    code: string,
    root: string,
    args: string[],
    stdin?: Buffer,
  ): { status: number | null; stdout: Buffer; stderr: string } {
    const r = spawnSync("python3", ["-c", patchRoot(code, root), ...args], {
      input: stdin,
      encoding: undefined,
      maxBuffer: 4_000_000,
    });
    return {
      status: r.status,
      stdout: r.stdout ?? Buffer.alloc(0),
      stderr: (r.stderr ?? Buffer.alloc(0)).toString("utf8"),
    };
  }

  it("round-trips 0 B, 71 KiB, 72 KiB, 200 KiB, max, and rejects max+1", () => {
    const root = mkdtempSync(join(tmpdir(), "flok-fs-"));
    try {
      const sizes = [0, 71 * 1024, 72 * 1024, 200 * 1024, GUEST_FS_MAX_BYTES];
      for (const size of sizes) {
        const path = join(root, `n-${size}.bin`);
        const body = Buffer.alloc(size, size === 0 ? 0 : (size % 251) + 1);
        if (size >= 4) {
          body[0] = 0x00;
          body[1] = 0xff;
          body[2] = 0xfe;
          body[size - 1] = 0x7f;
        }
        const w = runGuest(GUEST_NOFOLLOW_WRITE_STDIN_PY, root, [path], body);
        assert.equal(w.status, 0, `write ${size}: ${w.stderr}`);
        const onDisk = readFileSync(path);
        assert.equal(onDisk.equals(body), true, `disk ${size}`);
        const r = runGuest(GUEST_NOFOLLOW_READ_B64_PY, root, [path]);
        assert.equal(r.status, 0, `read ${size}: ${r.stderr}`);
        assert.equal(bufferFromBase64Stdout(r.stdout.toString("utf8")).equals(body), true);
      }
      const tooBig = join(root, "too-big.bin");
      const over = Buffer.alloc(GUEST_FS_MAX_BYTES + 1, 9);
      const fail = runGuest(GUEST_NOFOLLOW_WRITE_STDIN_PY, root, [tooBig], over);
      assert.notEqual(fail.status, 0);
      assert.match(fail.stderr, /file too large/);
      const planted = join(root, "planted-over.bin");
      writeFileSync(planted, over);
      const readOver = runGuest(GUEST_NOFOLLOW_READ_B64_PY, root, [planted]);
      assert.notEqual(readOver.status, 0);
      assert.match(readOver.stderr, /file too large/);
      const customerHuge = Buffer.alloc(1_000_001, 0x47);
      writeFileSync(join(root, "customer-huge.bin"), customerHuge);
      const customerRead = runGuest(GUEST_NOFOLLOW_READ_B64_PY, root, [join(root, "customer-huge.bin")]);
      assert.notEqual(customerRead.status, 0);
      assert.match(customerRead.stderr, /file too large/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("privileged read of 1.4 MB under .flok-browser succeeds; customer 1_000_001 is FILE_TOO_LARGE", () => {
    const privRoot = mkdtempSync(join(tmpdir(), "flok-priv-"));
    const customerRoot = mkdtempSync(join(tmpdir(), "flok-cust-"));
    try {
      const shot = join(privRoot, "obs-shot.png");
      const body = Buffer.alloc(1_400_000, 0x50);
      body[0] = 0x89;
      body[1] = 0x50;
      body[2] = 0x4e;
      body[body.length - 1] = 0x0a;
      writeFileSync(shot, body);
      const priv = spawnSync(
        "python3",
        [
          "-c",
          patchRoot(GUEST_PRIV_READ_B64_PY, privRoot, "/home/flok-ui/.flok-browser"),
          shot,
        ],
        { encoding: undefined, maxBuffer: 4_000_000 },
      );
      assert.equal(priv.status, 0, (priv.stderr ?? Buffer.alloc(0)).toString("utf8"));
      const got = bufferFromBase64Stdout((priv.stdout ?? Buffer.alloc(0)).toString("utf8"));
      assert.equal(got.equals(body), true);

      const hugePath = join(customerRoot, "already-huge.bin");
      writeFileSync(hugePath, Buffer.alloc(1_000_001, 0x51));
      const customer = runGuest(GUEST_NOFOLLOW_READ_B64_PY, customerRoot, [hugePath]);
      assert.notEqual(customer.status, 0);
      assert.match(customer.stderr, /file too large/);
    } finally {
      rmSync(privRoot, { recursive: true, force: true });
      rmSync(customerRoot, { recursive: true, force: true });
    }
  });

  it("argv-sized bodies hit E2BIG; the same bytes succeed on stdin", () => {
    const huge = Buffer.alloc(200 * 1024, 0x61);
    const argvTry = spawnSync(
      "python3",
      ["-c", "import sys; print(len(sys.argv[1]))", huge.toString("base64")],
      { encoding: "utf8" },
    );
    const argvFailed =
      argvTry.error?.code === "E2BIG" ||
      argvTry.status !== 0 ||
      /E2BIG|Argument list too long/i.test(argvTry.stderr ?? "") ||
      /E2BIG|Argument list too long/i.test(String(argvTry.error ?? ""));
    assert.equal(argvFailed, true, "200 KiB on argv must fail closed");

    const root = mkdtempSync(join(tmpdir(), "flok-stdin-"));
    try {
      const path = join(root, "via-stdin.bin");
      const w = runGuest(GUEST_NOFOLLOW_WRITE_STDIN_PY, root, [path], huge);
      assert.equal(w.status, 0, w.stderr);
      assert.equal(readFileSync(path).equals(huge), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a parent-directory symlink during the openat walk", () => {
    const root = mkdtempSync(join(tmpdir(), "flok-openat-"));
    try {
      const notes = join(root, "notes");
      const evil = join(root, "evil");
      mkdirSync(notes);
      mkdirSync(evil);
      writeFileSync(join(notes, "secret.txt"), "benign");
      writeFileSync(join(evil, "secret.txt"), "pwned-evil");
      rmSync(notes, { recursive: true, force: true });
      symlinkSync(evil, notes);
      const r = runGuest(GUEST_NOFOLLOW_READ_B64_PY, root, [join(root, "notes/secret.txt")]);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /permission denied/);
      assert.equal(readFileSync(join(evil, "secret.txt"), "utf8"), "pwned-evil");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
