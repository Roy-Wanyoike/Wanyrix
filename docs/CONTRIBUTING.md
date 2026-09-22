# Contributing to Wanyrix

Rules of engagement for this repository. They exist to protect the product's core
promise: **every claim carries its own evidence** — in the product *and* in the process.

## 1. Evidence standard for any "done" claim

A claim that something works (issue fix, feature, verification) is only credible when
backed by all five evidence classes, abbreviated **CODE+INTEGRATION+TEST+RUNTIME+DOC**:

| Class | Requirement |
| --- | --- |
| **CODE** | the change exists in the tree, minimal and scoped to the issue |
| **INTEGRATION** | it composes with the existing surfaces (no duplicate state sources, no contract drift) |
| **TEST** | a test pins the behavior (new or updated, green under `bun run test`) |
| **RUNTIME** | observed live — curl/API probe for contracts, browser check for UI |
| **DOC** | the affected docs are updated in the same change |

Never claim Verified/DONE from code alone. "FIXED — pending verification" is the honest
intermediate status; only a verifier with RUNTIME evidence flips it (see the issue
tracker and commit history for worked examples).

## 2. Issue records (14-field template)

Report issues on the GitHub issue tracker. Historical audit records live out-of-tree
(maintainer-local); each carries the same 14 fields below plus an acceptance checklist:

1. Title line + **Type / Severity / Status / Labels**
2. Problem
3. Evidence (file/line + live probe output)
4. Current behavior
5. Expected behavior
6. Root cause
7. Implementation requirements
8. Acceptance criteria
9. Tests required
10. Security considerations
11. Performance considerations
12. Dependencies (other issues)
13. Definition of Done
14. Ready-to-run filing (`gh issue create` block)

Before filing: duplicate-check against the GitHub issue tracker (Rule 4 — search
open *and* closed issues first). Severity policy: P0 breaks a shipped promise/data loss · P1 blocks credible
development · P2 material product gap · P3 quality/completeness · P4 hygiene.

## 3. Honesty gates (non-negotiable)

- **Estimated ≠ Measured ≠ Verified.** Nothing upgrades itself; only a recorded
  experiment yields `verified` (Gate 21). Tests enforce the separation — never weaken
  them.
- **No false Verified claims** in issues, docs, scorecards, or commit messages. If a
  gate is conditional, write CONDITIONAL (the release scorecard itself models this:
  `GO / CONDITIONAL GO / NO-GO`).
- **No fabricated evidence.** Empty-but-labeled beats invented numbers: server-side
  scan history serves `runs: []` with an explanatory note rather than fake wall-clock
  durations; runtime signals not instrumented here render honest empty states
  (AUDIT-I8). Roadmap items are labeled Roadmap.
- **No silent modification.** Patches are reviewable new-proposal diffs behind explicit
  approval (Gate 19); there is no auto-apply path.
- **AI never the source of truth.** Model output is confined to commentary fields and
  post-validated against evidence; the deterministic core works with the provider off
  (Gates 9/18).

## 4. Brand gate

Run `bash scripts/check-branding.sh` before every PR (exit 0 = PASS). It fails on
unsanctioned legacy brand tokens — the exact case-insensitive pattern constant lives in
`scripts/check-branding.sh`. The whitelist covers only intentional legacy mentions
(migration protocol, its regression test, audit records, docs about them). New files
must not reintroduce legacy tokens; stable finding IDs keep their historic `FER-` prefix
by design — IDs are contracts.

## 5. Commit & PR conventions (as observed in `git log`)

- **Conventional-commit subjects**: `feat:`, `fix:`, `chore:`, `docs:`, `test:` —
  with `!` for breaking (`feat!: Wanyrix identity migration`). Real examples:
  - `feat: round-9 — version-upgrade simulator tab, workspace Markdown report export, a11y pass`
  - `fix: close ENG-TCA-1/2/3/5/6 (workspace guard, HTTP flavors, graph math, structured ranges, REST hygiene) …`
  - `docs: production-validation round close-out — registry consolidation, audit addendum §7`
- **Issue/PR linkage in the subject or body**: reference the issue/PR id the change
  closes (`feat: … + scan-history export (issue #44)`; merges like `Merge pull request #47 from Roy-Wanyoike/feat/round6-scan-history-export`).
- **One issue = one PR** for contract fixes; the PR carries the pinning tests and the
  doc updates (evidence standard above).
- Verification agents re-run the gates (`lint`, `typecheck`, `test`, brand gate, live
  probes) before moving a record to Verified — expect that as review.

## 6. What "good" looks like

- A contract fix PR: focused diff + tests that pin it + live probe transcript + doc
  update + issue record moved to `FIXED — pending verification`.
- A docs change: every factual claim traceable to code or a captured response; roadmap
  labeled Roadmap; no invented numbers (measure it — `docs/PERFORMANCE.md` shows the
  expected rigor).
- A feature: honors the fixture conventions (`docs/DEVELOPMENT.md`), keeps
  `lint`/`typecheck`/`test`/brand gate green, and leaves the honesty architecture
  untouched.

## 7. Repository bootstrap toolkit (historical)

`scripts/github/*.sh` are the one-time repo-bootstrap toolkit (auth/rename/push +
issue/PR filing) that produced this GitHub repository. It has already been executed —
this repo is its output — and is kept only for reference or a re-run on a fresh fork;
its README was removed once every step had completed.
