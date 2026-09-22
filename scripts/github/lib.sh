#!/usr/bin/env bash
# Shared helpers for the Wanyrix GitHub automation kit.
# See scripts/github/README.md for the full flow.
#
# Honesty note: this kit EXECUTES ONLY with real credentials. Without a token it
# fails loudly — it never fakes success. DRY_RUN=true prints planned commands.

set -euo pipefail

WANYRIX_REPO="${WANYRIX_REPO:-Roy-Wanyoike/wanyrix}"
WANYRIX_OLD_REPO="${WANYRIX_OLD_REPO:-Roy-Wanyoike/ferrix}"
# AUD-12: ONE ledger location — the ops ledger at issues/ (mirrors the
# GitHub issue template 1:1). The former .local/audits/issues split is gone.
ISSUES_DIR="${ISSUES_DIR:-issues}"
MAP_FILE="${MAP_FILE:-.local/audits/CREATED_ISSUES.md}"

die() { echo "FATAL: $*" >&2; exit 1; }

require_gh() {
  command -v gh >/dev/null 2>&1 || die "gh CLI not installed. Run scripts/github/bootstrap.sh first."
}

require_auth() {
  require_gh
  if ! gh auth status >/dev/null 2>&1; then
    die "gh not authenticated. Export GH_TOKEN=<token> (classic token with repo scope) and re-run, or run bootstrap.sh with GH_TOKEN set."
  fi
}

# Extract the first fenced bash block containing `gh issue create` from a record.
# Usage: payload=$(extract_payload <file>)
extract_payload() {
  local file="$1"
  awk '/^```bash/{f=1;next}/^```$/{f=0}f' "$file" \
    | sed -n '/gh issue create/,$p'
}

# Map record filename → record ID (AUDIT-I5, ENG-TCA-3, FINAL-1, ...).
record_id() {
  basename "$1" .md
}

# Create one GitHub issue from a record file. Idempotent: skips when the map
# already lists the record, or when a live search finds an issue with the same title.
create_issue_from_record() {
  local file="$1"
  local id payload title
  id="$(record_id "$file")"
  payload="$(extract_payload "$file")"
  [ -n "$payload" ] || { echo "SKIP $id (no gh issue create payload found)"; return 0; }
  title="$(echo "$payload" | sed -n 's/.*-t[[:space:]]*"\([^"]*\)".*/\1/p')"
  [ -n "$title" ] || die "could not parse -t title from payload in $file"

  if grep -Eq "^[[:space:]]*\| *${id} *[[:space:]]*\|" "$MAP_FILE" 2>/dev/null; then
    echo "SKIP $id (already mapped in $(basename "$MAP_FILE"))"; return 0
  fi

  if [ "${DRY_RUN:-false}" = "true" ]; then
    echo "DRY_RUN would create issue for $id:"
    echo "  title: $title"
    return 0
  fi

  # Duplicate check against the live repo (exact title match).
  local existing
  existing="$(gh issue list -R "$WANYRIX_REPO" --search "\"$title\" in:title" --json number --jq '.[0].number' 2>/dev/null || true)"
  if [ -n "$existing" ] && [ "$existing" != "null" ]; then
    echo "SKIP $id (duplicate found: #$existing)"
    map_issue "$id" "$existing"
    return 0
  fi

  local url number
  url="$(eval "$payload")"
  number="${url##*/}"
  echo "CREATED $id -> #$number ($url)"
  map_issue "$id" "$number"
}

map_issue() {
  local id="$1" number="$2"
  touch "$MAP_FILE"
  if ! grep -Eq "^[[:space:]]*\| *${id} *[[:space:]]*\|" "$MAP_FILE"; then
    printf '| %s | #%s |\n' "$id" "$number" >> "$MAP_FILE"
  fi
}

# Resolve an issue number from the map (empty when absent).
lookup_issue() {
  local id="$1"
  awk -F'|' -v id="$id" '{
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2)
    if ($2 == id) { gsub(/[^0-9]/, "", $3); print $3; exit }
  }' "$MAP_FILE" 2>/dev/null || true
}
