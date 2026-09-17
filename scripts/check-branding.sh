#!/usr/bin/env bash
# Wanyrix branding gate — CI validation script (identity migration, §20).
#
# Fails if forbidden stale "Ferrix" branding appears in production-controlled
# files. Legitimate residual references are allowed ONLY in:
#   - docs/migrations/           (historical migration documentation)
#   - worklog.md                 (engineering handover history)
#   - README.md                  (Brand history section — intentional historical note)
#   - src/lib/wanyrix/legacy-migration.ts (explicit backward-compat layer)
#   - this script                (pattern definitions)
#   - git internals / lockfiles / build output (not product identity)
#
# Usage: scripts/check-branding.sh   (exit 0 = pass, exit 1 = stale branding)

set -uo pipefail

cd "$(dirname "$0")/.."

ALLOWED_PATHS=(
  '^docs/migrations/'
  '^worklog\.md$'
  '^README\.md$'
  '^src/lib/wanyrix/legacy-migration\.ts$'
  '^scripts/check-branding\.sh$'
)

PATTERN='ferrix|f-eir|f_eir|FER-[0-9]'

is_allowed() {
  local path="$1"
  for re in "${ALLOWED_PATHS[@]}"; do
    if [[ "$path" =~ $re ]]; then
      return 0
    fi
  done
  return 1
}

violations=0
while IFS= read -r line; do
  path="${line%%:*}"
  path="${path#./}"   # normalize rg's leading ./ so anchored rules match
  if ! is_allowed "$path"; then
    if [ "$violations" -eq 0 ]; then
      echo "✗ Stale Ferrix branding found (product identity is Wanyrix):" >&2
    fi
    echo "    $line" >&2
    violations=$((violations + 1))
  fi
done < <(rg -n -i "$PATTERN" \
  -g '!node_modules' -g '!.next' -g '!.git' -g '!bun.lock' -g '!dev.log' \
  -g '!tool-results' -g '!db' -g '!*.png' -g '!*.db' \
  . 2>/dev/null || true)

if [ "$violations" -gt 0 ]; then
  echo >&2
  echo "BRANDING GATE: FAIL — $violations stale reference(s). Move them to docs/migrations/ or remove." >&2
  exit 1
fi

echo "BRANDING GATE: PASS — 0 unexpected Ferrix references in production files."
exit 0
