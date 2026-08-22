#!/usr/bin/env bash
# Build the pinned local DockerDev image. Never tags :latest.
set -euo pipefail
cd "$(dirname "$0")"
docker build -t flok-computer-dev:0.0.1 -f Dockerfile.dev .
echo "built flok-computer-dev:0.0.1"
docker image inspect flok-computer-dev:0.0.1 --format '{{.Id}} {{.RepoTags}}'
