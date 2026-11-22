#!/usr/bin/env bash
# Fails unless the release marked Latest is still a legacy `v<version>` one.
#
# The old Tauri app updates from releases/latest/download/latest.json. A
# `desktop-v*` or `desktop-channel` release marked Latest would leave every
# copy of it without updates (planner desktop design, 2026-11-22).
#
#   REPO=Jerit3787/planner-release bash scripts/desktop/assert-latest-unchanged.sh
set -euo pipefail

: "${REPO:?set REPO to owner/name}"
tag="$(gh api "repos/$REPO/releases/latest" --jq .tag_name)"
if [[ "$tag" =~ ^v[0-9] ]]; then
  echo "Latest is still $tag."
else
  echo "::error::Latest is now '$tag', which strands the old desktop app's updater. Mark a v<version> release as Latest again."
  exit 1
fi
