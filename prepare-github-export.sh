#!/bin/bash
set -euo pipefail

SOURCE_DIR="/Users/nasstoragesystem/ops/nas_warden_v2/support/control_plane"
TARGET_DIR="${1:-/Users/nasstoragesystem/ops/nas_warden_control_plane_repo}"
INIT_GIT="${INIT_GIT:-1}"

mkdir -p "$TARGET_DIR"

rsync -av \
  --delete \
  --exclude '.git/' \
  --exclude '.DS_Store' \
  --exclude 'worker/wrangler.toml' \
  --exclude 'repo-export/' \
  "$SOURCE_DIR/" \
  "$TARGET_DIR/"

if [[ "$INIT_GIT" == "1" ]]; then
  if [[ ! -d "$TARGET_DIR/.git" ]]; then
    git -C "$TARGET_DIR" init -b main >/dev/null 2>&1 || git -C "$TARGET_DIR" init >/dev/null 2>&1
  fi
fi

cat <<EOF
Standalone control-plane export prepared at:
  $TARGET_DIR

Next suggested steps:
  cd "$TARGET_DIR"
  git status
  git add .
  git commit -m "Initial NAS Warden control plane scaffold"
EOF
