/**
 * Guest file helpers for the Runloop SDK adapter.
 * Customer computer_fs runs these as `flok` with an openat walk (O_NOFOLLOW
 * per component). Writes read the body from stdin — never from argv.
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

/** Stated computer_fs write/read cap. Above this the provider returns FILE_TOO_LARGE. */
export const GUEST_FS_MAX_BYTES = 1_000_000;

/**
 * Privileged screenshot / profile reads under `/home/flok-ui/.flok-browser`.
 * A 1440×900 PNG24 is routinely over the customer 1MB cap.
 */
export const GUEST_PRIV_FS_MAX_BYTES = 16_000_000;

function openatWalk(root: string, maxBytes: number): string {
  return [
    "import os,stat,sys,errno",
    `ROOT=${JSON.stringify(root)}`,
    `MAX=${maxBytes}`,
    "def die(msg, code=1):",
    "    sys.stderr.write(msg); sys.exit(code)",
    "def denied_err(e):",
    "    return e.errno in (errno.EPERM, errno.EACCES, errno.ELOOP, errno.ENOTDIR)",
    "def rel_parts(p):",
    "    p=os.path.normpath(p)",
    "    if p==ROOT: return []",
    "    if not p.startswith(ROOT+'/'): die('permission denied')",
    "    out=[]",
    "    for c in p[len(ROOT)+1:].split('/'):",
    "        if c in ('', '.'): continue",
    "        if c=='..' or '/' in c or '\\0' in c: die('permission denied')",
    "        out.append(c)",
    "    return out",
    "def open_root():",
    "    try:",
    "        st=os.lstat(ROOT)",
    "        if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode): die('permission denied')",
    "        return os.open(ROOT, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOCTTY)",
    "    except OSError as e:",
    "        die('permission denied' if denied_err(e) else 'io error')",
    "def walk_dirs(parts, create=False):",
    "    fd=open_root()",
    "    for name in parts:",
    "        flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOCTTY",
    "        try: nxt=os.open(name, flags, dir_fd=fd)",
    "        except FileNotFoundError:",
    "            if not create:",
    "                os.close(fd); die('not found', 2)",
    "            try: os.mkdir(name, 0o775, dir_fd=fd)",
    "            except OSError as e:",
    "                os.close(fd); die('permission denied' if denied_err(e) else 'io error')",
    "            try: nxt=os.open(name, flags, dir_fd=fd)",
    "            except OSError as e:",
    "                os.close(fd); die('permission denied' if denied_err(e) else 'io error')",
    "        except OSError as e:",
    "            os.close(fd)",
    "            if denied_err(e): die('permission denied')",
    "            die('io error')",
    "        os.close(fd); fd=nxt",
    "    return fd",
    "def openat_file(p, flags, mode=0o644, create_dirs=False):",
    "    parts=rel_parts(p)",
    "    if not parts: die('permission denied')",
    "    name=parts[-1]",
    "    dirfd=walk_dirs(parts[:-1], create=create_dirs)",
    "    try:",
    "        return os.open(name, flags|os.O_NOFOLLOW|os.O_NOCTTY, mode, dir_fd=dirfd)",
    "    except FileNotFoundError:",
    "        die('not found', 2)",
    "    except OSError as e:",
    "        if denied_err(e): die('permission denied')",
    "        die('io error')",
    "    finally:",
    "        os.close(dirfd)",
    "def statat(p):",
    "    parts=rel_parts(p)",
    "    if not parts:",
    "        st=os.lstat(ROOT)",
    "        if stat.S_ISLNK(st.st_mode): die('permission denied')",
    "        return st",
    "    name=parts[-1]",
    "    dirfd=walk_dirs(parts[:-1])",
    "    try:",
    "        st=os.stat(name, dir_fd=dirfd, follow_symlinks=False)",
    "        if stat.S_ISLNK(st.st_mode): die('permission denied')",
    "        return st",
    "    except FileNotFoundError:",
    "        die('not found', 2)",
    "    except OSError as e:",
    "        if denied_err(e): die('permission denied')",
    "        die('io error')",
    "    finally:",
    "        os.close(dirfd)",
    "def read_capped(fd, cap=MAX):",
    "    chunks=[]; remain=cap+1",
    "    while remain>0:",
    "        b=os.read(fd, 65536 if remain>65536 else remain)",
    "        if not b: break",
    "        chunks.append(b); remain-=len(b)",
    "    if remain==0: die('file too large')",
    "    return b''.join(chunks)",
  ].join("\n");
}

const OPENAT_WALK = openatWalk("/home/user/flok", GUEST_FS_MAX_BYTES);
const PRIV_OPENAT_WALK = openatWalk("/home/flok-ui/.flok-browser", GUEST_PRIV_FS_MAX_BYTES);

export const GUEST_NOFOLLOW_STAT_PY = [
  OPENAT_WALK,
  "import json",
  "st=statat(sys.argv[1])",
  "print(json.dumps({'isDir':stat.S_ISDIR(st.st_mode),'size':st.st_size}))",
].join("\n");

export const GUEST_NOFOLLOW_LIST_PY = [
  OPENAT_WALK,
  "import json",
  "p=sys.argv[1]",
  "parts=rel_parts(p)",
  "st=statat(p)",
  "if not stat.S_ISDIR(st.st_mode): die('not found', 2)",
  "dirfd=walk_dirs(parts)",
  "try: print(json.dumps(sorted(os.listdir(dirfd))))",
  "finally: os.close(dirfd)",
].join("\n");

export const GUEST_NOFOLLOW_READ_B64_PY = [
  OPENAT_WALK,
  "import base64",
  "fd=openat_file(sys.argv[1], os.O_RDONLY)",
  "try:",
  "    sys.stdout.write(base64.b64encode(read_capped(fd)).decode())",
  "finally:",
  "    os.close(fd)",
].join("\n");

/** Body comes from stdin. Never from argv (MAX_ARG_STRLEN). */
export const GUEST_NOFOLLOW_WRITE_STDIN_PY = [
  OPENAT_WALK,
  "p=sys.argv[1]",
  "data=sys.stdin.buffer.read(MAX+1)",
  "if len(data)>MAX: die('file too large')",
  "fd=openat_file(p, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o644, create_dirs=True)",
  "try:",
  "    off=0",
  "    while off<len(data):",
  "        n=os.write(fd, data[off:])",
  "        if n<=0: die('io error')",
  "        off+=n",
  "finally:",
  "    os.close(fd)",
].join("\n");

export const GUEST_NOFOLLOW_MKDIR_PY = [
  OPENAT_WALK,
  "fd=walk_dirs(rel_parts(sys.argv[1]), create=True)",
  "os.close(fd)",
].join("\n");

export const GUEST_NOFOLLOW_DELETE_PY = [
  OPENAT_WALK,
  "p=sys.argv[1]",
  "parts=rel_parts(p)",
  "if not parts: die('permission denied')",
  "name=parts[-1]",
  "dirfd=walk_dirs(parts[:-1])",
  "try:",
  "    st=os.stat(name, dir_fd=dirfd, follow_symlinks=False)",
  "except FileNotFoundError:",
  "    os.close(dirfd); die('not found', 2)",
  "if stat.S_ISLNK(st.st_mode) or stat.S_ISREG(st.st_mode):",
  "    os.unlink(name, dir_fd=dirfd)",
  "    os.close(dirfd)",
  "elif stat.S_ISDIR(st.st_mode):",
  "    dfd=os.open(name, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOCTTY, dir_fd=dirfd)",
  "    def wipe(fd):",
  "        for child in os.listdir(fd):",
  "            try: cst=os.stat(child, dir_fd=fd, follow_symlinks=False)",
  "            except FileNotFoundError: continue",
  "            if stat.S_ISDIR(cst.st_mode) and not stat.S_ISLNK(cst.st_mode):",
  "                cfd=os.open(child, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOCTTY, dir_fd=fd)",
  "                wipe(cfd); os.close(cfd); os.rmdir(child, dir_fd=fd)",
  "            else:",
  "                os.unlink(child, dir_fd=fd)",
  "    wipe(dfd); os.close(dfd)",
  "    os.rmdir(name, dir_fd=dirfd)",
  "    os.close(dirfd)",
  "else:",
  "    os.close(dirfd); die('io error')",
].join("\n");

export const GUEST_NOFOLLOW_MOVE_PY = [
  OPENAT_WALK,
  "src,dst=sys.argv[1],sys.argv[2]",
  "sp,dp=rel_parts(src),rel_parts(dst)",
  "if not sp or not dp: die('permission denied')",
  "sdir=walk_dirs(sp[:-1]); ddir=walk_dirs(dp[:-1], create=True)",
  "try:",
  "    st=os.stat(sp[-1], dir_fd=sdir, follow_symlinks=False)",
  "    if stat.S_ISLNK(st.st_mode): die('permission denied')",
  "    try:",
  "        dt=os.stat(dp[-1], dir_fd=ddir, follow_symlinks=False)",
  "        if stat.S_ISLNK(dt.st_mode): die('permission denied')",
  "    except FileNotFoundError:",
  "        pass",
  "    os.rename(sp[-1], dp[-1], src_dir_fd=sdir, dst_dir_fd=ddir)",
  "except FileNotFoundError:",
  "    die('not found', 2)",
  "except OSError as e:",
  "    die('permission denied' if denied_err(e) else 'io error')",
  "finally:",
  "    os.close(sdir); os.close(ddir)",
].join("\n");

export const GUEST_NOFOLLOW_COPY_PY = [
  OPENAT_WALK,
  "src,dst=sys.argv[1],sys.argv[2]",
  "sfd=openat_file(src, os.O_RDONLY)",
  "try:",
  "    data=read_capped(sfd)",
  "finally:",
  "    os.close(sfd)",
  "dfd=openat_file(dst, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o644, create_dirs=True)",
  "try:",
  "    off=0",
  "    while off<len(data):",
  "        n=os.write(dfd, data[off:])",
  "        if n<=0: die('io error')",
  "        off+=n",
  "finally:",
  "    os.close(dfd)",
].join("\n");

/** Platform screenshot / profile paths under /home/flok-ui/.flok-browser. Not computer_fs. */
export const GUEST_PRIV_READ_B64_PY = [
  PRIV_OPENAT_WALK,
  "import base64",
  "fd=openat_file(sys.argv[1], os.O_RDONLY)",
  "try:",
  "    sys.stdout.write(base64.b64encode(read_capped(fd)).decode())",
  "finally:",
  "    os.close(fd)",
].join("\n");

export const GUEST_PRIV_MKDIR_PY = [
  PRIV_OPENAT_WALK,
  "fd=walk_dirs(rel_parts(sys.argv[1]), create=True)",
  "os.close(fd)",
].join("\n");

export const GUEST_PRIV_DELETE_PY = [
  PRIV_OPENAT_WALK,
  "p=sys.argv[1]",
  "parts=rel_parts(p)",
  "if not parts: die('permission denied')",
  "dirfd=walk_dirs(parts[:-1])",
  "try:",
  "    os.unlink(parts[-1], dir_fd=dirfd)",
  "except FileNotFoundError:",
  "    pass",
  "except OSError as e:",
  "    die('permission denied' if denied_err(e) else 'io error')",
  "finally:",
  "    os.close(dirfd)",
].join("\n");
