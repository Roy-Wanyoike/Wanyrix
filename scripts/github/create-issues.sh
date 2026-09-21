#!/usr/bin/env bash
# Step 2 of the Wanyrix GitHub flow: file every audit issue from its record.
# Idempotent — safe to re-run (per-record map + live duplicate check).
#
#   DRY_RUN=true bash scripts/github/create-issues.sh   # preview, no side effects
#   bash scripts/github/create-issues.sh                # requires auth (bootstrap.sh)

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source "$(dirname "$0")/lib.sh"

[ "${DRY_RUN:-false}" = "true" ] || require_auth

mkdir -p "$(dirname "$MAP_FILE")"
if [ "${DRY_RUN:-false}" != "true" ] && [ ! -f "$MAP_FILE" ]; then
  printf '# Created issues map — record ID → GitHub issue number\n\n| Record | Issue |\n| --- | --- |\n' > "$MAP_FILE"
fi

echo "== Filing audit issues from $ISSUES_DIR =="
created=0; skipped=0
for f in "$ISSUES_DIR"/*.md; do
  id="$(record_id "$f")"
  [ "$id" = "ISSUE_REGISTRY" ] && continue   # registry is the index, not a record
  out="$(create_issue_from_record "$f")"
  echo "$out"
  case "$out" in
    CREATED*|"DRY_RUN would create"*) created=$((created+1));;
    SKIP*) skipped=$((skipped+1));;
  esac
done
echo "DONE: $created filed (or would-file in DRY_RUN), $skipped skipped/mapped. Map: $MAP_FILE"
