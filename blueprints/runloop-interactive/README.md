# FLOKS interactive Runloop Blueprint (C3B)

Canonical personal-computer image for a FLOKS Node. The browser runs **inside**
the Devbox. Browserbase and Kernel are not used.

## Base

```
FROM runloop:runloop/universal-ubuntu-24.04-x86_64-dnd
```

This keeps the production workstation (Docker-in-Docker, Node, Python, Git).
Runloop's DnD profile is **root**. The graphical stack does **not** run as root.

| Identity | Role |
|----------|------|
| `root` | DnD / control-plane default |
| `flok-ui` (uid 1500, home `/home/flok-ui`) | Xvfb, Openbox, Chrome, x11vnc, websockify |

Workspace stays `/home/user/flok` (group `flok-ui`, mode 775). Browser profile
`/home/user/flok/.browser/profile` is `flok-ui:flok-ui` mode 700.

## Stack

| Component | Role |
|-----------|------|
| Xvfb `:99` | 1440×900×24 private display (as `flok-ui`) |
| Openbox | minimal window manager (as `flok-ui`) |
| x11vnc | VNC **localhost only** (`-nopw` is acceptable only with `-localhost`) |
| noVNC + websockify | HTTP/WebSocket on `127.0.0.1:6080` |
| xdotool | bounded input via `runuser -u flok-ui` (argv, not shell-concatenated) |
| ImageMagick `import` | screenshots; temp PNG deleted after collection |
| Google Chrome stable | browser as `flok-ui` (sandbox preserved; **no `--no-sandbox`**) |

Chrome's `.deb` is the distro `stable` channel. The image records
`/etc/flok-chrome-version` at build time; that is evidence, not a source pin.
`chrome-sandbox` is installed setuid (`chmod 4755`).

## Build (paid, manual)

```bash
export RUNLOOP_API_KEY=...   # never commit
bash blueprints/runloop-interactive/build.sh
```

The script **creates**, then **polls** status:

- continue: `queued`, `provisioning`, `building`
- success only: `build_complete` (prints id / name / status)
- fail: `failed` / `build_failed` (prints build logs)
- fail: timeout (default 1500s; `FLOK_BLUEPRINT_BUILD_TIMEOUT_SEC`)

Do **not** dispatch `runloop-c3` phase `c3b-live` while the Blueprint is still queued or building.

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
the `flok-ui` process is gone). Chromium is relaunched as `flok-ui` against the
same profile directory. In-memory tabs are not preserved.

On the generic C3A Ubuntu Blueprint, `ensureInteractiveStack()` is a no-op
(`ok missing-xvfb`) so compute-only provision still works.

## Takeover

Local noVNC is a private endpoint, not a public URL. `takeover()` stays
fail-closed and `vnc` capability stays `false` until authenticated Runloop
tunnels are wired later. Do not use `auth_mode=open`.
