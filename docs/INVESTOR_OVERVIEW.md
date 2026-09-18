# Wanyrix — Investor Overview

> Evidence-first engineering intelligence for Rust and performance-critical systems.
> This document is written for investors and follows the same honesty rules as the
> product: every claim is either **measured** (reproducible from this repository) or
> **planned** (labeled, with the gate that must pass first). Nothing is "verified"
> that has not been verified. Last updated: 2026-09-18.

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
  (enforced; a telemetry SDK that shipped by mistake was found and removed —
  `docs/audits/issues/ENG-T3A-1.md`).

## 3. What exists today (measured, in this repository)

| Component | State | Evidence |
| --- | --- | --- |
| Web platform (Next.js 16 + TS + Tailwind 4 + shadcn/ui) | Production-credible | 192 tests / 3,076 assertions green; 18 views browser-verified with 0 console errors; 9 API routes live-verified |
| Honest math core | Done | Graph aggregates (blast radius, fan-in/out, recompile sets) derived from a single edge list; byte-deterministic report flavors ×3 |
| Grounded AI layer | Done | Server-rendered facts; model confined to isolated fields; grounding-violation stripping; 413 payload cap <10 ms |
| Rust engine `wanyrix-engine` v0.1.0 | v0 working | 25 Rust tests green; clippy clean; `doctor`/`graph`/`health` subcommands emit versioned JSON (`wanyrix.doctor/v1`, `wanyrix.graph/v1`, `wanyrix.health/v1`) from real filesystem measurement |
| Product documentation set | Done | README, USER_GUIDE, ARCHITECTURE, CLI, W-EIR, SECURITY, PRIVACY, PERFORMANCE, DEVELOPMENT, CONTRIBUTING, COMMERCIAL + community/crates/open-source strategies |
| 57-gate acceptance audit | Done | `docs/audits/ACCEPTANCE_GATES.md` — 31 PASS / 7 PARTIAL / 2 FAIL / 12 IN-PROGRESS / 5 N/A at audit time |

## 4. What is deliberately not built yet (planned)

| Component | Status | Why it matters |
| --- | --- | --- |
| Engine daemon + SQLite store | Designed (`engine/README.md` roadmap) | Unlocks incremental analysis, 24 h soak, historical intelligence |
| rustc/telemetry collection | Not started | Turns static analysis into build/runtime intelligence |
| Cloud control plane (sync, billing, team) | Designed, not built (`docs/COMMERCIAL.md` §"to build") | Phase 13–14 monetization surface |
| GitHub-side CI + community launch | Blocked on repository access (ops step, not engineering) | Gate #38/#43/#44/#57 |

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
- Open-core separation: the deterministic core is open-source-friendly; the cloud
  control plane is proprietary (`docs/OPEN_SOURCE_STRATEGY.md`).
- No billing code exists in the product today — by design (honest scope), with the
  billing state machine specified.

## 7. Traction & verification discipline

This project is developed under a verifiable audit regime rather than marketing
claims: every round produces machine-checked evidence (test counts, browser E2E
sweeps, gate matrices), and issue records carry their full audit trail
(`docs/audits/issues/ISSUE_REGISTRY.md` — every finding → record → fix → commit).
The release decision is re-derived each round: currently **CONDITIONAL GO**, with the
named conditions being the engine roadmap (§4) and the repository-access ops step —
no known product-integrity blockers.

## 8. The ask (placeholder, to be finalized by the founders)

This document deliberately does not invent funding amounts or valuations — those are
founder decisions. What can be stated as measured fact: the platform's engineering
foundation is built and audited; the roadmap to a commercial v1 (engine daemon,
telemetry, cloud phases 13–14) is specified with acceptance gates; and the differenti-
ating honesty architecture is defensible because it is enforced in code, not copy.

## 9. Risks (honest)

| Risk | Mitigation |
| --- | --- |
| Rust tooling market is developer-skeptical | Product's core identity is anti-hype (honesty gates); community plan is feedback-gated (`docs/RUST_COMMUNITY_GUIDE.md`) |
| Engine roadmap execution risk | Phased with acceptance gates; v0 already proves the contract-conformance approach |
| Cloud scope creep diluting local-first trust | Open-core boundary documented; local correctness never depends on online mode |
| Single-repo bus factor | Documentation set + audit trail designed for contributor onboarding (`CONTRIBUTING.md`) |
