# Wanyrix — Governance

Status: **interim governance for the single-maintainer phase** (honest, by design).
The project has one maintainer today; this document describes who decides, how to
propose, how disputes escalate, and which rules nobody is allowed to quietly change —
without pretending a committee exists that doesn't. It implements the governance model
defined in [`docs/OPEN_SOURCE_STRATEGY.md`](docs/OPEN_SOURCE_STRATEGY.md) §5 and ships
as part of the governance & posture bundle (issue #119).

Applies to: this repository (engine, web console, docs, CI configuration) and its
community spaces (issues, pull requests, discussions). The future hosted Wanyrix Cloud
service is a commercial product, not a community-governed artifact — see
[`docs/COMMERCIAL.md`](docs/COMMERCIAL.md).

## 1. Decision-making today (BDFL phase)

| Question | Answer |
| --- | --- |
| Who decides? | The project founder and maintainer ([@Roy-Wanyoike](https://github.com/Roy-Wanyoike)), acting as BDFL, with public reasoning. |
| Where are decisions recorded? | In public, on the record: issues, PR reviews, and explicit decision records inside the affected design doc (worked example: the Plugin API v1 decision record in [`docs/PLUGIN_AND_EVENTS.md`](docs/PLUGIN_AND_EVENTS.md)). A decision that lives only in someone's head is not a decision. |
| What decides correctness? | The evidence standard in [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) §1 (CODE+INTEGRATION+TEST+RUNTIME+DOC). Measured beats asserted; a claim without evidence is a defect, not an opinion. |
| What can never be decided away? | The honesty gates (§4 below). |

## 2. How to propose a change

1. **Issue first.** File a GitHub issue using the issue-record structure from
   [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) §2 (Problem / Evidence / Expected /
   Acceptance / DoD). Duplicate-check against open *and* closed issues before filing.
2. **PR second.** Work lands only through reviewed PRs referencing their issue.
   Conventional-commit subjects; the pinning tests and doc updates ride in the same PR.
3. **Design directions** (new surfaces, contract changes, anything touching the
   honesty architecture) start as a proposal on the tracking issue and are recorded as
   a decision record in the relevant `docs/*.md` before implementation begins.
4. **Roadmap honesty.** Anything not shipped is labeled Roadmap in docs and issues —
   the same estimated/measured/verified discipline applied to process claims.

## 3. Maintainers and the transition out of BDFL

- **Ladder** (from [`docs/OPEN_SOURCE_STRATEGY.md`](docs/OPEN_SOURCE_STRATEGY.md) §6):
  contributor → regular (3+ merged PRs honoring the evidence standard) → maintainer
  (invite by existing maintainers, 2/3 consent; review rights + CODEOWNERS entry).
- **Transition trigger to a maintainers council** (3–5 members including the founder):
  ≥ 3 sustained external maintainers with ≥ 6 months of merged work, or 1.0 of the
  first open crate — whichever comes first.
- **After the transition**: substantive changes (API, schema flavors, honesty gates,
  license) require a lightweight public RFC + council lazy-consensus with a 72 h
  objection window. Until then the BDFL decides and documents.

## 4. The unchangeable core (the constitution)

The honesty gates are constitutional — no maintainer, council, or contributor may
weaken them unilaterally, and a council-level change would require a supermajority
plus a public rationale:

- **Estimated ≠ Measured ≠ Verified** — nothing upgrades its own status; only a
  recorded experiment with real measured builds yields `verified` (Gate 21).
- **No false Verified claims** in issues, docs, scorecards, or commit messages.
- **No fabricated evidence** — empty-but-labeled beats invented numbers; roadmap items
  are labeled Roadmap.
- **No silent modification** — patches are reviewable diffs behind explicit approval.
- **AI is never the source of truth** — model output is confined, validated, and
  redacted; the deterministic core works with the provider off.

These are pinned by tests, not by trust (`engine/src/product.rs`, the conformance and
chaos suites, and the web contract tests are the enforcement layer).

## 5. Disputes and escalation

1. **Technical disagreement** → resolve on the PR/issue with evidence; a maintainer
   ruling closes the thread (the ruling itself must carry reasoning, per §1).
2. **Ruling appealed** → open a governance issue stating the disputed decision and the
   evidence; the BDFL (today) or the council (after transition) re-hears it once.
3. **Conduct problems** → the Code of Conduct path below; moderation is separate from
   technical disagreement and never overrides it into a behavior excuse.

## 6. Code of Conduct

Wanyrix has adopted the **Rust Code of Conduct** — see
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) for the operative rules, scope, and how to
report. Conduct reports are handled by the maintainer while the project is in the
single-maintainer phase; conflicts of interest escalate per that document.

## 7. Trademark policy (one-pager)

The **Wanyrix** name and the Beacon-W logo are the project's trademarks. They are
deliberately **not** granted by the code licenses (`MIT OR Apache-2.0`) — the Apache
license itself declines to grant them, and this policy fills that gap. Structure
mirrors the Rust trademark policy: friendly to honest use, firm on confusion.

**Allowed without asking** (factual, truthful references):
- "built for Wanyrix", "compatible with Wanyrix", "a plugin for Wanyrix";
- saying your project reads or emits `wanyrix.*/v1` envelopes;
- linking to the project, taking screenshots of the product, writing about it;

**Requires permission** (the confusing cases):
- naming a fork or derivative distribution "Wanyrix …" (call it "*your name*, a
  Wanyrix fork" instead);
- using the Wanyrix name or Beacon-W logo as your own product/brand;
- implying endorsement, partnership, or official status.

**Mechanics:** no trademark rights are granted by [`LICENSE`](LICENSE),
[`LICENSE-MIT`](LICENSE-MIT), or [`LICENSE-APACHE`](LICENSE-APACHE); the README states
the same. Requests and reports: open a GitHub issue (or a private channel if the
matter is sensitive). Escalation is graduated — clarify, correct, then enforce — and
honest, factual community references are never the target (this policy exists to stop
confusion, not conversation).

## 8. Governance & posture artifact map

| Artifact | Role |
| --- | --- |
| [`GOVERNANCE.md`](GOVERNANCE.md) (this file) | who decides, how to propose, escalation |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | Rust CoC adoption, scope, reporting path |
| [`docs/SECURITY.md`](docs/SECURITY.md) | security posture, input validation, reporting policy |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | assets, trust boundaries, STRIDE-lite analysis |
| [`docs/RELEASE_RUNBOOK.md`](docs/RELEASE_RUNBOOK.md) | release engineering, signing + release-keypair checklists |
| [`docs/PRIVACY.md`](docs/PRIVACY.md) | zero-telemetry data flows (the data contract) |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | evidence standard, issue records, PR conventions |
| [`docs/OPEN_SOURCE_STRATEGY.md`](docs/OPEN_SOURCE_STRATEGY.md) | the strategy this document implements |

## 9. Governance bundle status (issue #119 — kept honest)

| Row | State |
| --- | --- |
| Interim `GOVERNANCE.md` | **Done** (this file) |
| Code of Conduct (Rust CoC) | **Done** — adopted by reference + operative file |
| Trademark policy note | **Done** — §7 one-pager; fuller policy drafted if community scale demands it |
| `THREAT_MODEL.md` (STRIDE-lite) | **Done** — draft with review triggers |
| Security reporting refresh | **Done** — [`docs/SECURITY.md`](docs/SECURITY.md) Reporting section |
| GitHub private vulnerability reporting | **Enabled** (2026-09-22, maintainer action completed via the repository settings API; verified `{"enabled": true}`) |
| Dependency automation (`.github/dependabot.yml`) + secret-scanning CI job | **Tracked in #149** (own lane; must carry the billing-locked honesty label) — governance mapping in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) §6 |
| SAST/DAST tooling mapping | **Done as roadmap mapping** — [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) §6; tool selection/landing tracked with #149 and the hosted-runner unlock |
| Release keypair trigger | **Done** — checklist in [`docs/RELEASE_RUNBOOK.md`](docs/RELEASE_RUNBOOK.md) §6 |
| NOTICE file + per-source-file copyright headers | **Open** (Apache-2.0 Appendix-A convention; per-file headers are an engine-wide edit — deliberately out of a docs-only bundle) |
| Commit-history review for anything unsuitable for publication | **Open** (spot-checks are clean per the security review; the exhaustive pass remains a maintainer action) |

## 10. Changes to this document

By PR, referencing an issue. Substantive changes (decision rights, the constitution,
the transition trigger) need the BDFL's sign-off today and council lazy-consensus
(72 h) after the transition. Editorial fixes follow the normal review path.
