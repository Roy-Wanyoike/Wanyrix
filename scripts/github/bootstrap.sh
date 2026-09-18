#!/usr/bin/env bash
# Step 1 of the Wanyrix GitHub flow: install gh, authenticate, fix remote, push.
# Requirements: a GitHub account with access to the repository and a classic PAT
# with `repo` scope exported as GH_TOKEN.
#
#   GH_TOKEN=github_pat_xxx bash scripts/github/bootstrap.sh
#
# Honesty: fails loudly on any missing prerequisite. Never invents credentials.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
source "$(dirname "$0")/lib.sh"

[ -n "${GH_TOKEN:-}" ] || die "GH_TOKEN is not set. Export a classic PAT with repo scope: GH_TOKEN=... bash $0"

echo "== [1/5] Installing gh CLI (if missing) =="
if ! command -v gh >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    sudo mkdir -p -m 755 /etc/apt/keyrings
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/etc/apt/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
    sudo apt-get update -qq && sudo apt-get install -y -qq gh
  else
    die "gh missing and apt-get unavailable — install gh manually: https://cli.github.com"
  fi
fi
gh --version

echo "== [2/5] Authenticating =="
export GH_TOKEN
gh auth setup-git
gh auth status

echo "== [3/5] Verifying repository access =="
if gh repo view "$WANYRIX_REPO" >/dev/null 2>&1; then
  echo "OK: $WANYRIX_REPO visible"
elif gh repo view "$WANYRIX_OLD_REPO" >/dev/null 2>&1; then
  echo "NOTE: repo still named $WANYRIX_OLD_REPO — renaming to wanyrix"
  gh repo rename wanyrix -R "$WANYRIX_OLD_REPO" --yes
else
  die "Neither $WANYRIX_REPO nor $WANYRIX_OLD_REPO is accessible with this token. Create the repository first (empty, no README) or check token scopes."
fi

echo "== [4/5] Pointing origin at the final repo name =="
git remote set-url origin "https://github.com/$WANYRIX_REPO.git"
git remote -v

echo "== [5/5] Pushing main =="
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
  die "current branch is $CURRENT_BRANCH — run this from main/master"
fi
git push -u origin "$CURRENT_BRANCH"
echo "BOOTSTRAP COMPLETE: origin/$CURRENT_BRANCH is live at https://github.com/$WANYRIX_REPO"
