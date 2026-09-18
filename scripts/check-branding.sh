#!/usr/bin/env bash
#
# Branding gate — Wanyrix product rename (Task 2-a of the Post-Rename Audit).
#
# Fails when any tracked text file OUTSIDE the whitelist still carries legacy
# brand tokens: ferrix | f-eir | f_eir | FER-[0-9] (case-insensitive).
#
# Excluded from scanning: node_modules, .next, .git, dev.log, tool-results/,
# bun.lock, db/.
#
# Whitelisted (intentional legacy mentions, skipped with exit 0):
#   docs/migrations/, docs/audits/, worklog.md, README.md,
#   src/lib/wanyrix/legacy-migration.ts, scripts/check-branding.sh,
#   tests/unit/legacy-migration.test.ts (AUDIT-I1 regression test — asserts the
#     legacy-key migration itself),
#   docs/PRIVACY.md, docs/ARCHITECTURE.md, docs/USER_GUIDE.md (document the
#     controlled ferrix.* → wanyrix.* storage-migration protocol),
#   src/components/wanyrix/views/settings-view.tsx (live migration-status panel
#     in Settings — surfaces the migration honestly to users).
#
# Usage: bash scripts/check-branding.sh   (prints PASS / violations; exit 0 / 1)

set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 1

PATTERN='ferrix|f-eir|f_eir|FER-[0-9]'

# Track a violation counter.
violations=0

# Build the candidate file list: tracked text files when inside a git repo,
# otherwise a directory scan with hard excludes. rg skips binaries and hidden
# files on its own.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mapfile -d '' FILES < <(git ls-files -z -- \
    ':!tool-results' ':!db' ':!bun.lock' ':!dev.log' ':!node_modules' ':!.next')
else
  FILES=()
fi

scan() {
  if [ "${#FILES[@]}" -gt 0 ]; then
    printf '%s\0' ${FILES[@]+"${FILES[@]}"} |
      xargs -0 -r rg -il "$PATTERN" 2>/dev/null
  else
    rg -il "$PATTERN" \
      -g '!node_modules/**' -g '!.next/**' -g '!.git/**' -g '!dev.log' \
      -g '!tool-results/**' -g '!bun.lock' -g '!db/**' . 2>/dev/null
  fi
}

while IFS= read -r path; do
  [ -n "$path" ] || continue

  # rg emits ./ prefixes for paths under the scan root — normalize BEFORE
  # whitelist matching so the case patterns below are deterministic.
  path="${path#./}"

  case "$path" in
    docs/migrations/*|docs/audits/*|worklog.md|README.md|src/lib/wanyrix/legacy-migration.ts|scripts/check-branding.sh|tests/unit/legacy-migration.test.ts|docs/PRIVACY.md|docs/ARCHITECTURE.md|docs/USER_GUIDE.md|src/components/wanyrix/views/settings-view.tsx)
      # Intentional legacy references — skip.
      continue
      ;;
  esac

  echo "BRANDING VIOLATION: $path"
  rg -in "$PATTERN" "$path" 2>/dev/null | head -5 | sed 's/^/    > /'
  violations=$((violations + 1))
done < <(scan)

if [ "$violations" -gt 0 ]; then
  echo "FAIL: $violations file(s) outside the whitelist reference legacy brand tokens."
  exit 1
fi

echo "PASS: no legacy brand tokens outside the whitelist."
exit 0
