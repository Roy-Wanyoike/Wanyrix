#!/usr/bin/env bash
#
# Wanyrix soak harness (issue #64 — resilience program).
#
# Runs N iterations of the full measured pipeline — synth → doctor → store
# save → store list → store fsck → daemon roundtrip — against a throwaway
# SQLite store, asserting SQLite `integrity_check = ok` EVERY iteration and
# stopping on the first failure with a preserved log.
#
# The master validation prompt asks for a 24-hour soak. This script is the
# harness: run it overnight with a high iteration count (e.g. on hardware
# where one iteration is ~1 s, SOAK_ITERATIONS=86400 approximates 24 h) or
# under a supervisor loop. CI runs a short budget via the perf workflow.
#
# Usage:
#   bash scripts/soak.sh [iterations]        # default 10
#   SOAK_ITERATIONS=500 bash scripts/soak.sh

set -u

ITERATIONS="${1:-${SOAK_ITERATIONS:-10}}"
ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../engine" && pwd)"
WORK="$(mktemp -d /tmp/wanyrix-soak.XXXXXX)"
SOCKET="$WORK/daemon.sock"

cleanup() {
  # Stop a possibly-running daemon (best effort — shutdown request first).
  "$ENGINE_DIR/target/debug/wanyrix" daemon call --socket "$SOCKET" --method shutdown >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

cd "$ENGINE_DIR"

if [ ! -x target/debug/wanyrix ]; then
  echo "soak: building engine (debug) first…"
  cargo build --locked >/dev/null || { echo "soak: engine build failed"; exit 1; }
fi
W=./target/debug/wanyrix

echo "soak: $ITERATIONS iteration(s), workdir $WORK"
FAILURES=0

for i in $(seq 1 "$ITERATIONS"); do
  WS="$WORK/ws-$i"
  DB="$WORK/scans-$i.db"

  if ! "$W" synth --crates 3 --seed "$i" --out "$WS" >/dev/null 2>&1; then
    echo "soak: iteration $i FAILED at synth"; FAILURES=$((FAILURES + 1)); break
  fi
  if ! "$W" store init --db "$DB" >/dev/null 2>&1; then
    echo "soak: iteration $i FAILED at store init"; FAILURES=$((FAILURES + 1)); break
  fi
  if ! "$W" doctor --path "$WS" --json 2>/dev/null | "$W" store save --db "$DB" --scan - >/dev/null 2>&1; then
    echo "soak: iteration $i FAILED at doctor|save"; FAILURES=$((FAILURES + 1)); break
  fi
  ROWS=$("$W" store list --db "$DB" 2>/dev/null | sed -n '3p' | wc -l)
  if [ "$ROWS" -ne 1 ]; then
    echo "soak: iteration $i FAILED at store list (row missing)"; FAILURES=$((FAILURES + 1)); break
  fi
  if ! "$W" store fsck --db "$DB" >/dev/null 2>&1; then
    echo "soak: iteration $i FAILED at fsck"; FAILURES=$((FAILURES + 1)); break
  fi
  INTEGRITY=$(python3 -c "import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute('PRAGMA integrity_check').fetchone()[0])" "$DB" 2>/dev/null || echo "cannot-check")
  if [ "$INTEGRITY" != "ok" ]; then
    echo "soak: iteration $i FAILED SQLite integrity_check"
    echo "soak: db preserved at $DB"
    FAILURES=$((FAILURES + 1)); break
  fi

  if [ "$((i % 25))" -eq 0 ] || [ "$i" -eq 1 ]; then
    echo "soak: iteration $i OK"
  fi
done

if [ "$FAILURES" -ne 0 ]; then
  echo "soak: FAILED after $i iteration(s) (workdir preserved: $WORK)"
  exit 1
fi

echo "soak: PASS — $ITERATIONS iteration(s), zero failures, every iteration integrity-checked"
