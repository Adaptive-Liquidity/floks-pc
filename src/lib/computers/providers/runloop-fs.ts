/**
 * Guest file helpers for the Runloop SDK adapter.
 * Download/upload can report success with empty bytes while the file exists
 * on disk. Prefer guest-stat size, then UTF-8 read, then base64 exec fallback.
 */

export function fileBytesForUpload(body: Buffer): Uint8Array {
  return Uint8Array.from(body);
}

/** Returns null when download is empty but the guest file is not. */
export function bufferFromDownload(
  arrayBuffer: ArrayBuffer,
  expectedSize: number,
): Buffer | null {
  const buf = Buffer.from(arrayBuffer);
  if (expectedSize > 0 && buf.length === 0) return null;
  return buf;
}

export function bufferFromUtf8Read(text: string, expectedSize: number): Buffer | null {
  const buf = Buffer.from(text, "utf8");
  if (expectedSize > 0 && buf.length === 0) return null;
  return buf;
}

export function bufferFromBase64Stdout(stdout: string): Buffer {
  return Buffer.from(stdout.trim(), "base64");
}

export const GUEST_READ_B64_PY =
  "import sys,base64,pathlib; sys.stdout.write(base64.b64encode(pathlib.Path(sys.argv[1]).read_bytes()).decode())";

export const GUEST_WRITE_B64_PY =
  "import sys,base64,pathlib; pathlib.Path(sys.argv[1]).write_bytes(base64.b64decode(sys.argv[2]))";
