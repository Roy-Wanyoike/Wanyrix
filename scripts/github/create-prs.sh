#!/usr/bin/env bash
# Step 3 of the Wanyrix GitHub flow: push fix branches and open PRs that
# auto-close their issues via "Closes #N".
#
#   DRY_RUN=true bash scripts/github/create-prs.sh
#   bash scripts/github/create-prs.sh
#
# Branch/issue wiring comes from BRANCHES below (issue numbers resolved from
# the map file written by create-issues.sh). Add entries as new fix branches land.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source "$(dirname "$0")/lib.sh"

[ "${DRY_RUN:-false}" = "true" ] || require_auth

# branch|record-id|pr-title
BRANCHES=(
  "pr/final-1-investor-overview|FINAL-1|docs: investor overview (closes FINAL-1, gate #56)"
  "pr/final-2-registry-index|FINAL-2|docs: index ENG-T3A-1 in issue registry (closes FINAL-2, AUDIT-I10 chain half)"
)

echo "== Opening linked PRs =="
opened=0
for row in "${BRANCHES[@]}"; do
  IFS='|' read -r branch rid title <<< "$row"
  number="$(lookup_issue "$rid")"
  if [ -z "$number" ]; then
    echo "SKIP $branch — no issue number mapped for $rid (run create-issues.sh first)"
    continue
  fi
  if git rev-parse --verify -q "$branch" >/dev/null; then
    if [ "${DRY_RUN:-false}" = "true" ]; then
      echo "DRY_RUN would: git push -u origin $branch; gh pr create --head $branch --title '$title' --body 'Closes #$number'"
      opened=$((opened+1)); continue
    fi
    git push -u origin "$branch"
    if gh pr list -R "$WANYRIX_REPO" --head "$branch" --json number --jq '.[0].number' 2>/dev/null | grep -q '[0-9]'; then
      echo "SKIP PR for $branch (already open)"
      continue
    fi
    gh pr create -R "$WANYRIX_REPO" --base main --head "$branch" \
      --title "$title" \
      --body "Resolves the gap recorded in \`docs/audits/issues/$rid.md\`.

Closes #$number

## Evidence
- Local gates re-run green at the tip of this branch (see branch commits).
- Full audit trail: \`docs/audits/issues/ISSUE_REGISTRY.md\`."
    echo "OPENED PR for $rid (branch $branch, closes #$number)"
    opened=$((opened+1))
  else
    echo "SKIP $branch — branch does not exist locally (created by the fix round)"
  fi
done
echo "DONE: $opened PR path(s) processed."
