# FLOKS C3B interactive computer image.
# Built as a Runloop Blueprint (paid). Do not build in ordinary CI.
#
# Extends the production-v1 DnD workstation (Docker, Node, Python, Git, …)
# so the graphical layer does not strip compute tooling.
# Runloop DnD profile is root; Chrome/Xvfb/Openbox/x11vnc/noVNC run as
# non-root user `flok-ui` (uid 1500). No --no-sandbox.
#
# Chrome .deb version is recorded at image-build time in /etc/flok-chrome-version
# (not a source pin of a specific .deb; Google's stable channel moves).
FROM runloop:runloop/universal-ubuntu-24.04-x86_64-dnd

ENV DEBIAN_FRONTEND=noninteractive \
    FLOK_DISPLAY=:99 \
    FLOK_DISPLAY_WIDTH=1440 \
    FLOK_DISPLAY_HEIGHT=900 \
    FLOK_DISPLAY_DEPTH=24 \
    FLOK_UI_USER=flok-ui \
    FLOK_UI_HOME=/home/flok-ui \
    FLOK_UI_UID=1500

# Graphical stack only. Do not replace Node/Python/Git/Docker from the DnD base.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg procps util-linux \
      xvfb openbox x11vnc novnc websockify \
      xdotool imagemagick dbus-x11 x11-utils \
      fonts-dejavu-core fonts-liberation \
    && mkdir -p /usr/share/keyrings \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
         | gpg --dearmor -o /usr/share/keyrings/google-linux.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
         > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && ln -sf /usr/bin/google-chrome-stable /usr/local/bin/chromium \
    && ln -sf /usr/bin/google-chrome-stable /usr/local/bin/google-chrome \
    && rm -rf /var/lib/apt/lists/*

# Dedicated graphical user. Do NOT `USER flok-ui` — DnD stays root for Docker.
# Chrome's setuid sandbox helper is required because we refuse --no-sandbox.
RUN set -euo pipefail \
    && if ! getent group flok-ui >/dev/null; then groupadd -g 1500 flok-ui; fi \
    && if ! id -u flok-ui >/dev/null 2>&1; then \
         useradd -m -u 1500 -g 1500 -d /home/flok-ui -s /bin/bash flok-ui; \
       fi \
    && mkdir -p /home/user/flok/.browser/profile /home/user/flok/.flok /run/user/1500 \
    && chown root:flok-ui /home/user/flok \
    && chmod 775 /home/user/flok \
    && chown -R flok-ui:flok-ui /home/flok-ui /home/user/flok/.browser /run/user/1500 \
    && chown root:root /home/user/flok/.flok \
    && chmod 755 /home/user/flok/.flok \
    && chmod 700 /home/user/flok/.browser /home/user/flok/.browser/profile /run/user/1500 \
    && SANDBOX="$(find /opt/google -name chrome-sandbox -type f 2>/dev/null | head -1 || true)" \
    && test -n "$SANDBOX" \
    && chmod 4755 "$SANDBOX" \
    && ls -l "$SANDBOX" \
    && echo "flok-ui uid=$(id -u flok-ui) home=/home/flok-ui" > /etc/flok-ui-user \
    && google-chrome-stable --version > /etc/flok-chrome-version \
    && command -v docker >/dev/null \
    && command -v git >/dev/null \
    && command -v python3 >/dev/null \
    && command -v node >/dev/null

# Stay root. Graphical processes drop to flok-ui at runtime via runuser.
WORKDIR /home/user/flok
