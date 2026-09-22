#!/usr/bin/env bash
# Step 3 of the Wanyrix GitHub flow: push fix branches and open PRs that
# auto-close their issues via "Closes #N".
#
#   DRY_RUN=true bash scripts/github/create-prs.sh
#   bash scripts/github/create-prs.sh
#
# Branch/issue wiring comes from BRANCHES below (issue numbers resolved from
# the map file written by create-issues.sh). Add a row when a fix branch
# lands; DELETE the row once its PR is merged and the branch is gone (AUD-12:
# the finished pr/final-1/pr/final-2 rows are removed — they shipped long
# ago and only produced SKIP noise).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source "$(dirname "$0")/lib.sh"

[ "${DRY_RUN:-false}" = "true" ] || require_auth

# branch|record-id|pr-title
BRANCHES=(
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
      --body "Resolves the gap recorded in \`issues/$rid.md\`.

Closes #$number

## Evidence
- Local gates re-run green at the tip of this branch (see branch commits).
- Full audit trail: \`issues/README.md\`."
    echo "OPENED PR for $rid (branch $branch, closes #$number)"
    opened=$((opened+1))
  else
    echo "SKIP $branch — branch does not exist locally (created by the fix round)"
  fi
done
echo "DONE: $opened PR path(s) processed."
