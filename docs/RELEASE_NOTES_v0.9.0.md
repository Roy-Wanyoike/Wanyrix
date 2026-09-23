# Wanyrix v0.9.0 — Release Notes

**Wanyrix** is local-first engineering intelligence for Rust workspaces: a
zero-dependency-core Rust engine (`wanyrix-engine` v0.9.0) that measures real
repositories, and a Next.js 16 web console that serves those measurements —
never estimates dressed up as data. This document is the honest, verifiable
summary of what ships in the v0.9.0 line. Companion reading:
[`CHANGELOG.md`](../CHANGELOG.md) (per-change history) and
[`docs/RELEASE_RUNBOOK.md`](RELEASE_RUNBOOK.md) (tag/release procedure).

Release line: engine `0.9.0` (`35077c7`, 2026-09-21) + the web hardening and
engine-surface wave merged to `main` through `cda2435` (2026-09-23). All counts
below were measured at `cda2435` — commands included, never hand-counted.

---

## Measured quality at this release

| Suite | Result | Command |
| --- | --- | --- |
| Engine (Rust) | **376 passed / 0 failed / 2 ignored** opt-in perf probes | `cd engine && cargo test --workspace --offline` |
| Web (bun) | **710 tests across 40 files — 706 pass / 4 counted skip / 0 fail** (5,559 `expect()` calls) | `WANYRIX_TEST_BASE_URL=http://localhost:3000 bun test tests/` |
| Engine source | 27 files, 20,220 LOC, zero-dep core + rusqlite | `find engine/src -name '*.rs' \| xargs wc -l` |
| Gates | `tsc --noEmit` clean · ESLint clean · clippy `-D warnings` clean · legacy-token brand gate green | see `docs/DEVELOPMENT.md` |

The two counted web skips are honest environmental skips (license offline
round-trip needs `WANYRIX_SIGNING_KEY`; three registered-workspace scan-run
tests need a registered workspace in the dev registry) — printed, never
silently green.

## Engine surfaces — 25 command surfaces, all versioned JSON

Every machine payload is a versioned envelope (`wanyrix.*​/v1`); determinism is
test-pinned (same input ⇒ byte-identical output, timestamp last):

- **Measure:** `doctor` (`wanyrix.doctor/v1`), `graph` (`wanyrix.graph/v1`),
  `health` (`wanyrix.health/v1`), `analyze` (`wanyrix.analyze/v1`),
  `dependencies` — real filesystem measurement, not heuristics.
- **Build facts:** `build` (`wanyrix.build/v1`) — MEASURED instrumented
  `cargo build`: wall clock, cache-hit rate, per-artifact stream activity,
  redacted diagnostics.
- **Change intelligence:** `impact` (`wanyrix.impact/v1`), `what-changed`
  (`wanyrix.what-changed/v1`), `git` (`wanyrix.git/v1`) — blast radius,
  recompile sets, branch facts; author identity redacted unconditionally.
- **Time machine:** `compare` (`wanyrix.compare/v1`) — diff two stored scans
  (findings added/resolved/changed, crate deltas, measured severity deltas),
  both sides read back verbatim from the store; clock-free, byte-identical
  repeat diffs (#115).
- **Memory:** `chain` (`wanyrix.chain/v1`) — one offline join of the scan
  store, experiment ledger and event log into the per-finding evidence chain
  (scan → finding → experiment → verdict); labels echoed verbatim, never
  upgraded (#100).
- **Verify:** `experiment` — the honesty ledger's estimated → measured →
  verified loop, closed with real builds; `verify --min-margin-pct` refuses
  to call a within-noise delta an improvement.
- **Collaboration:** `export` (`wanyrix.export/v1`) — artifacts as code;
  `sync push|pull` (`wanyrix.sync/v1`) — registry-branch team sync with a CI
  referee step (TEAM-tier-gated).
- **Entitlement:** `activate` / `entitlement` / `license` — offline ed25519
  issuance and verification (`wanyrix.license-keygen/v1`,
  `wanyrix.entitlement/v1`).
- **Infrastructure:** `store` (SQLite WAL + crash-recovery `fsck`), `daemon`
  (`wanyrix.daemon/v1`, incremental cached analysis over a local socket),
  `telemetry` (`wanyrix.telemetry/v1`, redacted rustc JSON), `events`
  (`wanyrix.event/v1`, durable log; refusals mint no events), `ai`
  (`wanyrix.ai/v1`, digest-grounded local model), plus `init`, `status`,
  `synth`.

Full contract, one row per surface with exit codes: [`docs/CLI.md`](CLI.md)
rows 1–25.

## Web console — 19-view dashboard, 23 API routes

- **19-surface information architecture** (overview, repositories, builds ·
  doctor, findings, dependencies, graph, architecture, simulator, diagnostics,
  PR analysis, experiments, runtime, history, AI, policies · gates,
  issues & PRs, organization, plans, settings) served by **23 versioned API
  routes** under `/api/wanyrix/*` — unknown workspace ⇒ 404, never
  wrong-workspace data.
- **Connect a real project:** the registration bridge runs the REAL engine
  (doctor + graph) against any local Rust project; registered projects become
  first-class workspaces with provenance badges (fixtures are labeled DEMO).
- **Grounded AI, non-authoritative:** facts are server-rendered; model output
  is validated against the evidence and violations are redacted. `wanyrix ai`
  grounds a LOCAL model on the measured evidence digest only — never source
  code.
- **Honest degradation everywhere:** replay states when the engine is absent,
  counted skips, honest rebuild outcomes (possibly 0 MB), hash-routed views,
  command palette over real workspace data.

## Commercial entitlements (shipped in this line)

- **Offline ed25519 licensing:** `license keygen|issue`, `activate`,
  `entitlement` — issued tokens verify OFFLINE; the web Plans portal issues
  trial (14-day, labeled estimated) and team (365-day) tokens via
  `POST /api/wanyrix/license/issue`. No payment rails exist — nothing here is
  or pretends to be a purchase.
- **Tier enforcement at dispatch:** `sync push|pull` is TEAM-gated; core scan
  and export stay free (AUD-1 gate, pinned by `entitlement_gate_cli.rs`).
- **Cloud stays designed, not built:** hosting, billing back-ends and team
  dashboards are design-only ([`docs/CLOUD_DESIGN.md`](CLOUD_DESIGN.md),
  umbrella #66) — the shipped serverless rung is exactly the registry-branch
  sync above.

## Team collaboration

- **Level 1 — artifacts as code:** `wanyrix export` writes the workspace's
  report set to disk with a sha256 artifact index (#91). Artifacts are
  byte-deterministic, so a CI job and a teammate get identical bytes.
- **Registry-branch team sync:** `wanyrix sync push|pull` + CI referee (#92) —
  the durable, reviewable rung for sharing scan runs across a team without a
  hosted service.

## Export artifacts — 4 byte-deterministic flavors

Four byte-deterministic report flavors, one set of builders serving both HTTP
and the client downloads, pinned by tests: `wanyrix.report/v1` (`GET
/api/wanyrix/report?format=json`), the markdown envelope
(`?format=markdown`), `wanyrix.release-scorecard/v1` and
`wanyrix.scan-history/v1` (the additive `?flavor=` param). For file-system
artifacts, `POST /api/wanyrix/export` runs the REAL `wanyrix export`
(issue #91): the engine materializes `doctor.json` / `graph.json` /
`health.json` + a sha256-bound `index.json` under the scan target's own
`.wanyrix/exports` — no wall-clock timestamps, relative paths only,
byte-identical repeat exports.

## Honest limits of this release

- **crates.io:** not published yet — the publication plan lives in
  [`docs/CRATES_IO_STRATEGY.md`](CRATES_IO_STRATEGY.md) (#118); build from
  source today.
- **CI is billing-locked:** the hosted workflows say so themselves; validation
  is local-only until the first hosted run (retire conditions are labeled in
  `.github/workflows/`).
- **Artifact signing / provenance** and the **`engine/target/` history scrub**
  are tracked (#150 and the release-runbook checklist), not done.
- **Plugin API v1:** the four contract decision points are decided
  ([`docs/PLUGIN_AND_EVENTS.md`](PLUGIN_AND_EVENTS.md), #117); the minimal
  runtime (handshake, manifest, `sarif` reference plugin) is deferred to a
  dedicated implementation issue.

## Run it

```sh
git clone https://github.com/Roy-Wanyoike/wanyrix && cd wanyrix
bun install --frozen-lockfile && bun run dev        # web console on :3000
cd engine && cargo run -- doctor --json             # engine, one command
```

New here? [`DEMO.md`](../DEMO.md) is a 2-minute, copy-paste tour of exactly
this — every command executed for real before it was documented.
