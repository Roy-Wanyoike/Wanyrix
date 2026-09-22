# Wanyrix Dogfooding — Wanyrix analyzes Wanyrix (EPIC 49 / issue #72)

> **Historical snapshot (engine v0.8.0-era record).** Every number below was
> pasted from a REAL run at execution time — no illustrative figures — but it
> documents the **wanyrix 0.8.0** binary built from this repository at commit
> `79fef79` (PR #75 merge). It is kept verbatim as the dogfooding methodology
> reference and the origin of the follow-up work listed at the bottom; it is
> NOT a claim about the current engine. v0.9.0-era evidence lives in
> [`engine/BENCHMARKS.md`](../engine/BENCHMARKS.md) and
> [`docs/PERFORMANCE.md`](PERFORMANCE.md). Host: this repo's sandbox (Linux
> x86_64). Audit context: `docs/AUDIT.md` (EPIC 00).

## What was run

The final-product path from the master prompt, exercised end-to-end against
this repository's engine workspace (`/home/z/my-project/engine`, 63 scanned
crates — the engine itself plus its fixture workspaces):

```text
wanyrix --version          → wanyrix 0.8.0
wanyrix git                → wanyrix.git/v1           (real repo facts)
wanyrix impact --crate …   → wanyrix.impact/v1        (measured blast radius)
wanyrix what-changed       → wanyrix.what-changed/v1  (real baseline diff)
wanyrix doctor             → wanyrix.doctor/v1        (95 measured findings)
wanyrix build              → wanyrix.build/v1         (REAL instrumented cargo build)
```

## Measured results

### Git facts (issue #67) — the chain link that did not exist before this round

```json
{
  "branch": "main",
  "head": "79fef79bc070d0aa60c542fefebb9c1507112e7d",
  "dirty": false,
  "changedFilesCount": 0,
  "changedCrates": [],
  "commitCount": 108,
  "recentCommits": "<10 newest, subjects + timestamps only — redacted by design>"
}
```

Clean tree at audit time: the round's own work was committed and merged
before dogfooding — the tool reports what it measures, including its own
merge history in `recentCommits`.

### Change impact (issue #68) — deterministic, no AI

```json
{
  "crateName": "wanyrix-engine",
  "transitiveCount": 0,
  "workspaceCrateCount": 63,
  "blastRadiusPerMille": 15,
  "directDependents": []
}
```

Correct: the engine crate is the workspace root — nothing depends on it, so
the blast radius is exactly `1/63` of the workspace (15‰, integer math).

### Instrumented build — MEASURED cache behavior

```text
wallClockMs:    1799   (durationStatus: "measured — wall clock around the cargo process")
buildSuccess:   true
cacheHitRate:   96     measured (fresh flags from the cargo JSON stream)
artifacts:      60 total, 58 fresh
```

The workspace was already built locally, so the measured run is dominated by
fresh artifacts — exactly what an honest cache-hit measurement should show.
`wanyrix build` never fabricates timing when a build is cold; it measures
whatever the real cargo process does.

### What changed — baseline diff against a real scan store

```text
baseline: scan #1 (measured 2026-09-20T23:13:55Z)
findings: 0 added, 0 resolved, 0 changed
severity delta: +0 critical, +0 warning, +0 info
```

The baseline was saved from the same tree minutes earlier — the
duplicate-safe pairing diff reports zero. (The first implementation reported
phantom "changed" findings here because fixture workspaces share crate names
and finding ids collide; the diff now pairs duplicates positionally —
regression-tested.)

### Doctor — the self-findings, triaged

Fresh scan of the engine directory: **95 findings (1 critical, 93 warning,
1 info)**. Every one is correct measurement of a fixture workspace nested
under `tests/fixtures/`:

| Finding | Count | Triage |
| --- | --- | --- |
| FER-ENG-005-ping (critical) | 1 | **Correct** — `cycle-ws` fixture contains an intentional normal-edge cycle; the detector found exactly what the fixture plants. No action. |
| FER-ENG-003 (warning) | 56 | **Correct** — fixture path dependencies intentionally omit `version` (tiny-ws/cycle-ws/diamond-ws are never published). No action on fixtures. |
| FER-ENG-001/002 (warning) | 18 + 18 | **Correct** — fixture manifests omit `license`/`description` by design. No action. |
| FER-ENG-004 (warning) | 1 | **Correct** — tiny-ws beta declares `log` in both `[dependencies]` and `[dev-dependencies]` on purpose. No action. |
| FER-ENG-006 (info) | 1 | **Correct** — deva↔devb dev-only cycle, planted to prove dev-cycles are `info`, not `critical`. No action. |

**Zero findings against the engine's own source code.** The engine's real
manifests pass every deterministic check the doctor knows how to run.

## Honesty checks observed during dogfooding

- `wanyrix impact --crate ghost` refuses with a NAMED error (exit 2):
  `crate 'ghost' is not a workspace crate under <root>` — impact is never
  guessed for entities that were never scanned.
- `what-changed` against an empty store yields a VALID envelope with
  `against: null` + a remediation note — never a fake baseline.
- `git` output carries paths and commit subjects only — no diffs, no file
  contents, no author identities (structural redaction, tested).
- Every envelope ends with `generatedAt` (timestamps last), and re-running
  any surface reproduces byte-identical output modulo that timestamp.

## Self-findings spun into follow-up work

1. **Scan exclusions** — the dogfood scan inevitably measures the synthetic
   fixtures under `tests/fixtures/`, which dominate the finding counts (93
   of 95). A `--exclude <dir>` option on scan surfaces would let operators
   scope analysis to real sources while keeping fixtures for tests.
   → **SHIPPED** — PR #86 (issue #76, v0.9.0): `--exclude <dir>` exists on
   every scan surface, is echoed in the envelopes, pinned by
   `engine/tests/exclude_cli.rs`, and documented in `docs/CLI.md` §exclude.
2. No other product defects surfaced: the critical-chain surfaces
   (git → W-EIR → graph → findings → doctor → experiments → verification)
   all measured this repository without a single named error beyond the
   intentional refusals exercised above.

## Verification chain (this round's PRs)

| Issue | PR | Evidence |
| --- | --- | --- |
| #67 git intelligence | #73 (merged) | 18 engine tests incl. real-git integration; live route + this doc |
| #68 impact + what-changed | #73 (merged) | diamond/cycle fixture exactness; duplicate-safe diff regression; this doc |
| #69 web wiring | #75 (merged) | 290 web tests incl. live-API contract block; browser evidence in PR |
| #70 UI quality audit | this round | agent-browser checklist (desktop + 390px, dark/light) |
| #71 adversarial hardening | #74 (merged) | 24 hostile-input tests; 2 real hang defects fixed; SECURITY.md §9 |
| #72 dogfooding | this PR | this document |
