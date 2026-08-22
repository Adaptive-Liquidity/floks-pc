# FLOKS interactive Runloop Blueprint (C3B)

Canonical personal-computer image for a FLOKS Node. The browser runs **inside**
the Devbox. Browserbase and Kernel are not used.

## Stack

| Component | Role |
|-----------|------|
| Xvfb `:99` | 1440×900×24 private display |
| Openbox | minimal window manager |
| x11vnc | VNC **localhost only** (`-nopw` is acceptable only with `-localhost`) |
| noVNC + websockify | HTTP/WebSocket on `127.0.0.1:6080` |
| xdotool | bounded input (argv, not shell-concatenated) |
| ImageMagick `import` | screenshots; temp PNG deleted after collection |
| Google Chrome stable | browser (sandbox preserved; **no `--no-sandbox`**) |

Profile: `/home/user/flok/.browser/profile` (workspace jail). Two Devboxes never
share this directory.

Chrome's `.deb` is the distro `stable` channel. The image records
`/etc/flok-chrome-version` at build time; that is evidence, not a source pin.

## Build (paid, manual)

```bash
export RUNLOOP_API_KEY=...   # never commit
bash blueprints/runloop-interactive/build.sh
```

Then set GitHub **secret or variable**:

```
FLOK_RUNLOOP_INTERACTIVE_BLUEPRINT=flok-runloop-interactive
```

Ordinary `npm test` / `verify` / PR CI must **not** build this Blueprint.

If Chromium's sandbox is proven incompatible with Runloop Devboxes, document the
failure (exec stderr + kernel/user-ns evidence) before adding `--no-sandbox`.
No such evidence exists yet, so the flag is not used.

## Suspend/resume

Runloop suspend keeps **disk**, not RAM. After resume, FLOKS calls
`ensureInteractiveStack()` again (stale Chrome `SingletonLock` is removed when
the process is gone). Chromium is relaunched against the same profile directory.
In-memory tabs are not preserved.

On the generic C3A Ubuntu Blueprint, `ensureInteractiveStack()` is a no-op
(`ok missing-xvfb`) so compute-only provision still works.

## Takeover

Local noVNC is a private endpoint, not a public URL. `takeover()` stays
fail-closed and `vnc` capability stays `false` until authenticated Runloop
tunnels are wired later. Do not use `auth_mode=open`.
