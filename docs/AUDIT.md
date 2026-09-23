# Wanyrix — Repository Audit & Gap Matrix (EPIC 00)

> Evidence-first audit performed against the actual repository, not README
> claims. Re-derived against **engine v0.9.0** at derivation commit `cfd2c1b`
> (`main`, 2026-09-22; issue #110). Prior baseline: `524468c` (engine
> v0.7.0). Every claim below was verified by reading source or running gates —
> anything not yet verified is labeled as such. Honest-attribution rule:
> counts carry the command that produced them. The 2026-09-22 drift pass
> (AUD-7) re-measured the test suites directly — engine via `cargo test
> --workspace --offline`, web via `bun test` — so the figures below are
> measured on this host, not cited.
>
> Re-measured 2026-09-23 at **`main` @ `cda2435`** (issue #145 measured-count
> drift pass): the `cfd2c1b` baseline predated AUD-12 (scripts/meta hygiene,
> `e258d3f`), AUD-8 (registration-adversarial pins, `2a694f2`), AUD-14
> (registry-aware scan-run sync, `26cb60f`), the governance + plugin-API
> decision bundle (#151, `72319a7`) and the wave-2 merges (#152–#157:
> phantom-workspace hygiene, UX/a11y batches, `wanyrix compare`,
> `wanyrix chain`, the activation/CLI-contract polish) — those merges added
> the compare/chain engine surfaces (23 → 25 CLI rows), five engine suites
> and three web suites; engine tests moved 314 → 376, web 618 → 710. An
> intermediate measurement at `72319a7` (same issue) recorded 314/0/2 and
> 618 across 37 files.

## Baseline (measured)

| Dimension | State |
| --- | --- |
| Branch / commit | `main` @ `cda2435` (re-derived 2026-09-23; prior re-derivations: `72319a7` and `cfd2c1b` 2026-09-22, `524468c` engine v0.7.0) |
| Engine | `wanyrix-engine` v0.9.0 — 27 source files, 20,220 LOC (`find engine/src -name '*.rs' \| xargs wc -l \| tail -1`), **25 CLI surfaces** (enum `Command` in `engine/src/cli.rs`, cross-checked against `docs/CLI.md` rows 1–25 incl. the `compare`/`chain` additions, PRs #155/#156), **376 tests / 0 failed / 2 ignored opt-in probes** (`cd engine && cargo test --workspace --offline`, re-measured 2026-09-23 @ `cda2435`; was 314/0/2 before the wave-2 suites) |
| Web | Next.js 16 + TS + Tailwind 4 + shadcn/ui — **23 versioned API routes** under `/api/wanyrix/*` (**23** `route.ts` files, all under `/api/wanyrix/*` — the scaffold `/api` root was removed in the AUD-6 cleanup; `find src/app/api -name "route.ts" \| wc -l`); **710 web tests across 40 files** (33 unit + 7 api) — 706 pass / 4 counted skip / 0 fail, 5,559 `expect()` calls (`WANYRIX_TEST_BASE_URL=http://localhost:3000 bun test tests/` same-checkout, re-measured 2026-09-23 @ `cda2435`; the skips are the license-issuance offline round-trip fork needing `WANYRIX_SIGNING_KEY` and the AUD-14 registered-workspace scan-run trio needing a registered workspace in the dev registry) |
| Docs | 28 markdown files: docs/ = ARCHITECTURE, AUDIT, CLI, CLOUD_DESIGN, COMMERCIAL, CONTRIBUTING, CRATES_IO_STRATEGY, DEVELOPMENT, DOGFOODING, INVESTOR_OVERVIEW, OPEN_SOURCE_STRATEGY, PERFORMANCE, PLUGIN_AND_EVENTS, PRIVACY, RELEASE_NOTES_v0.9.0, RELEASE_RUNBOOK, RUST_COMMUNITY_GUIDE, SECURITY, THREAT_MODEL, USER_GUIDE, W-EIR (21) + root `README.md`, `CHANGELOG.md`, `DEMO.md`, `GOVERNANCE.md`, `CODE_OF_CONDUCT.md` + `engine/README.md` + `engine/BENCHMARKS.md` (THREAT_MODEL, RELEASE_RUNBOOK, GOVERNANCE, CODE_OF_CONDUCT added by the governance bundle, PR #151; CHANGELOG/DEMO/RELEASE_NOTES added by the #145–#147 docs wave) |
| License | Dual MIT OR Apache-2.0, open-core (cloud may be proprietary, trademark carved out) |
| Tracker | Open (measured via the GitHub API 2026-09-23 @ `cda2435`, excluding #145–#147 which this docs wave closes): #66 (commercial roadmap), #101–#103 (engine gaps from this matrix), #114 (dotfile regular-file guard), #116–#118 (PR regression surface, #117 Plugin API v1, first crates.io publish), #120–#121 (evidence backlog + final QA audit), #141 (response & runtime hygiene), #148–#150 (route-latency re-sweep, supply-chain automation, history scrub) — 14 open issues, no open PRs at re-measure time. Closed with evidence since the `cfd2c1b` re-derivation: #100 (memory-chain query, PR #156), #115 (compare time machine, PR #155), #137/#138 (UX grounding + overflow, PR #153), #140 (phantom workspaces, PR #152), #142/#143 (activation error + CLI contract polish, PR #157), #144 (a11y batch, PR #154) — including #109: the CLI-contract dialog now carries the sync & license rows (`src/components/wanyrix/cli-dialog.tsx`, pinned by `tests/unit/cli-dialog-command-set.test.ts`). |
| Known external blocker | GitHub Actions billing lock (CI/release cannot run user-side); cron webDevReview compensates locally. The #92 referee workflow has NEVER run on hosted runners — local-only validation, labeled as such in `docs/CLI.md`. |

## Critical chain status

`Rust repo → Cargo/rustc/Git → W-EIR → Engineering Graph → Finding → Doctor → Experiment → Measurement → Verification`

| Link | State |
| --- | --- |
| Rust repo → Cargo | **Shipped** — scan.rs walks manifests; model.rs is the single source of truth |
| rustc | **Shipped** — telemetry (redacted ingest) + build.rs (real instrumented `cargo build --message-format=json`) |
| **Git** | **Shipped** (was MISSING at v0.7.0) — `wanyrix.git/v1` (`engine/src/git.rs`, PR #73 / issue #67): branch, HEAD, dirty state, changed files via porcelain v1, changed files mapped onto scanned crate roots, commit count, 10 newest commits; paths and subjects only (structural redaction, tested). Measured live in `docs/DOGFOODING.md` |
| W-EIR | **Shipped (local model)** — WorkspaceScan/Edge/Finding/Experiment + versioned envelopes; canonical snapshot spec in docs/W-EIR.md |
| Engineering graph | **Shipped** — build_graph + SCCs; derived only from the measured edge list |
| Finding → Doctor | **Shipped** — deterministic findings, doctor is the flagship surface |
| Experiment → Measurement → Verification | **Shipped** — ledger + honesty gates (estimated ≠ measured ≠ verified) + durable event log |
| Persistence/memory | **Shipped (engine)** — SQLite store persists scans+findings; events.jsonl mirrors transitions; `wanyrix chain` (`wanyrix.chain/v1`, PR #156 / issue #100) reconstructs the scan → finding → experiment → verification chain offline; web wiring is the documented follow-up |
| Change intelligence (`impact`, `what-changed`, `compare`) | **Shipped** (was MISSING at v0.7.0) — `impact` (reverse-dependency blast radius) and `what-changed` (baseline diff) shipped in PR #73 (issue #68), wired to the web in PR #75; the `compare` time machine (diff two stored scans) shipped in PR #155 (issue #115, `docs/CLI.md` row 24); web-side wiring is a tracked backlog item |

## Gap matrix (capabilities from the master backlog)

| Capability | Exists | Works | Tested | Integrated | Documented | Production-ready |
| --- | --- | --- | --- | --- | --- | --- |
| CLI (**25 surfaces**, stable exit codes) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Daemon (UDS, cached scan) | ✅ | ✅ | ✅ | partial (web liveness probe) | ✅ | ✅ (local) |
| Storage (SQLite WAL, fsck) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Doctor / findings / evidence | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| Graph / dependencies | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| Build intelligence (instrumented) | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| Experiments / verification / events | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| Local AI (digest-only, loopback) | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ (local) |
| Workspace bridge (connect project) | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| **Git intelligence** | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ (local) |
| **Change impact (`impact`)** | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| **What changed (`what-changed`)** | ✅ | ✅ | ✅ | ✅ (web) | ✅ | ✅ |
| **Time machine (`compare`)** | ✅ | ✅ | ✅ (`tests/compare_cli.rs`) | ❌ (engine-only; web wiring is a tracked backlog item) | ✅ (`docs/CLI.md` row 24) | ✅ (local) — PR #155 / issue #115 |
| Engineering memory (chain queries) | ✅ (engine `chain`) | ✅ | ✅ (`tests/chain_cli.rs`) | partial (web wiring is the documented follow-up, issue #100) | ✅ (`docs/CLI.md` row 25) | ✅ (local) — PR #156 / issue #100 |
| Dependency/Rust upgrade intelligence | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ → tracking **#101** |
| Architecture constitution (rules/CI) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ → tracking **#102** |
| AI integrity adversarial suite | ✅ (web + engine) | ✅ | ✅ (engine `tests/ai_cli.rs` honesty tests, PR #89) | — | partial | ❌ |
| CI/PR intelligence | partial | ✅ (CI referee: `.github/workflows/wanyrix.yml` + `scripts/wanyrix-referee.sh`, PR #92 — local-only, never run on hosted Actions) | partial | ✅ (workflow) | ✅ (`docs/CLI.md` §CI contract) | ❌ (hosted-run blocker) — PR-regression surface tracked **#116** |
| Cloud sync / team / fleet | partial | ✅ (serverless registry-branch sync, PR #92 — `docs/CLI.md` rows 19–20) | ✅ (two-clone roundtrip, conflicts, no-op, tier downgrade) | partial (web views pending) | partial (sync documented; hosted cloud design-only in `docs/CLOUD_DESIGN.md`) | ✅ (local/serverless) — hosted cloud/tiers/fleet remain tracked under **#66** |
| Adversarial-repo hardening suite | ✅ | ✅ | ✅ (24 hostile-input tests in `engine/tests/adversarial.rs`, PR #74 — count verified) | — | ✅ (SECURITY.md §9) | ✅ |
| Performance ladder (10→1000 crates) | partial (synth + 2 opt-in `tests/perf_probe.rs` probes + PERF notes) | ✅ | ❌ (not tracked) | — | partial | ❌ → tracking **#103** |
| Scan exclusions (`--exclude <dir>` on every scan surface) | ✅ | ✅ | ✅ (`tests/exclude_cli.rs`) | ✅ (echoed in envelopes) | ✅ (`docs/CLI.md` §exclude) | ✅ — PR #86 / issue #76 |
| Export (artifacts as code, `wanyrix.export/v1`) | ✅ | ✅ | ✅ (`tests/export_cli.rs`) | ✅ (web Exports view, `POST /api/wanyrix/export`) | ✅ (`docs/CLI.md` row 18) | ✅ — PR #91 / issue #91 |
| Team sync (registry-branch `sync push\|pull`, CI referee) | ✅ | ✅ | ✅ (`tests/sync_cli.rs`) | partial (web views pending) | ✅ (`docs/CLI.md` rows 19–20) | ✅ (serverless) — PR #92 / issue #92 |
| Offline entitlement & licenses (`activate`, `entitlement`, `license keygen\|issue`) | ✅ | ✅ | ✅ (`tests/entitlement_cli.rs`, `tests/entitlement_offline_pin.rs`) | ✅ (Plans view + `POST /api/wanyrix/license/issue`) | ✅ (`docs/CLI.md` rows 21–23, `docs/COMMERCIAL.md`) | ✅ (local/offline) — PR #94 / issue #94 |
| Dogfooding (Wanyrix on Wanyrix) | ✅ | ✅ | — | — | ✅ (`docs/DOGFOODING.md`, measured run against v0.8.0 @ `79fef79`) | ✅ (institutionalized) — PR #77 / issue #72 |

## Risk register (refreshed 2026-09-22, re-derivation)

1. **R1 — Chain hole: Git intelligence missing.** ✅ **CLOSED.** Shipped in
   PR #73 (issue #67) as `wanyrix.git/v1` with redaction tested; the chain
   now reads `Cargo/rustc/Git → W-EIR` truthfully (see Critical chain status).
2. **R2 — No deterministic change intelligence.** ✅ **Closed.**
   `impact` + `what-changed` shipped in PR #73 (issue #68) and wired to the
   web in PR #75; the `compare` time machine shipped in PR #155 (issue #115,
   `docs/CLI.md` row 24) — web-side wiring is a tracked backlog item.
3. **R3 — Web/engine contract drift.** 🔶 **Partially mitigated.** PR #75
   wired git/impact/what-changed into the dashboard; the platform now serves
   23 versioned routes under `/api/wanyrix/*` mirroring `docs/CLI.md` rows
   1–23 (the newer `compare`/`chain` engine surfaces ship engine-first —
   rows 24–25 — with web wiring tracked as backlog).
   In-flight: none — #109 (CLI-contract dialog exposing the sync & license
   command rows) shipped and is pinned by tests (`cli-dialog.tsx` rows +
   `tests/unit/cli-dialog-command-set.test.ts`). Remaining watch item: every new engine surface must land
   with its web mirror in the same round.
4. **R4 — Unverified UI quality claims.** ✅ **Mitigated.** PR #77 (issue
   #70) ran the agent-browser audit (desktop + 390px, dark/light); PR #99
   (commit `cfd2c1b`) added browser-QA round M9 (a11y targets, honest
   degraded states).
5. **R5 — Hostile input tolerance is ad-hoc.** ✅ **Mitigated.** PR #74
   (issue #71): 24 adversarial tests in `engine/tests/adversarial.rs`
   (count verified this pass), 2 real hang defects fixed, SECURITY.md §9.
6. **R6 — Dogfooding is not institutionalized.** ✅ **Mitigated.** PR #77
   (issue #72): `docs/DOGFOODING.md` records a measured v0.8.0 self-run with
   a verification chain (PRs #73/#74/#75); scan exclusions (PR #86) came out
   of its self-findings.

## Prioritized execution order (COMPLETE — historical record)

```text
P1  Git intelligence surface        → ✅ engine PR #73 (v0.8.0)
P1  impact + what-changed surfaces  → ✅ same engine PR #73
P1  Web wiring for the new surfaces → ✅ web PR #75
P1  UI quality & responsiveness     → ✅ web PR #77 (agent-browser driven)
P2  Adversarial hardening fixtures  → ✅ engine PR #74 (tests only)
P2  Dogfooding run                  → ✅ PR #77 + docs/DOGFOODING.md
```

Follow-on work shipped since this matrix was written: scan exclusions
(PR #86, v0.9.0), export (PR #91), sync + CI referee (PR #92), offline
entitlement (PR #94), governance + plugin decision record (PR #151),
`wanyrix compare` (PR #155 / #115), `wanyrix chain` (PR #156 / #100), and
the #152–#154/#157 hygiene batches (#140, #137/#138, #144, #142/#143). The
next execution order now lives in the tracker: #101 (upgrade intelligence),
#102 (constitution), #103 (perf ladder), #114 (dotfile hardening), #116 (PR
regression), #117 (plugin API v1), #118 (wanyrix-protocol publish).

Cloud items (sync, tiers, team, fleet, API/CI) remain tracked under #66 —
they need the backend-infrastructure decision and are deliberately not
duplicated here. Note: the serverless sync slice of that umbrella shipped
via PR #92 (see matrix rows above).

## Re-derivation method (issue #110)

- `engine/src/cli.rs` enum `Command` line-by-line read: Doctor, Graph,
  Health, Store, Synth, Daemon, Telemetry, Build, Init, Status, Analyze,
  Dependencies, Experiment, Events, Ai, Git, Impact, WhatChanged, Compare,
  Export, Activate, Entitlement, License, Sync, Chain = **25 top-level
  surfaces**, matching `docs/CLI.md` rows 1–25 one-for-one (Compare/Chain
  added by PRs #155/#156).
- Every shipped row's evidence link was checked against the actual merge
  commits (`git log --oneline --merges` / `git log --all --oneline`): #73 →
  `2724b31`, #74 → `99ce8c5`, #75 → `79fef79`, #77 → `a9b6159`, #86 →
  `4830c89`, #91 → `0fc4494`, #92 → `ee9d3a1`, #94 → `2096a66`; release
  v0.9.0 → `35077c7`.
- Counts measured on the derivation host: `wc -l engine/src/*.rs`,
  `find src/app/api -name "route.ts"`, the `ViewId` union in
  `src/lib/wanyrix/types.ts` (19 entries), `bun test` (710 across 40 files;
  706 pass / 4 counted skip — re-measured 2026-09-23 @ `cda2435`, see
  Baseline).
- Engine test total re-measured 2026-09-22 (AUD-7 drift pass):
  `cd engine && cargo test --workspace --offline` → **314 passed / 0 failed /
  2 ignored** (the opt-in `perf_probe` probes); the 182 figure quoted from
  `engine/README.md` v0.9.0 in earlier passes predates the entitlement, gate
  and stdin-shorthand suites. Re-measured 2026-09-23 @ `72319a7` (issue
  #145): unchanged at 314 / 0 / 2. Re-measured again @ `cda2435` after the
  wave-2 merges added the compare/chain/margin/store-json/broken-pipe
  suites: **376 passed / 0 failed / 2 ignored**.
