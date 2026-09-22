#!/usr/bin/env bash
#
# Wanyrix CI referee (issue #92, L2) — the neutral-referee step: measure
# the PR with the engine's own surfaces and publish the envelopes as the
# shared truth. Nobody shares a database; CI output is.
#
# HONESTY (issue #92): GitHub Actions is billing-locked on this repository
# — this script has NEVER run inside a hosted Actions runner. It is
# validated LOCALLY ONLY: `bash -n` plus a full local dry-run against a
# locally built engine binary (GITHUB_STEP_SUMMARY unset → the summary
# takes the /dev/stdout path, so the exact same code lines execute; the
# artifact upload in the workflow is the only runner-specific part).
#
# Contract:
#   - reads nothing but the workspace; writes ONLY ./wanyrix-envelope/
#     and the job summary — the referee never mutates the PR tree;
#   - every envelope is a verbatim wanyrix.* schema (analyze + impact),
#     the exact bytes the CLI prints — zero re-shaping between the
#     operator's CLI and the referee's evidence;
#   - a failed measurement fails the referee (set -e) — no partial
#     referee report pretending success.

set -euo pipefail

PRIMARY_CRATE="${WANYRIX_PRIMARY_CRATE:-wanyrix-engine}"
ROOT="$(git rev-parse --show-toplevel)"
BIN="$ROOT/engine/target/debug/wanyrix"
OUT="${WANYRIX_ENVELOPE_DIR:-$ROOT/wanyrix-envelope}"

test -x "$BIN" || {
    echo "referee: engine binary missing at $BIN — the workflow builds it first (cargo build --locked)" >&2
    exit 1
}

mkdir -p "$OUT"

# The measured surfaces, verbatim envelopes. Run from engine/ — relative
# --path is the engine's own contract (no absolute path in the measured
# artifacts; the envelopes' root field echoes the scan the CI performed).
cd "$ROOT/engine"
"$BIN" analyze --path . --json > "$OUT/analyze.json"
"$BIN" impact --crate "$PRIMARY_CRATE" --path . --json > "$OUT/impact-$PRIMARY_CRATE.json"

# Job summary from the envelopes' OWN numbers (python3 stdlib only — no
# jq dependency). Without a runner, GITHUB_STEP_SUMMARY is unset and the
# summary takes stdout: the same code path a maintainer can dry-run.
python3 - "$OUT" "$PRIMARY_CRATE" >> "${GITHUB_STEP_SUMMARY:-/dev/stdout}" <<'PY'
import json, sys

out_dir, primary = sys.argv[1], sys.argv[2]
a = json.load(open(f"{out_dir}/analyze.json"))
d, s = a["doctor"], a["doctor"]["summary"]
i = json.load(open(f"{out_dir}/impact-{primary}.json"))
print("## Wanyrix referee — measured envelopes (issue #92)")
print()
print("| surface | schema | measured |")
print("|---|---|---|")
print(
    f"| analyze | {a['schema']} | findings {s['total']} "
    f"(critical {s['critical']} · warning {s['warning']} · info {s['info']}) "
    f"over {len(d['crates'])} crates |"
)
print(
    f"| impact ({primary}) | {i['schema']} | transitive dependents {i['transitiveCount']} "
    f"· blast radius {i['blastRadiusPerMille']}‰ |"
)
print()
print(
    "Full envelopes travel with this job as the `wanyrix-referee-envelopes` "
    "artifact — cite those bytes in review, not local opinions."
)
print()
print(
    "_Honesty: GitHub Actions is billing-locked on this repository — "
    "this referee is locally-dry-run-tested only until the first hosted run._"
)
PY

echo "referee: envelopes written to $OUT" >&2
