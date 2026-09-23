# Changelog

All notable changes to Wanyrix are documented in this file.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: SemVer on the engine crate (`wanyrix-engine`), applied repo-wide; the web console pins the engine version in one constant, tested against `engine/Cargo.toml`.
Provenance: seeded 2026-09-23 from a full `git log --oneline` audit at `72319a7` and extended the same day through `cda2435` (the wave-2 merges #152–#157) — every entry below is merged code on `main` with its issue/PR reference. Tag + GitHub Release creation happens at merge time (see `docs/RELEASE_RUNBOOK.md`).

## [Unreleased]

### Changed

- Docs: measured-count drift pass — both suites re-measured same-checkout at `cda2435` (engine 376/0/2, web 710 tests across 40 files: 706 pass / 4 counted skip / 0 fail), every count re-pinned with its measurement commit, tracker lists synced to the live open-issue set (#145).
- Docs: this changelog (seeded from the git-history audit, extended through the #152–#157 wave) and the v0.9.0 release notes (#146); tag `v0.9.0` + GitHub Release are cut at merge.
- Docs: `DEMO.md` — a 2-minute, copy-paste demo of the engine surfaces (incl. the `compare` and `chain` wow-moments), export artifacts and the web console, every command executed at HEAD before committing (#147).

## [0.9.0] — 2026-09-21

Engine v0.9.0 shipped at `35077c7` (2026-09-21). The web-platform hardening wave that followed on `main` (through 2026-09-23) stayed on the same version line — `engine/Cargo.toml` remains 0.9.0 — so those changes are recorded here.

### Added

- Engine: `wanyrix sync push|pull` — registry-branch team sync with a CI referee step (#92, `ee9d3a1`); dispatch-time entitlement gate makes sync TEAM-tier-gated while core scan and export stay free (AUD-1, `3d9c8d8`).
- Engine + Web: local-first subscription & entitlement layer — offline ed25519 licenses (`license keygen|issue`, `activate`, `entitlement`), web Plans portal, `POST /api/wanyrix/license/issue`; no payment rails, never a simulated purchase (#94, `2096a66`).
- Engine: `wanyrix git` — git facts surface (`wanyrix.git/v1`): branch / HEAD / dirty state / changed files / commits, with unconditional author-identity redaction (issue #69 via #75; binary contract AUD-9, `8251d09`).
- Engine: `wanyrix impact` + `wanyrix what-changed` — deterministic change intelligence (`wanyrix.impact/v1`, `wanyrix.what-changed/v1`) (#68, #73).
- Engine: repeatable `--exclude <dir>` on every scan surface (#76, `4830c89`).
- Engine: `wanyrix export` — team collaboration level 1, artifacts as code, with a sha256 artifact index (#91, `0fc4494`).
- Engine: `wanyrix ai` — local model grounded on the measured evidence digest only; refuses `https://` endpoints with a named honesty error (`524468c`, `a9fbf64`).
- Web: workspace registration bridge — connect a real local Rust project; the dashboard runs the REAL engine (doctor + graph) against it; registered projects become first-class workspaces (QA-5-B-1, `ae51346`).
- Web: durable server-side scan-run log (`wanyrix.scan-runs/v1`) + history sync panel with per-run badges and backfill (`be8c2a0`, `e8e866d`); POST/GET route contracts pinned (AUD-2, `04c7fb8`).
- Web: hash-based view routing — shareable/bookmarkable views with working Back/Forward (QA-1 F-1, `a664c61`).
- Web: command palette searches workspace data — crates, findings, PRs (#127, `9afb8da`); palette workspace rows are actionable, never silent dead-ends (QA-1 F-2, `270bc11`).
- Web: storage rebuild/reclaim POST contracts (AUD-3, `2d45d47`) and an honest rebuild outcome — the CTA stays enabled and reports a real (possibly 0 MB) result (QA-1 F-3, `6e80540`).
- Web: CLI-contract dialog carries the sync & license surfaces (#109, `aaefbbe`).
- Tests: counted-skip banners + the `WANYRIX_REQUIRE_LIVE=1` vacuous-green gate for the live API suite (AUD-4, `eb3a925`); binary-level engine contracts for git/impact/what-changed/experiment/telemetry (AUD-9, `8251d09`); adversarial registration-path pins + confinement parsing contract (AUD-8, `2a694f2`).
- Engine: `wanyrix compare --db <store> --from <id> --to <id>` — the stored-scan time machine (`wanyrix.compare/v1`): findings added/resolved/changed (duplicate-safe pairing), crate deltas and measured severity deltas, both sides read back verbatim from the store; clock-free (`generatedAt` = `not-measured`) so repeated diffs are byte-identical; unknown ids and corrupt entries are named refusals (#115, PR #155).
- Engine: `wanyrix chain --db <store> [--finding <id>|--scan <id>]` — the engineering-memory chain query (`wanyrix.chain/v1`): one deterministic, offline join of the scan store, experiment ledger and event log into the per-finding evidence chain (scan → finding → experiment → verdict); evidence labels echoed verbatim, orphan/corrupt state named, never silently dropped (#100, PR #156).
- Docs: governance & posture bundle — `GOVERNANCE.md`, `CODE_OF_CONDUCT.md`, `docs/THREAT_MODEL.md`, `docs/RELEASE_RUNBOOK.md`; GitHub private vulnerability reporting enabled (#119, PR #151).

### Changed

- Engine: CLI contract polish batch — `store list --json` / `store fsck --json` emit the documented `wanyrix.store-scans/v1` / `wanyrix.store-fsck/v1` envelopes with `generatedAt` last; `daemon start --path <dir>` parity (status frame echoes `workspaceRoot`, bad anchors refused before the socket binds); closed-stdout EPIPE is a clean documented exit `141` instead of the Rust runtime's raw `101` panic; `experiment verify --min-margin-pct` (default 10) grants `verified` only on a strict-exceed improvement — at-or-below-margin outcomes are an explicit within-noise verdict that leaves the ledger and event log untouched (#143, PR #157).
- API: unified workspace param contract — unknown workspace 404s under any accepted spelling (`?ws=` / `?workspace=`), named 400s for missing params (#129, `2f05a58`).
- Web: accessibility batches — muted-text/severity/amber contrast, dialog focus restoration, scrollable-region labels (#131, `3f8d5ff`, `aac1df1`, `3b53932`).
- Web: AI fallback renders computed deltas or honest omission labels — no bare placeholders (#130, `724b243`).
- Web: honesty provenance — fixture workspaces badged DEMO, never LIVE (QA-5-B-4, `4225556`); one count selector across surfaces, manifest totals explicitly labeled (QA-5-B-3, `f44cb93`).
- Docs: audit re-derived against engine v0.9.0 (#110, `8419a84`); measured-count alignment pass (#111, `aa69314`); strategy-doc de-staling (#113, `bdbcca1`); drift batches (`14aef29`, `825bf41`, `aff97d5`); Plugin API v1 decision record D1–D4 (#117, PR #151).

### Fixed

- Web: phantom-workspace resolution + API param hygiene — resolver aliases (`?ws=`/`?workspace=`) and unknown ids behave identically on every route; no silent fallback to fixture dogfood data (#140, PR #152).
- Web: doctor header wraps cleanly at 375 px (no horizontal overflow) and the minutes-prose copies carry grounded units (#137, #138, PR #153).
- Web: accessibility batch — dialog semantics, label contrast, 44 px minimum targets (#144, PR #154).
- Engine: `activate` on the stock build names the unusable embedded release key (`WANYRIX_ACTIVATION_PUBKEY` placeholder) with an actionable refusal — exit 2, no panic, nothing cached — instead of a generic failure; malformed operator overrides keep their specific input errors (#142, PR #157).
- Engine: memory-chain SQL join off-by-one + workspace-scope test — a chain query can no longer leak a row from a foreign scan (PR #156, `dbaf586`).
- Engine: redaction scan advances by char boundary, not byte — CJK input no longer panics (QA-4-B-1, `12e4b78`).
- Engine: telemetry redaction drops the VALUE of keyword assignments — labels only survive (QA-4-B-1, `bf93bb5`).
- Engine: the documented stdin shorthand `store save -` / `telemetry ingest -` actually works (QA-4-B-3, `45b0c8f`).
- Engine: `license keygen --json` emits the documented `wanyrix.license-keygen/v1` envelope (QA-4-B-2, `35e1815`).
- Web: registered workspaces can sync durable scan-runs — registry-aware resolution (AUD-14, `26cb60f`).
- Web: doctor run labeled as a replay of the stored report when the engine binary is absent (#128, `20d47b0`).
- Web: workspace registry failure shows an honest error state + retry instead of crashing (PR #83, `32a1c74`).

### Security

- Web: the dev server binds loopback explicitly — the unauthenticated local surface is no longer LAN-reachable (QA-3-B-1, `6f73b67`).
- Web: workspace registration is confined to approved roots — the host-filesystem oracle is closed; generic refusals, no path echo (QA-3-B-2, `f7a599e`).
- Web: license-issuance refusals are surfaced inline + toast, never silent (QA-5-B-2, `ac373cc`).

## [0.8.0] — 2026-09-21

- Engine: git intelligence + deterministic change intelligence (#67, #68 via #73, `2724b31`).
- Engine: adversarial repository hardening — hostile-input fixture suite + 2 hang fixes (#71 via #74, `99ce8c5`).
- Web: dashboard wiring for git / impact / what-changed (#69 via #75, `79fef79`).
- Web: UI quality & responsiveness audit + dogfooding record (#70, #72 via #77, `a9b6159`).

## [0.7.0] — 2026-09-20

- Engine: local AI (#66 item 8) + connect-a-project workspace bridge (`524468c`).

## [0.6.0] — 2026-09-20

- Engine: durable event log (#63) + dual license MIT OR Apache-2.0 (#62) + README overhaul (`08c9e3c`).

## [0.5.0] — 2026-09-20

- Engine: full CLI product contract (#60) + resilience & release engineering (#64, #65) (`8ce9345`).

## [0.4.0] — 2026-09-20

- Engine: instrumented build telemetry (`wanyrix.build/v1`) + engine runs recorded in web history (`69f489d`).

## [0.3.0] — 2026-09-18

- Engine: daemon (`wanyrix.daemon/v1`) + redacted telemetry ingest (#58, `0dad4e5`).

## [0.1.0] — 2026-09-18

- Engine: first real Rust engine, `wanyrix-engine` v0.1.0 (`94fc825`).
- The product identity migration to Wanyrix from the project's pre-rename working name landed at `4733c36` (the rename history is documented in the README's "Governance & brand history" section). (No v0.2.0 release commit exists in the history.)
