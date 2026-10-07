#!/bin/bash
# Idempotent graphical stack for a FLOKS Node Devbox.
# Display :99, Openbox, localhost x11vnc, localhost noVNC — all as flok-ui.
# Does not survive Runloop suspend — call again after resume.
# If Xvfb is not installed (generic C3A Ubuntu Blueprint), exit 0 so
# compute-only provision/resume still works.
set -euo pipefail
export DISPLAY="${FLOK_DISPLAY:-:99}"
WIDTH="${FLOK_DISPLAY_WIDTH:-1440}"
HEIGHT="${FLOK_DISPLAY_HEIGHT:-900}"
DEPTH="${FLOK_DISPLAY_DEPTH:-24}"
PROFILE="${FLOK_BROWSER_PROFILE:-/home/flok-ui/.flok-browser/profile}"
RUNDIR="/tmp/flok-interactive"
NOVNC_PORT="${FLOK_NOVNC_PORT:-6080}"
UI_USER="${FLOK_UI_USER:-flok-ui}"
UI_HOME="${FLOK_UI_HOME:-/home/flok-ui}"
UI_UID="${FLOK_UI_UID:-1500}"
XDG_RUNTIME_DIR="/run/user/${UI_UID}"

mkdir -p "$RUNDIR"
export FLOK_UI_HOME="$UI_HOME"
export FLOK_UI_UID="$UI_UID"
export FLOK_BOT_HOME="/home/user/flok"
python3 - <<'PY'
import os,stat,sys,time
UI_UID=int(os.environ.get('FLOK_UI_UID','1500'))
UI_HOME=os.environ.get('FLOK_UI_HOME','/home/flok-ui')
WS=os.environ.get('FLOK_BOT_HOME','/home/user/flok')
BROWSER_NAME='.flok-browser'
MARKER='.flok-root'
WS_BROWSER='.browser'
UI_SUBDIRS=('.config','.cache','.pki','.local')
NOFOLLOW=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOCTTY
def die(msg):
    sys.stderr.write(msg+'\n'); raise SystemExit(1)
def open_dir(path):
    try: fd=os.open(path, NOFOLLOW)
    except OSError: die('permission denied: cannot open '+path)
    st=os.fstat(fd)
    if not stat.S_ISDIR(st.st_mode):
        os.close(fd); die('not a directory: '+path)
    return fd
def fown(fd, uid, gid, mode):
    os.fchown(fd, uid, gid); os.fchmod(fd, mode)
def has_marker(dirfd):
    try: mfd=os.open(MARKER, os.O_RDONLY|os.O_NOFOLLOW|os.O_NOCTTY, dir_fd=dirfd)
    except OSError: return False
    try:
        st=os.fstat(mfd)
        return stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_uid==0
    finally:
        os.close(mfd)
def write_marker(dirfd):
    flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NOCTTY
    mfd=os.open(MARKER, flags, 0o600, dir_fd=dirfd)
    try:
        os.fchown(mfd, 0, 0); os.fchmod(mfd, 0o600)
    finally:
        os.close(mfd)
def unique_quarantine(dirfd, prefix):
    base='%s.quarantine-%d' % (prefix, int(time.time()))
    name=base; n=0
    while True:
        try: os.stat(name, dir_fd=dirfd, follow_symlinks=False)
        except FileNotFoundError: return name
        n+=1; name='%s-%d' % (base, n)
def ensure_child_dir(dirfd, name, uid, gid, mode):
    try:
        st=os.stat(name, dir_fd=dirfd, follow_symlinks=False)
    except FileNotFoundError:
        st=None
    if st is not None and (stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode)):
        os.rename(name, unique_quarantine(dirfd, name), src_dir_fd=dirfd, dst_dir_fd=dirfd)
        st=None
    if st is None:
        os.mkdir(name, mode, dir_fd=dirfd)
    cfd=os.open(name, NOFOLLOW, dir_fd=dirfd)
    try: fown(cfd, uid, gid, mode)
    finally: os.close(cfd)
def kill_old_workspace_chrome():
    needle='--user-data-dir=/home/user/flok/.browser'
    self=os.getpid()
    pids=[]
    try: names=os.listdir('/proc')
    except OSError: return
    for name in names:
        if not name.isdigit() or int(name)==self: continue
        try:
            if os.stat('/proc/'+name).st_uid!=UI_UID: continue
            cmd=open('/proc/%s/cmdline'%name,'rb').read().replace(b'\x00',b' ').decode('utf-8','replace')
            if needle in cmd and 'google-chrome' in cmd: pids.append(int(name))
        except OSError: continue
    for pid in pids:
        try: os.kill(pid, 15)
        except OSError: pass
    deadline=time.time()+3
    while time.time()<deadline and pids:
        live=[]
        for pid in pids:
            try:
                os.kill(pid, 0); live.append(pid)
            except OSError: pass
        if not live: return
        pids=live; time.sleep(0.1)
    for pid in pids:
        try: os.kill(pid, 9)
        except OSError: pass
    deadline=time.time()+1
    while time.time()<deadline and pids:
        live=[]
        for pid in pids:
            try:
                os.kill(pid, 0); live.append(pid)
            except OSError: pass
        if not live: return
        pids=live; time.sleep(0.05)
def ensure_dir(path, uid, gid, mode):
    parent=os.path.dirname(path); name=os.path.basename(path)
    try:
        st=os.lstat(path)
    except FileNotFoundError:
        st=None
    if st is not None:
        if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
            die('refusing non-directory '+path)
        fd=open_dir(path)
        try: fown(fd, uid, gid, mode)
        finally: os.close(fd)
        return
    pfd=open_dir(parent)
    try:
        try: os.mkdir(name, mode, dir_fd=pfd)
        except FileExistsError: pass
        fd=os.open(name, NOFOLLOW, dir_fd=pfd)
        try: fown(fd, uid, gid, mode)
        finally: os.close(fd)
    finally:
        os.close(pfd)
ensure_dir(UI_HOME, 0, 0, 0o755)
home_fd=open_dir(UI_HOME)
try:
    fown(home_fd, 0, 0, 0o755)
    for sub in UI_SUBDIRS: ensure_child_dir(home_fd, sub, UI_UID, UI_UID, 0o700)
    try: st=os.stat(BROWSER_NAME, dir_fd=home_fd, follow_symlinks=False)
    except FileNotFoundError: st=None
    keep=False
    if st is not None and (not stat.S_ISLNK(st.st_mode)) and stat.S_ISDIR(st.st_mode):
        bfd=os.open(BROWSER_NAME, NOFOLLOW, dir_fd=home_fd)
        try:
            if has_marker(bfd):
                keep=True
                fown(bfd, UI_UID, UI_UID, 0o700)
                ensure_child_dir(bfd, 'profile', UI_UID, UI_UID, 0o700)
        finally:
            os.close(bfd)
    if not keep:
        if st is not None:
            q=unique_quarantine(home_fd, BROWSER_NAME)
            os.rename(BROWSER_NAME, q, src_dir_fd=home_fd, dst_dir_fd=home_fd)
            sys.stderr.write('quarantined untrusted %s/%s -> %s\n' % (UI_HOME, BROWSER_NAME, q))
        os.mkdir(BROWSER_NAME, 0o700, dir_fd=home_fd)
        bfd=os.open(BROWSER_NAME, NOFOLLOW, dir_fd=home_fd)
        try:
            fown(bfd, UI_UID, UI_UID, 0o700)
            write_marker(bfd)
            ensure_child_dir(bfd, 'profile', UI_UID, UI_UID, 0o700)
        finally:
            os.close(bfd)
finally:
    os.close(home_fd)
kill_old_workspace_chrome()
try: wst=os.lstat(os.path.join(WS, WS_BROWSER))
except FileNotFoundError: wst=None
if wst is not None:
    wsfd=open_dir(WS)
    try:
        q=unique_quarantine(wsfd, WS_BROWSER)
        os.rename(WS_BROWSER, q, src_dir_fd=wsfd, dst_dir_fd=wsfd)
        sys.stderr.write('quarantined leftover workspace .browser -> %s\n' % q)
    finally:
        os.close(wsfd)
PY

if ! command -v Xvfb >/dev/null 2>&1; then
  echo "ok missing-xvfb profile=$PROFILE"
  exit 0
fi

if ! id -u "$UI_USER" >/dev/null 2>&1; then
  echo "flok-ui user missing; refuse to start Chrome as root" >&2
  exit 1
fi
if ! command -v runuser >/dev/null 2>&1; then
  echo "runuser missing; refuse to start graphical stack as root" >&2
  exit 1
fi

mkdir -p "$XDG_RUNTIME_DIR" /tmp/.X11-unix
chown -h "$UI_USER:$UI_USER" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
chmod 1777 /tmp/.X11-unix || true
chown -h "$UI_USER:$UI_USER" "$RUNDIR" || true
# Chrome stalls on a missing bus and never opens its debugging port.
if [ ! -S /run/dbus/system_bus_socket ] && command -v dbus-daemon >/dev/null 2>&1; then
  mkdir -p /run/dbus
  dbus-daemon --system --fork || true
fi
SESSION_BUS="$XDG_RUNTIME_DIR/bus"
if [ ! -S "$SESSION_BUS" ] && command -v dbus-daemon >/dev/null 2>&1; then
  runuser -u "$UI_USER" -- dbus-daemon --session --address="unix:path=$SESSION_BUS" --nofork --nopidfile >>/tmp/flok-dbus.log 2>&1 &
  echo $! > "$RUNDIR/dbus.pid"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -S "$SESSION_BUS" ] && break
    sleep 0.1
  done
fi
# Control-plane helpers live in /var/lib/flok (root 0700), never the customer workspace.
CTRL="${FLOK_CONTROL_PLANE_DIR:-/var/lib/flok}"
mkdir -p "$CTRL"
if [ -L "$CTRL" ]; then
  echo "refusing symlink $CTRL" >&2
  exit 1
fi
chown -h root:root "$CTRL"
chmod 0700 "$CTRL"
for helper in execvp.py ensure-interactive.sh ensure-bot-user.sh cdp-ax.mjs cdp-nav.mjs; do
  if [ -f "$CTRL/$helper" ] && [ ! -L "$CTRL/$helper" ]; then
    chown -h root:root "$CTRL/$helper"
    chmod 0700 "$CTRL/$helper"
  fi
done
rm -rf /home/user/flok/.flok
python3 - <<'PY'
import os,stat,sys,time
UI_UID=int(os.environ.get('FLOK_UI_UID','1500'))
UI_HOME=os.environ.get('FLOK_UI_HOME','/home/flok-ui')
WS=os.environ.get('FLOK_BOT_HOME','/home/user/flok')
BROWSER_NAME='.flok-browser'
MARKER='.flok-root'
WS_BROWSER='.browser'
UI_SUBDIRS=('.config','.cache','.pki','.local')
NOFOLLOW=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NOCTTY
def die(msg):
    sys.stderr.write(msg+'\n'); raise SystemExit(1)
def open_dir(path):
    try: fd=os.open(path, NOFOLLOW)
    except OSError: die('permission denied: cannot open '+path)
    st=os.fstat(fd)
    if not stat.S_ISDIR(st.st_mode):
        os.close(fd); die('not a directory: '+path)
    return fd
def fown(fd, uid, gid, mode):
    os.fchown(fd, uid, gid); os.fchmod(fd, mode)
def has_marker(dirfd):
    try: mfd=os.open(MARKER, os.O_RDONLY|os.O_NOFOLLOW|os.O_NOCTTY, dir_fd=dirfd)
    except OSError: return False
    try:
        st=os.fstat(mfd)
        return stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_uid==0
    finally:
        os.close(mfd)
def write_marker(dirfd):
    flags=os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NOCTTY
    mfd=os.open(MARKER, flags, 0o600, dir_fd=dirfd)
    try:
        os.fchown(mfd, 0, 0); os.fchmod(mfd, 0o600)
    finally:
        os.close(mfd)
def unique_quarantine(dirfd, prefix):
    base='%s.quarantine-%d' % (prefix, int(time.time()))
    name=base; n=0
    while True:
        try: os.stat(name, dir_fd=dirfd, follow_symlinks=False)
        except FileNotFoundError: return name
        n+=1; name='%s-%d' % (base, n)
def ensure_child_dir(dirfd, name, uid, gid, mode):
    try:
        st=os.stat(name, dir_fd=dirfd, follow_symlinks=False)
    except FileNotFoundError:
        st=None
    if st is not None and (stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode)):
        os.rename(name, unique_quarantine(dirfd, name), src_dir_fd=dirfd, dst_dir_fd=dirfd)
        st=None
    if st is None:
        os.mkdir(name, mode, dir_fd=dirfd)
    cfd=os.open(name, NOFOLLOW, dir_fd=dirfd)
    try: fown(cfd, uid, gid, mode)
    finally: os.close(cfd)
def kill_old_workspace_chrome():
    needle='--user-data-dir=/home/user/flok/.browser'
    self=os.getpid()
    pids=[]
    try: names=os.listdir('/proc')
    except OSError: return
    for name in names:
        if not name.isdigit() or int(name)==self: continue
        try:
            if os.stat('/proc/'+name).st_uid!=UI_UID: continue
            cmd=open('/proc/%s/cmdline'%name,'rb').read().replace(b'\x00',b' ').decode('utf-8','replace')
            if needle in cmd and 'google-chrome' in cmd: pids.append(int(name))
        except OSError: continue
    for pid in pids:
        try: os.kill(pid, 15)
        except OSError: pass
    deadline=time.time()+3
    while time.time()<deadline and pids:
        live=[]
        for pid in pids:
            try:
                os.kill(pid, 0); live.append(pid)
            except OSError: pass
        if not live: return
        pids=live; time.sleep(0.1)
    for pid in pids:
        try: os.kill(pid, 9)
        except OSError: pass
    deadline=time.time()+1
    while time.time()<deadline and pids:
        live=[]
        for pid in pids:
            try:
                os.kill(pid, 0); live.append(pid)
            except OSError: pass
        if not live: return
        pids=live; time.sleep(0.05)
def ensure_dir(path, uid, gid, mode):
    parent=os.path.dirname(path); name=os.path.basename(path)
    try:
        st=os.lstat(path)
    except FileNotFoundError:
        st=None
    if st is not None:
        if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
            die('refusing non-directory '+path)
        fd=open_dir(path)
        try: fown(fd, uid, gid, mode)
        finally: os.close(fd)
        return
    pfd=open_dir(parent)
    try:
        try: os.mkdir(name, mode, dir_fd=pfd)
        except FileExistsError: pass
        fd=os.open(name, NOFOLLOW, dir_fd=pfd)
        try: fown(fd, uid, gid, mode)
        finally: os.close(fd)
    finally:
        os.close(pfd)
ensure_dir(UI_HOME, 0, 0, 0o755)
home_fd=open_dir(UI_HOME)
try:
    fown(home_fd, 0, 0, 0o755)
    for sub in UI_SUBDIRS: ensure_child_dir(home_fd, sub, UI_UID, UI_UID, 0o700)
    try: st=os.stat(BROWSER_NAME, dir_fd=home_fd, follow_symlinks=False)
    except FileNotFoundError: st=None
    keep=False
    if st is not None and (not stat.S_ISLNK(st.st_mode)) and stat.S_ISDIR(st.st_mode):
        bfd=os.open(BROWSER_NAME, NOFOLLOW, dir_fd=home_fd)
        try:
            if has_marker(bfd):
                keep=True
                fown(bfd, UI_UID, UI_UID, 0o700)
                ensure_child_dir(bfd, 'profile', UI_UID, UI_UID, 0o700)
        finally:
            os.close(bfd)
    if not keep:
        if st is not None:
            q=unique_quarantine(home_fd, BROWSER_NAME)
            os.rename(BROWSER_NAME, q, src_dir_fd=home_fd, dst_dir_fd=home_fd)
            sys.stderr.write('quarantined untrusted %s/%s -> %s\n' % (UI_HOME, BROWSER_NAME, q))
        os.mkdir(BROWSER_NAME, 0o700, dir_fd=home_fd)
        bfd=os.open(BROWSER_NAME, NOFOLLOW, dir_fd=home_fd)
        try:
            fown(bfd, UI_UID, UI_UID, 0o700)
            write_marker(bfd)
            ensure_child_dir(bfd, 'profile', UI_UID, UI_UID, 0o700)
        finally:
            os.close(bfd)
finally:
    os.close(home_fd)
kill_old_workspace_chrome()
try: wst=os.lstat(os.path.join(WS, WS_BROWSER))
except FileNotFoundError: wst=None
if wst is not None:
    wsfd=open_dir(WS)
    try:
        q=unique_quarantine(wsfd, WS_BROWSER)
        os.rename(WS_BROWSER, q, src_dir_fd=wsfd, dst_dir_fd=wsfd)
        sys.stderr.write('quarantined leftover workspace .browser -> %s\n' % q)
    finally:
        os.close(wsfd)
PY
chmod 1775 /home/user/flok || true
if [ -L /tmp/flok-chrome.log ] || { [ -e /tmp/flok-chrome.log ] && [ ! -f /tmp/flok-chrome.log ]; }; then
  echo "refusing to use /tmp/flok-chrome.log: not a regular file" >&2
  ls -ld /tmp/flok-chrome.log >&2
  exit 1
fi
touch /tmp/flok-chrome.log
if [ -L /tmp/flok-chrome.log ]; then
  echo "refusing to use /tmp/flok-chrome.log: not a regular file" >&2
  exit 1
fi
chown --no-dereference "$UI_USER:$UI_USER" /tmp/flok-chrome.log
chmod 640 /tmp/flok-chrome.log
if ! runuser -u "$UI_USER" -- test -w "$PROFILE"; then
  echo "profile not writable by $UI_USER: $PROFILE" >&2
  ls -ld "$PROFILE" "$UI_HOME/.flok-browser" "$UI_HOME" /home/user/flok >&2
  exit 1
fi

alive() {
  local pf="$1"
  if [ -f "$pf" ]; then
    local pid
    pid="$(cat "$pf")"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

start_ui() {
  local name="$1"
  shift
  local pidfile="$RUNDIR/${name}.pid"
  local logfile="/tmp/flok-${name}.log"
  local pid
  pid="$(
    runuser -u "$UI_USER" -- env \
      DISPLAY="$DISPLAY" \
      HOME="$UI_HOME" \
      XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus" \
      sh -c 'log="$1"; shift; nohup "$@" >>"$log" 2>&1 & echo $!' sh "$logfile" "$@"
  )"
  echo "$pid" > "$pidfile"
}

# Suspend kills Chrome but leaves SingletonLock on disk.
if ! pgrep -u "$UI_USER" -f -- "--user-data-dir=${PROFILE}" >/dev/null 2>&1; then
  rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie"
fi

if ! alive "$RUNDIR/xvfb.pid"; then
  rm -f /tmp/.X11-unix/X99 /tmp/.X99-lock
  start_ui xvfb Xvfb "$DISPLAY" -screen 0 "${WIDTH}x${HEIGHT}x${DEPTH}" -nolisten tcp
  sleep 0.4
fi
if ! alive "$RUNDIR/openbox.pid"; then
  start_ui openbox openbox
fi
if command -v xsetroot >/dev/null 2>&1; then
  runuser -u "$UI_USER" -- env DISPLAY="$DISPLAY" HOME="$UI_HOME" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus" xsetroot -solid '#1f2933' || true
fi
if command -v x11vnc >/dev/null 2>&1 && ! alive "$RUNDIR/x11vnc.pid"; then
  start_ui x11vnc x11vnc -display "$DISPLAY" -localhost -nopw -forever -shared -rfbport 5900
fi
if command -v websockify >/dev/null 2>&1 && ! alive "$RUNDIR/novnc.pid"; then
  WEB=""
  for d in /usr/share/novnc /usr/share/novnc/utils; do
    if [ -d "$d" ]; then WEB="$d"; break; fi
  done
  if [ -n "$WEB" ]; then
    start_ui novnc websockify --web "$WEB" "127.0.0.1:${NOVNC_PORT}" 127.0.0.1:5900
  fi
fi
if [ -L /run/flok-cdp ]; then
  echo "refusing symlink /run/flok-cdp" >&2
  exit 1
fi
mkdir -p /run/flok-cdp
chown -h root:root /run/flok-cdp
chmod 0700 /run/flok-cdp
echo "ok display=$DISPLAY profile=$PROFILE ui=$UI_USER"
