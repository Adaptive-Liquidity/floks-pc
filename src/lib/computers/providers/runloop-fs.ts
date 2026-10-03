/**
 * Guest file helpers for the Runloop SDK adapter.
 * Customer computer_fs runs these as `flok` with O_NOFOLLOW.
 * Guest scripts are string constants — never Function.toString().
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

/** True only when UTF-8 encode/decode returns the exact input bytes. */
export function utf8RoundtripEquals(body: Buffer): boolean {
  return Buffer.from(body.toString("utf8"), "utf8").equals(body);
}

export const GUEST_FS_MAX_BYTES = 200_000;

const NOFOLLOW_OPEN = [
  "import os,stat,sys",
  "def die(msg, code=1):",
  "    sys.stderr.write(msg); sys.exit(code)",
  "def lstat_or_missing(p):",
  "    try: return os.lstat(p)",
  "    except FileNotFoundError: return None",
  "    except OSError as e:",
  "        die('permission denied' if e.errno in (1,13) else 'io error')",
  "def refuse_symlink(st, p):",
  "    if st is not None and stat.S_ISLNK(st.st_mode): die('permission denied')",
  "def walk_parents(p):",
  "    cur=os.path.dirname(p)",
  "    seen=[]",
  "    while cur and cur not in seen:",
  "        seen.append(cur)",
  "        st=lstat_or_missing(cur)",
  "        refuse_symlink(st, cur)",
  "        if st is None: return",
  "        if not stat.S_ISDIR(st.st_mode): die('not a directory')",
  "        nxt=os.path.dirname(cur)",
  "        if nxt==cur: break",
  "        cur=nxt",
  "def open_nofollow(p, flags, mode=0o644):",
  "    walk_parents(p)",
  "    refuse_symlink(lstat_or_missing(p), p)",
  "    flags |= os.O_NOFOLLOW | os.O_NOCTTY",
  "    try: return os.open(p, flags, mode)",
  "    except FileNotFoundError: die('not found', 2)",
  "    except OSError as e:",
  "        if e.errno in (1,13,40): die('permission denied')",
  "        die('io error')",
].join("\n");

export const GUEST_NOFOLLOW_STAT_PY = [
  NOFOLLOW_OPEN,
  "import json",
  "p=sys.argv[1]",
  "walk_parents(p)",
  "st=lstat_or_missing(p)",
  "if st is None: die('not found', 2)",
  "refuse_symlink(st, p)",
  "print(json.dumps({'isDir':stat.S_ISDIR(st.st_mode),'size':st.st_size}))",
].join("\n");

export const GUEST_NOFOLLOW_LIST_PY = [
  NOFOLLOW_OPEN,
  "import json",
  "p=sys.argv[1]",
  "walk_parents(p)",
  "st=lstat_or_missing(p)",
  "if st is None: die('not found', 2)",
  "refuse_symlink(st, p)",
  "if not stat.S_ISDIR(st.st_mode): die('not found', 2)",
  "print(json.dumps(sorted(os.listdir(p))))",
].join("\n");

export const GUEST_NOFOLLOW_READ_B64_PY = [
  NOFOLLOW_OPEN,
  "import base64",
  "p=sys.argv[1]",
  "fd=open_nofollow(p, os.O_RDONLY)",
  "try:",
  "    chunks=[]",
  "    while True:",
  "        b=os.read(fd, 65536)",
  "        if not b: break",
  "        chunks.append(b)",
  "    sys.stdout.write(base64.b64encode(b''.join(chunks)).decode())",
  "finally:",
  "    os.close(fd)",
].join("\n");

export const GUEST_NOFOLLOW_WRITE_B64_PY = [
  NOFOLLOW_OPEN,
  "import base64",
  "p=sys.argv[1]",
  "data=base64.b64decode(sys.argv[2])",
  "parent=os.path.dirname(p)",
  "if parent and parent not in ('', '/'):",
  "    walk_parents(p)",
  "    parts=[]",
  "    cur=parent",
  "    while cur and cur not in ('', '/'):",
  "        parts.append(cur)",
  "        nxt=os.path.dirname(cur)",
  "        if nxt==cur: break",
  "        cur=nxt",
  "    for d in reversed(parts):",
  "        st=lstat_or_missing(d)",
  "        refuse_symlink(st, d)",
  "        if st is None:",
  "            try: os.mkdir(d, 0o775)",
  "            except OSError as e:",
  "                die('permission denied' if e.errno in (1,13,40) else 'io error')",
  "        elif not stat.S_ISDIR(st.st_mode):",
  "            die('not a directory')",
  "fd=open_nofollow(p, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o644)",
  "try:",
  "    os.write(fd, data)",
  "finally:",
  "    os.close(fd)",
].join("\n");

export const GUEST_NOFOLLOW_MKDIR_PY = [
  NOFOLLOW_OPEN,
  "p=sys.argv[1]",
  "parts=[]",
  "cur=p",
  "while cur and cur not in ('', '/'):",
  "    parts.append(cur)",
  "    nxt=os.path.dirname(cur)",
  "    if nxt==cur: break",
  "    cur=nxt",
  "for d in reversed(parts):",
  "    st=lstat_or_missing(d)",
  "    refuse_symlink(st, d)",
  "    if st is None:",
  "        try: os.mkdir(d, 0o775)",
  "        except OSError as e:",
  "            die('permission denied' if e.errno in (1,13,40) else 'io error')",
  "    elif not stat.S_ISDIR(st.st_mode):",
  "        die('not a directory')",
].join("\n");

export const GUEST_NOFOLLOW_DELETE_PY = [
  NOFOLLOW_OPEN,
  "p=sys.argv[1]",
  "walk_parents(p)",
  "st=lstat_or_missing(p)",
  "if st is None: die('not found', 2)",
  "if stat.S_ISLNK(st.st_mode) or stat.S_ISREG(st.st_mode):",
  "    os.unlink(p)",
  "elif stat.S_ISDIR(st.st_mode):",
  "    for root, dirs, files in os.walk(p, followlinks=False, topdown=False):",
  "        for name in files:",
  "            os.unlink(os.path.join(root, name))",
  "        for name in dirs:",
  "            fp=os.path.join(root, name)",
  "            os.unlink(fp) if os.path.islink(fp) else os.rmdir(fp)",
  "    os.rmdir(p)",
  "else:",
  "    die('io error')",
].join("\n");

export const GUEST_NOFOLLOW_MOVE_PY = [
  NOFOLLOW_OPEN,
  "src,dst=sys.argv[1],sys.argv[2]",
  "walk_parents(src); walk_parents(dst)",
  "st=lstat_or_missing(src)",
  "if st is None: die('not found', 2)",
  "refuse_symlink(st, src)",
  "refuse_symlink(lstat_or_missing(dst), dst)",
  "try: os.rename(src, dst)",
  "except OSError as e:",
  "    die('permission denied' if e.errno in (1,13,40) else 'io error')",
].join("\n");

export const GUEST_NOFOLLOW_COPY_PY = [
  NOFOLLOW_OPEN,
  "src,dst=sys.argv[1],sys.argv[2]",
  "sfd=open_nofollow(src, os.O_RDONLY)",
  "try:",
  "    chunks=[]",
  "    while True:",
  "        b=os.read(sfd, 65536)",
  "        if not b: break",
  "        chunks.append(b)",
  "    data=b''.join(chunks)",
  "finally:",
  "    os.close(sfd)",
  "dfd=open_nofollow(dst, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o644)",
  "try: os.write(dfd, data)",
  "finally: os.close(dfd)",
].join("\n");

/** Internal control-plane read of a path the platform just created. Not computer_fs. */
export const GUEST_PRIV_READ_B64_PY = [
  "import os,sys,base64",
  "fd=os.open(sys.argv[1], os.O_RDONLY|os.O_NOFOLLOW|os.O_NOCTTY)",
  "try:",
  "    chunks=[]",
  "    while True:",
  "        b=os.read(fd, 65536)",
  "        if not b: break",
  "        chunks.append(b)",
  "    sys.stdout.write(base64.b64encode(b''.join(chunks)).decode())",
  "finally:",
  "    os.close(fd)",
].join("\n");

export const GUEST_PRIV_MKDIR_PY = [
  "import os,sys",
  "os.makedirs(sys.argv[1], exist_ok=True)",
].join("\n");

export const GUEST_PRIV_DELETE_PY = [
  "import os,sys",
  "p=sys.argv[1]",
  "os.unlink(p) if os.path.lexists(p) else None",
].join("\n");
