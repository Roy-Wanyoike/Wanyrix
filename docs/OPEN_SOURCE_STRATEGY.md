# Wanyrix — Open-Source Strategy

Status: **recommendation + transition plan** (spec §58). Honest starting point, updated:
the repository is **public and dual-licensed today** — `MIT OR Apache-2.0` per the
[`README.md`](../README.md) license badge, with `LICENSE`, `LICENSE-MIT`, and
`LICENSE-APACHE` at the repo root and the same expression in `engine/Cargo.toml`. The
license transition (§7 rows 1–2) is therefore **done**; what remains of this document's
job is the operational half of the transition gate (§7 rows 3–6 — history review,
governance artifacts, private vulnerability reporting, community refresh), tracked in
the governance bundle (#119).

## 1. The decision being made

| Question | Answer |
| --- | --- |
| Does Wanyrix open-source at all? | **Yes — the deterministic core.** The product's credibility rests on public scrutiny of its honesty architecture; a closed evidence engine invites the exact distrust it is designed to remove. |
| What stays proprietary? | The **cloud control plane** (hosted sync, team dashboards, billing, entitlements, hosted AI orchestration) and enterprise delivery — consistent with [`COMMERCIAL.md`](COMMERCIAL.md). |
| Does open-sourcing cripple the commercial model? | No — by design. Value lives in collaboration, persistence, governance, fleet intelligence, and hosted infrastructure (COMMERCIAL §36), not in withholding local analysis. |
| Artificial limitations? | **None, ever.** The local deterministic core stays unlimited and fully functional offline; billing state can never corrupt or disable it (entitlement separation, COMMERCIAL principle 2). No open-core "lite" trap, no crippled analyzers, no trial-gated local features. |

## 2. License recommendation: `MIT OR Apache-2.0`

Dual-license under SPDX expression **`MIT OR Apache-2.0`** — the de-facto standard for
Rust crates (rust-lang's own crates, most of the toolchain ecosystem), and therefore the
lowest-friction choice for Rust contributors and downstream packagers.

| Rationale | Detail |
| --- | --- |
| Apache-2.0 alone | Patent grant + explicit trademark non-grant (§6 of the license) — protects users and the project; longer and slightly heavier to read. |
| MIT alone | Maximally simple, but no patent grant. |
| Dual `MIT OR Apache-2.0` | Users pick; patent grant available via the Apache path; ecosystem-expected (packagers already handle this expression); compatible with `cargo` conventions (`license = "MIT OR Apache-2.0"`). |
| What dual-licensing does **not** do | It does not grant the trademark (§4), and it does not obligate opening the cloud control plane (§3). |

Requirements at relicensing time: `LICENSE-MIT` + `LICENSE-APACHE` files, `license`
field in every `Cargo.toml`, copyright line per source file per Rust convention
(`Copyright <year> Wanyrix contributors`), and a NOTICE file if Apache is elected.
**State: done at the repo level** — both license files are committed and the engine
crate declares `license = "MIT OR Apache-2.0"`; per-source-file copyright headers and a
NOTICE file remain open items (tracked with the governance bundle, #119).

## 3. Open core vs proprietary boundary

| Component | License plane | Status today | Rationale |
| --- | --- | --- | --- |
| Rust engine + analyzers + collectors | **Open** (dual) | **Shipped** — `wanyrix-engine` v0.9.0 in-tree (`engine/`), dual-licensed | Scrutiny of evidence collection is the product |
| `wanyrix-protocol` / `wanyrix-core` / `wanyrix` CLI crates | **Open** (dual) | Publication plan in [`CRATES_IO_STRATEGY.md`](CRATES_IO_STRATEGY.md) | Reusable, contract-first, ecosystem-native |
| W-EIR schema + versioned flavors (`wanyrix.report/v1`, …) | **Open**, spec-public | Shipped & test-pinned | Contract transparency prevents lock-in (COMMERCIAL: exports are not a lock-in format) |
| Web platform (dashboard UI, API routes) | **Open** (dual) | Shipped, verified (602-test suite: 0 fail / 4 counted skip — measured 2026-09-22) | The demonstrator; runs locally, no telemetry |
| Wanyrix Cloud (history sync, team dashboards, hosted AI) | **Proprietary** (service, not code) | Designed, not built (design-only: [`CLOUD_DESIGN.md`](CLOUD_DESIGN.md); the serverless sync rung — `wanyrix sync push\|pull` — is shipped) | The service is the product; the client stack it serves stays open |
| Billing, entitlements, subscription engine | **Proprietary** | Designed (COMMERCIAL §39) | Inner-shell only; never touches the local core |
| Enterprise delivery (SSO/SCIM glue, private deployment, SLAs, audit-log backend) | **Proprietary/commercial** | Roadmap (tier plan in [`COMMERCIAL.md`](COMMERCIAL.md)) | Deployment convenience and assurance, not analysis capability |
| Brand assets (name, logo) | **Trademark** — neither open nor "free license" | In use | See §4 |

Litmus test applied per component: *if this were proprietary-only, could a user still get
honest, verified engineering intelligence locally with zero payment and zero network?*
If no, the boundary line is drawn wrong.

## 4. Trademark policy (summary)

- **Mark**: the Wanyrix name and logo. The Apache-2.0 license deliberately does not grant
  them; neither will MIT.
- **Allowed without asking**: factual, truthful references — "built for Wanyrix",
  "compatible with Wanyrix", "Wanyrix reports in `wanyrix.report/v1` format", linking to
  the project, screenshots of the product.
- **Requires permission**: naming a fork or derivative distribution "Wanyrix …", using the
  logo as one's own brand, implying endorsement or official status.
- **Consequence**: a full policy document (drafted before the public launch) defines
  naming for forks (e.g. "X, a Wanyrix fork"), community-event usage, and takedown
  escalation — mirroring the Rust (trademark) policy's structure, friendliness included.

## 5. Governance: BDFL → maintainers council

| Phase | Model | Decision rights |
| --- | --- | --- |
| Now → 1.0 / small contributor base | **BDFL** (project founder) with public reasoning | Fast, unambiguous early direction; all decisions documented in public (issue records + changelogs) — the current repo already operates this way |
| Trigger to transition | ≥ 3 sustained external maintainers with ≥ 6 months of merged work, or 1.0 of the first open crate — whichever first | — |
| After transition | **Maintainers council** (3–5 members, including the founder) | Substantive changes (API, schema flavors, honesty gates, license) require a lightweight public RFC + council lazy-consensus (72 h objection window) |
| Unchangeable by anyone unilaterally | The honesty gates (Estimated ≠ Measured ≠ Verified, no false Verified claims, no fabricated evidence — [`CONTRIBUTING.md`](CONTRIBUTING.md) §3) | These are the constitution; a council change to them requires a supermajority and a public rationale |

Interim artifact: a short `GOVERNANCE.md` describing the BDFL phase honestly (who
decides, how to propose, how disputes escalate) instead of pretending a committee exists
that doesn't. **Not yet adopted — tracked in the governance bundle (#119).**

## 6. Security reporting & maintainer operations

| Topic | Policy |
| --- | --- |
| Security reports | Follow [`SECURITY.md`](SECURITY.md). Today: the public GitHub issue tracker is live for disclosable reports; GitHub **private vulnerability reporting** is the intended channel for sensitive ones — planned, tracked in #119, **not enabled yet**. The existing posture (no auth surface, validation tables, grounding firewall) becomes the baseline for a public THREAT_MODEL.md. |
| Maintainer onboarding | Ladder: contributor → regular (3+ merged PRs honoring the evidence standard) → maintainer (invite by existing maintainers, 2/3 consent; gets review rights + `CODEOWNERS` entry). Onboarding checklist: CONTRIBUTING walkthrough, issue-record template practice, one mentored review, CoC acceptance. `good-first-issue` and `help-wanted` labels are the documented entry doors ([`RUST_COMMUNITY_GUIDE.md`](RUST_COMMUNITY_GUIDE.md) §7). |
| Release cadence | Web platform: continuous (gated by lint/typecheck/tests/brand gate). Engine + CLI crates: time-based minors every 4–6 weeks on the 4–6-week train once v0 ships; patches as needed; breaking changes only at `0.x+1`/`1.x+1` with migration notes; machine flavors versioned independently (`vN` additive-only). Full mechanics: [`CRATES_IO_STRATEGY.md`](CRATES_IO_STRATEGY.md) §2/§6. |
| Security releases | Out-of-band, immediate, advisory published simultaneously with the fixed release. |

## 7. Transition gate (open-sourcing checklist)

All boxes are prerequisites for the first public "this is open source" claim; the current
state of each is stated to keep this document honest.

| # | Prerequisite | State |
| --- | --- | --- |
| 1 | Public repo reachable (GitHub push with credentials) | **Done** — `github.com/Roy-Wanyoike/wanyrix` is public |
| 2 | Owner legal sign-off on `MIT OR Apache-2.0` + license files + NOTICE | **Done (license files)** — `LICENSE`, `LICENSE-MIT`, `LICENSE-APACHE` committed; README badge + `engine/Cargo.toml` declare the expression. NOTICE file + per-file copyright headers: open (with #119) |
| 3 | Commit-history review for anything unsuitable for publication | Pending — tracked in the governance bundle (#119) |
| 4 | `GOVERNANCE.md`, trademark policy, CoC adopted (Rust CoC) | Drafted here (§4/§5/§10 of community guide); not yet adopted — tracked in #119 |
| 5 | Private vulnerability reporting configured | Pending (repo is public; enabling GitHub private reporting is tracked in #119) |
| 6 | Community material updated from "plan" to "fact" (this doc, community guide §1) | In progress — status snapshots refreshed against v0.9.0 reality; adoption/announcement steps remain gated on rows 3–5 (#119) |

## 8. Community-health metrics (baselines established at launch)

Measured, not felt. Vanity metrics (raw stars) are recorded but never targets.

| Metric | Definition | Target | Baseline |
| --- | --- | --- | --- |
| Time-to-first-response | Median, issues/PRs from outsiders | < 48 h | not yet measured (tracker is live; baselines start with the governance bundle #119) |
| Time-to-triage | Median, issue opened → labeled | < 7 days | not yet measured |
| False-positive rate | `kind/false-positive` reports per released analyzer finding set | Trending down | not yet measured |
| External contribution share | Merged PRs from outside the founding team | ≥ 20% by month 6 | 0% |
| Maintainer responsiveness | Open PRs with no review after 7 days | ≤ 10% | not yet measured |
| Release predictability | Trains shipped on schedule | ≥ 80% | n/a (no releases yet) |
| First-run success | Strangers completing the 5-minute walkthrough unaided (community guide §11) | ≥ 90% of reported attempts | not yet measured |
| Stars/forks | Recorded for trend only | no target | 0 |

Metrics live in the periodic community note (community guide §11 cadence) with their raw
numbers — the same evidence-first discipline as `docs/PERFORMANCE.md`, applied to the
community itself.

## 9. Sharp questions, straight answers

| Question | Answer |
| --- | --- |
| "Open core means the free product is crippled, right?" | No — and it is structurally impossible, not just discouraged: entitlement separation means billing state cannot touch the local deterministic core (COMMERCIAL principle 2), and the honesty gates make "cripple the free tier and hope nobody notices" a visible, testable failure. |
| "If the core is open, why pay for anything?" | Because the paid value is collaboration, persistence, retention, governance, fleet intelligence, hosted infrastructure, and SLAs (COMMERCIAL §36) — capabilities that only exist when there is a service and an organization behind them. Nobody pays for local analysis, which is the point. |
| "Why permissive dual (MIT OR Apache-2.0) instead of AGPL for the core?" | AGPL would chill the exact adoption the product needs (companies evaluating on internal workspaces, packagers, embedders) without protecting revenue — the revenue plane is the hosted service and enterprise delivery, which AGPL does nothing for. Permissive + a real service is the ecosystem-native Rust play. |
| "Can a competitor fork and out-compete?" | Possibly — that is what open source is. The durable defenses are process credibility (evidence standard), trademark (§4), release cadence, and community trust; not code withholding. A fork that drops the honesty gates stops being credible; one that keeps them is a sibling project, which is fine. |
| "Who owns contributions?" | DCO-style sign-off (`Signed-off-by`) — inbound = outbound under the same dual license, no CLA friction. A CLA would only be reconsidered if enterprise legal demands force it, and that change would be a public RFC. |
| "What happens if the BDFL disappears?" | The §5 council trigger fires automatically; the interim governance doc names the successor process before 1.0 so this is never an emergency. |

## 10. What this strategy forbids

- Open-washing: claiming "open source" for components or governance practices that don't
  meet §7 yet — the license is real, and so are the remaining gate rows.
- Artificial crippling of the local core to manufacture cloud demand (spec §58's explicit
  warning; COMMERCIAL principle 1).
- Bait-and-switch relicensing of already-released open code without a real stewardship
  process and community notice.
- Trademark bullying of honest, factual community references (§4).

## 11. Cross-links

[`COMMERCIAL.md`](COMMERCIAL.md) (trial + tiers, entitlement separation) ·
[`CRATES_IO_STRATEGY.md`](CRATES_IO_STRATEGY.md) (publication mechanics) ·
[`RUST_COMMUNITY_GUIDE.md`](RUST_COMMUNITY_GUIDE.md) (community engagement) ·
[`CONTRIBUTING.md`](CONTRIBUTING.md) (evidence standard, honesty gates) ·
[`SECURITY.md`](SECURITY.md) (reporting path, current posture) ·
[`PRIVACY.md`](PRIVACY.md) (local-first data flows) ·
[`README.md`](../README.md) (license statement — shipped: dual `MIT OR Apache-2.0` badge)
