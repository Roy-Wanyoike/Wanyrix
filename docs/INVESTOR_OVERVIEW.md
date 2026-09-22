# Wanyrix — Investor Overview

> Evidence-first engineering intelligence for Rust and performance-critical systems.
> This document is written for investors and follows the same honesty rules as the
> product: every claim is either **measured** (reproducible from this repository) or
> **planned** (labeled, with the gate that must pass first). Nothing is "verified"
> that has not been verified. Last updated: **2026-09-22** (measurements below re-run
> against the v0.9.0 tree on that date).

---

## 1. The problem

Rust teams ship performance-critical systems, yet the questions that decide their
schedule are answered by folklore:

- *Why is this build slow?* — answered by whoever remembers the last guess.
- *What does this dependency actually cost us?* — unknown until a refactor stalls.
- *Did the optimization actually work?* — often answered from a lucky benchmark run.

Existing tools show dashboards (dependencies, CI logs, coverage) but do not connect
evidence across the lifecycle: source ↔ Cargo ↔ builds ↔ architecture ↔ runtime ↔
experiments ↔ verification. That connection layer is the product.

## 2. What Wanyrix is

**Wanyrix — Engineering Intelligence Platform.** A local-first platform that turns raw
engineering signals into trustworthy engineering knowledge, built around one loop:

```text
OBSERVE → UNDERSTAND → DIAGNOSE → EXPLAIN → RECOMMEND → CHANGE → VERIFY → MEASURE → LEARN
```

Core differentiator — the **honesty architecture**:

- `ESTIMATED ≠ MEASURED ≠ VERIFIED` are machine-enforced states, not badge cosmetics.
  The UI labels are contract-tested; the engine's output schema makes a false
  `verified` claim unrepresentable.
- The AI layer is **evidence-grounded and non-authoritative**: model output is confined
  to commentary/inference/recommendation/uncertainty fields, cannot re-label measured
  facts, and violating content is stripped and marked — verified by adversarial tests.
- Local-first: analysis data stays in the user's browser/machine. Zero telemetry
  (enforced; a telemetry SDK that shipped by mistake was found and removed — see the
  project's audit history and `docs/SECURITY.md`).

## 3. What exists today (measured, in this repository)

Measurement date: **2026-09-22** against the v0.9.0 tree.

| Component | State | Evidence |
| --- | --- | --- |
| Web platform (Next.js 16 + TS + Tailwind 4 + shadcn/ui) | Production-credible | 584 tests across 33 files — 577 pass / 4 counted skip / 0 product-defect fail (4,900+ `expect()` calls) — re-run 2026-09-22 against the live server; 19 views (`ViewId` registry in `src/lib/wanyrix/types.ts`); 23 `/api/wanyrix/*` route handlers (`find src/app/api -name route.ts`), exercised by live API-contract suites; browser-QA rounds M1–M9 |
| Rust engine `wanyrix-engine` v0.9.0 (`engine/Cargo.toml`) | Shipped | 302 tests / 0 fail / 2 opt-in perf probes ignored (`cd engine && cargo test --workspace --offline`, measured 2026-09-22); real filesystem measurement behind `scan`/`doctor`/`graph`/`health`/`build`/`daemon`/`store`/`telemetry` surfaces, each emitting versioned JSON (`wanyrix.doctor/v1`, `wanyrix.graph/v1`, `wanyrix.build/v1`, `wanyrix.daemon/v1`, `wanyrix.telemetry/v1`, …) |
| CLI binary `wanyrix` (shipped v0.8.0) | Shipped | 23-command surface + exit ladder (`0`/`2`, honest `101` broken-pipe note) pinned in `docs/CLI.md`; wired into the web platform via the workspace registration bridge and engine-exec routes |
| Engine daemon + SQLite store + telemetry ingestion | Shipped | `engine/src/{daemon,store,telemetry}.rs`; `wanyrix daemon start/call` (incremental analysis over a local socket), `wanyrix store init/save/list/fsck` (WAL-backed SQLite), `wanyrix telemetry ingest` (redacted rustc JSON) — documented in `engine/README.md` (v0.9.0) |
| Offline entitlement layer | Shipped (sandbox-local) | ed25519 license issuance/activation (`engine/src/entitlement.rs`; `wanyrix license issue` / `activate` / `entitlement`; web Plans portal + `POST /api/wanyrix/license/issue`) — no payment method, never a simulated purchase (#94) |
| Honest math core | Done | Graph aggregates (blast radius, fan-in/out, recompile sets) derived from a single edge list; byte-deterministic report flavors ×3 |
| Grounded AI layer | Done | Server-rendered facts; model confined to isolated fields; grounding-violation stripping; 413 payload cap <10 ms |
| Dual open-source license + public repo | Done | `MIT OR Apache-2.0` (`LICENSE`, `LICENSE-MIT`, `LICENSE-APACHE`; `engine/Cargo.toml`); public repo `github.com/Roy-Wanyoike/wanyrix` |
| Product documentation set | Done | README, USER_GUIDE, ARCHITECTURE, CLI, W-EIR, SECURITY, PRIVACY, PERFORMANCE, DEVELOPMENT, CONTRIBUTING, COMMERCIAL + community/crates/open-source strategies |
| Acceptance-audit regime | Done (ongoing) | Maintainer audit record (`docs/AUDIT.md`) + per-round gate matrices; issue records carry the full audit trail (§7) |

## 4. What is deliberately not built yet (planned)

| Component | Status | Why it matters |
| --- | --- | --- |
| crates.io publication (`wanyrix-protocol` → `wanyrix-core` → `wanyrix`) | Planned — publication order + checklist in `docs/CRATES_IO_STRATEGY.md` | `cargo install wanyrix` distribution; ecosystem native presence |
| Cloud control plane (sync, billing, team) | Designed, not built (`docs/COMMERCIAL.md` §"to build") | Monetization surface for the designed hosted tiers (tier plan in `docs/COMMERCIAL.md`) |
| Community launch (posts, listings) | Not started — feedback-gated (`docs/RUST_COMMUNITY_GUIDE.md` §4); governance artifacts tracked in #119 | Organic adoption per the no-spam ground rules |

## 5. Market and wedge

- **Primary user**: professional Rust developers and teams owning build-time and
  runtime performance (infrastructure, databases, games, embedded, crypto).
- **Wedge**: build intelligence — the doctor surface answers "why is this slow" with
  evidence, which CI and dashboards do not do today.
- **Expansion**: architecture debt → experiments/verification → team intelligence —
  each stage reuses the same evidence graph, so every new surface compounds the moat
  instead of being a new product.
- **Why now**: Rust adoption in production systems keeps compounding; tooling spend
  follows compile-time pain, which is the #1 cited Rust friction point.

## 6. Business model (documented, subject to market validation)

- **90-day free trial** across paid tiers; `Wanyrix Local` (local-first, per-seat),
  `Wanyrix Cloud`, `Wanyrix Team`, `Wanyrix Enterprise` tiers — see
  `docs/COMMERCIAL.md` for tier boundaries and the billing architecture.
- Open-core separation: the deterministic core is dual-licensed `MIT OR Apache-2.0` and
  the repository is public (`docs/OPEN_SOURCE_STRATEGY.md`); the cloud control plane
  remains proprietary.
- No payment processing exists in the product today — by design. The offline
  entitlement layer (license issuance/activation, sandbox-local, no payment method)
  shipped in v0.9.0; the hosted billing stack remains design-only
  (`docs/COMMERCIAL.md`).

## 7. Traction & verification discipline

This project is developed under a verifiable audit regime rather than marketing
claims: every round produces machine-checked evidence (test counts, browser E2E
sweeps, gate matrices), and issue records carry their full audit trail
(a maintainer-local audit registry — every finding → record → fix → commit; issues live on the tracker).
The release decision is re-derived each round: currently **CONDITIONAL GO**, with the
earlier named conditions resolved — repository access (the repo is public) and most of
the engine roadmap (v0.9.0 shipped; §3). Remaining named gaps: crates.io publication
and the community launch (§4). No known product-integrity blockers.

## 8. The ask (placeholder, to be finalized by the founders)

This document deliberately does not invent funding amounts or valuations — those are
founder decisions. What can be stated as measured fact: the platform's engineering
foundation is built and audited — engine v0.9.0 (daemon, store, telemetry, CLI) and the
web platform are shipped in-tree (§3); the remaining roadmap to a commercial v1
(crates.io publication, hosted cloud per `docs/COMMERCIAL.md`) is specified with acceptance gates; and the
differentiating honesty architecture is defensible because it is enforced in code, not copy.

## 9. Risks (honest)

| Risk | Mitigation |
| --- | --- |
| Rust tooling market is developer-skeptical | Product's core identity is anti-hype (honesty gates); community plan is feedback-gated (`docs/RUST_COMMUNITY_GUIDE.md`) |
| Engine roadmap execution risk | Phased with acceptance gates; v0 already proves the contract-conformance approach |
| Cloud scope creep diluting local-first trust | Open-core boundary documented; local correctness never depends on online mode |
| Single-repo bus factor | Documentation set + audit trail designed for contributor onboarding (`CONTRIBUTING.md`) |
