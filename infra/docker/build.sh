#!/usr/bin/env bash
# Build the pinned local DockerDev image. Never tags :latest.
# runtime_tag in image-pin.txt is the single source of truth for the tag.
# The locally built image ID is printed as CI/gate evidence, not a source pin.
set -euo pipefail
cd "$(dirname "$0")"
TAG="$(sed -n 's/^runtime_tag=//p' image-pin.txt)"
if [ -z "$TAG" ]; then
  echo "runtime_tag missing from image-pin.txt" >&2
  exit 1
fi
if [[ "$TAG" == *:latest ]]; then
  echo "refusing to build :latest ($TAG)" >&2
  exit 1
fi
docker build -t "$TAG" -f Dockerfile.dev .
echo "built $TAG"
echo "runtime image id (CI/gate evidence, not a source pin):"
docker image inspect "$TAG" --format '{{.Id}}'
