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
#   worklog.md (maintainer-local handover, gitignored),
#   README.md (documents the 2026-09 Ferrix→Wanyrix rename + FER- prefix rule),
#   src/lib/wanyrix/legacy-migration.ts,
#   tests/unit/legacy-migration.test.ts (AUDIT-I1 regression test — asserts the
#     legacy-key migration itself),
#   docs/PRIVACY.md, docs/ARCHITECTURE.md, docs/USER_GUIDE.md (document the
#     controlled ferrix.* → wanyrix.* storage-migration protocol),
#   src/components/wanyrix/views/settings-view.tsx (live migration-status panel
#     in Settings — surfaces the migration honestly to users),
#   scripts/github/lib.sh, scripts/github/README.md (the GitHub automation
#     kit's bootstrap rename path: WANYRIX_OLD_REPO defaults to the pre-rename
#     Roy-Wanyoike/ferrix slug so bootstrap.sh can still rename a repo that
#     was created under the old name — a functional migration reference,
#     not stray legacy content; consumed by scripts/github/bootstrap.sh).
#
# Usage: bash scripts/check-branding.sh   (prints PASS / violations; exit 0 / 1)

set -u

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 1

PATTERN='ferrix|f-eir|f_eir|FER-[0-9]'

# AUD-12: ripgrep is the fast default, but Ubuntu runners do not ship it —
# the brand gate must still run. Plain grep (with binary skipping and the
# same ERE pattern) is the exact fallback; the gate never silently passes
# because a tool is missing.
if command -v rg >/dev/null 2>&1; then
  SCAN_TOOL=rg
else
  SCAN_TOOL=grep
fi

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
  if [ "$SCAN_TOOL" = rg ]; then
    if [ "${#FILES[@]}" -gt 0 ]; then
      printf '%s\0' ${FILES[@]+"${FILES[@]}"} |
        xargs -0 -r rg -il "$PATTERN" 2>/dev/null
    else
      rg -il "$PATTERN" \
        -g '!node_modules/**' -g '!.next/**' -g '!.git/**' -g '!dev.log' \
        -g '!tool-results/**' -g '!bun.lock' -g '!db/**' . 2>/dev/null
    fi
  else
    # grep fallback (AUD-12): -I skips binaries like rg does; -r scan mirrors
    # the rg glob excludes; `-e` keeps the pattern safe from path-like args.
    if [ "${#FILES[@]}" -gt 0 ]; then
      printf '%s\0' ${FILES[@]+"${FILES[@]}"} |
        xargs -0 -r grep -i -I -l -E -e "$PATTERN" 2>/dev/null
    else
      grep -i -I -r -l -E -e "$PATTERN" \
        --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git \
        --exclude-dir=tool-results --exclude-dir=db \
        --exclude=dev.log --exclude=bun.lock . 2>/dev/null
    fi
  fi
}

while IFS= read -r path; do
  [ -n "$path" ] || continue

  # rg emits ./ prefixes for paths under the scan root — normalize BEFORE
  # whitelist matching so the case patterns below are deterministic.
  path="${path#./}"

  case "$path" in
    worklog.md|README.md|src/lib/wanyrix/legacy-migration.ts|scripts/check-branding.sh|tests/unit/legacy-migration.test.ts|docs/PRIVACY.md|docs/ARCHITECTURE.md|docs/USER_GUIDE.md|src/components/wanyrix/views/settings-view.tsx|scripts/github/lib.sh|scripts/github/README.md)
      # Intentional legacy references — skip. The list is deliberately
      # minimal: every entry documents the rename, implements its
      # storage-migration protocol, or implements the repo-rename
      # bootstrap path (scripts/github/).
      continue
      ;;
  esac

  echo "BRANDING VIOLATION: $path"
  if [ "$SCAN_TOOL" = rg ]; then
    rg -in "$PATTERN" "$path" 2>/dev/null | head -5 | sed 's/^/    > /'
  else
    grep -i -I -n -E -e "$PATTERN" -- "$path" 2>/dev/null | head -5 | sed 's/^/    > /'
  fi
  violations=$((violations + 1))
done < <(scan)

if [ "$violations" -gt 0 ]; then
  echo "FAIL: $violations file(s) outside the whitelist reference legacy brand tokens."
  exit 1
fi

echo "PASS: no legacy brand tokens outside the whitelist."
exit 0
