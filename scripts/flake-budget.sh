#!/usr/bin/env bash
#
# Wanyrix flake-budget runner (issue #64 — resilience program).
#
# The master validation prompt targets 100 consecutive full-suite runs with
# zero flaky failures. This script runs that budget locally: it repeats the
# web (bun) and engine (cargo) suites N times and reports any run that
# changes outcome between repetitions (a flake), as opposed to a stable
# failure (which fails fast on the first run and is a real bug).
#
# Usage:
#   bash scripts/flake-budget.sh [runs]       # default 5, master target 100
#   FLAKE_RUNS=20 bash scripts/flake-budget.sh web   # web suite only
#   FLAKE_RUNS=20 bash scripts/flake-budget.sh engine # engine suite only

set -u

RUNS="${1:-${FLAKE_RUNS:-5}}"
TARGET="${2:-${FLAKE_TARGET:-all}}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fails_web=0
fails_engine=0
flakes=()

run_suite() {
  local name="$1" run="$2" log="$3"
  if [ "$name" = "web" ]; then
    bun test >/dev/null 2>"$log"
  else
    # Locate cargo robustly (rustup default install path or PATH).
    if ! command -v cargo >/dev/null 2>&1; then
      export PATH="$HOME/.cargo/bin:$PATH"
    fi
    (cd engine && cargo test --locked >/dev/null 2>"$log")
  fi
}

for i in $(seq 1 "$RUNS"); do
  if [ "$TARGET" = "all" ] || [ "$TARGET" = "web" ]; then
    log=$(mktemp)
    if run_suite web "$i" "$log"; then :; else
      fails_web=$((fails_web + 1)); flakes+=("web run $i — $(tail -3 "$log" | tr '\n' ' ')")
    fi
    rm -f "$log"
  fi
  if [ "$TARGET" = "all" ] || [ "$TARGET" = "engine" ]; then
    log=$(mktemp)
    if run_suite engine "$i" "$log"; then :; else
      fails_engine=$((fails_engine + 1)); flakes+=("engine run $i — $(tail -3 "$log" | tr '\n' ' ')")
    fi
    rm -f "$log"
  fi
  echo "flake-budget: run $i/$RUNS done"
done

echo "flake-budget: $RUNS run(s) — web failures: $fails_web, engine failures: $fails_engine"
if [ "${#flakes[@]}" -gt 0 ]; then
  printf '  FLAKE/FAIL: %s\n' "${flakes[@]}"
  echo "flake-budget: FAIL (any failure inside the budget blocks release — see issue #64)"
  exit 1
fi
echo "flake-budget: PASS — zero failures across the budget"
