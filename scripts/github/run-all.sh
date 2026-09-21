#!/usr/bin/env bash
# One-shot entry point for the full Wanyrix GitHub flow.
#
#   DRY_RUN=true GH_TOKEN=... bash scripts/github/run-all.sh   # preview
#   GH_TOKEN=... bash scripts/github/run-all.sh                # execute
#
# Steps: bootstrap (install+auth+push) → file issues → open linked PRs.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
DIR="$(dirname "$0")"

echo "================ STEP 1/3: bootstrap ================"
bash "$DIR/bootstrap.sh"

echo "================ STEP 2/3: create issues ============"
bash "$DIR/create-issues.sh"

echo "================ STEP 3/3: create PRs ==============="
bash "$DIR/create-prs.sh"

echo "ALL DONE. Verify at: https://github.com/${WANYRIX_REPO:-Roy-Wanyoike/wanyrix}"
