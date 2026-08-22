# FLOKS C3B interactive computer image.
# Built as a Runloop Blueprint (paid). Do not build in ordinary CI.
# Chromium sandbox is preserved: no --no-sandbox.
# Chrome .deb version is recorded at image-build time in /etc/flok-chrome-version
# (not a source pin of a specific .deb; Google's stable channel moves).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    FLOK_DISPLAY=:99 \
    FLOK_DISPLAY_WIDTH=1440 \
    FLOK_DISPLAY_HEIGHT=900 \
    FLOK_DISPLAY_DEPTH=24

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg procps \
      xvfb openbox x11vnc novnc websockify \
      xdotool imagemagick python3 dbus-x11 x11-utils \
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

RUN google-chrome-stable --version > /etc/flok-chrome-version

WORKDIR /home/user/flok
RUN mkdir -p /home/user/flok/.browser/profile /home/user/flok/.flok \
    && chown -R 1000:1000 /home/user/flok || true
