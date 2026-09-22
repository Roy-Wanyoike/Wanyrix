# Wanyrix — Rust Community Guide

Status: **operational plan** for how Wanyrix shows up in the Rust ecosystem. It satisfies
spec §54 (discoverability strategy) and §55 (community guide document; named
`RUST_COMMUNITY_GUIDE.md` per this repo's docs convention). It is a **plan, not a record**:
nothing below claims that a post, listing, or inclusion has already happened — spec §56's
rule applies everywhere here: *do not claim inclusion in any community resource until it
actually occurs*.

Ground rules (spec §54, non-negotiable):

1. **No spam.** No copy-paste announcements across communities. Each channel gets
   community-specific material (§3).
2. **No ranking manipulation.** No star campaigns, upvote rings, sock puppets, or
   astroturfed threads.
3. **Earn organic adoption** by being useful first — the product does the talking.
4. **Verify each community's current rules immediately before posting.** Rules and channel
   names drift; the table in §3 is a starting map, not a substitute for the check.
5. **The honesty architecture applies to marketing too** ([`CONTRIBUTING.md`](CONTRIBUTING.md)
   §3): Estimated ≠ Measured ≠ Verified; Roadmap items are labeled Roadmap; no fabricated
   numbers in any public material.

## 1. Product status snapshot — what public material may claim

Every public claim must match this table. The rule of thumb: a post may only demonstrate
what a reader can reproduce today with [`README.md`](../README.md) ("Run locally" +
"First analysis").

| Surface | Status | Allowed in public material |
| --- | --- | --- |
| Web platform (19-view dashboard, 23 API routes, 299-test suite: 296 pass / 3 skip — measured 2026-09-22) | **Shipped, verified** (gates green; browser-QA rounds M1–M9) | Real demo, screenshots, live walkthrough |
| Honesty architecture (Estimated ≠ Measured ≠ Verified, Gate 21) | **Shipped, test-enforced** | Core differentiator — show it |
| Grounded AI (server-rendered FACT block, post-validated model output) | **Shipped, tested** | Show a real transcript ([README example](../README.md)) |
| Versioned API flavors (`wanyrix.report/v1`, `wanyrix.scan-history/v1`, `wanyrix.release-scorecard/v1`) | **Shipped, pinned by tests** | Show as contract examples |
| CLI (`wanyrix` binary) | **Shipped** — real binary since v0.8.0 (engine v0.9.0), 23-command surface + exit codes (`0`/`2`, honest `101` broken-pipe note) pinned in [`CLI.md`](CLI.md); `cargo install` from crates.io is **Roadmap** (publication plan in [`CRATES_IO_STRATEGY.md`](CRATES_IO_STRATEGY.md)) | Demo the real binary from the repo; label crates.io install as Roadmap |
| Rust engine | **Shipped** — `wanyrix-engine` v0.9.0 in-tree, wired into the web platform (workspace registration bridge + engine-exec routes); 182 tests per `engine/README.md` (v0.9.0) | Real engine demos on local workspaces (doctor/graph/impact/build); no perf claims without fresh measurements |
| Wanyrix Cloud / billing | **Designed, not built** ([`COMMERCIAL.md`](COMMERCIAL.md)) | Never demo or imply live |

## 2. Project introduction (the 30-second version)

- **Problem**: Rust teams lose days to incremental-build pathologies, duplicate dependency
  trees, and borrow-checker/architecture bottlenecks nobody can quantify. Answers live in
  folklore, not evidence.
- **What Wanyrix does**: continuously understands a Rust workspace, builds an Engineering
  Graph from it, and turns that graph into evidence-cited findings, recommendations, and
  experiments — where every number carries its epistemic status and only a recorded
  experiment can upgrade a claim to *verified*.
- **Why Rust developers may care**: build intelligence (why is CI slow), dependency
  analysis (duplicate versions, blast radius), architecture intelligence (hotspots, safe
  refactors), evidence-based optimization (baseline → candidate → measured delta, not
  vibes).

## 3. Channels

Verify rules at post time; never auto-post. One announcement per channel, tailored to it.

| Channel | What fits there | Check before posting |
| --- | --- | --- |
| Rust Users Forum (users.rust-lang.org) | "Show and tell"-style project post: problem, honest demo, invitation to critique | Current category names + self-promotion norms on the forum |
| r/rust | Project post when the submission rules and self-promotion ratio allow; comment-driven engagement | Subreddit rules, moderation guidance, promo-ratio policy |
| This Week in Rust (TWiR) | A link submission for a substantive post or release — **after** the community post exists and got real feedback incorporated | The submission process documented in the TWiR repository at that time |
| Rust Community Discord | Where project-sharing channels and rules permit; conversations, not announcements | Current channel list + that server's promo rules |
| rust-lang Zulip | Generally the Rust *project's own* workspace — not a product-promotion venue; only specific streams if explicitly welcomed | Stream charters before any use |
| RustConf / regional conferences (RustWeek, Rust Nation, …) | CFP talk only when there is a *running artifact* to demo (CLI/engine release, not a slideware future) | CFP windows; disclosure of commercial status if asked |
| Local meetups | Organizer consent first; hands-on walkthrough of the web platform | Organizer + venue policy |
| Developer-tooling communities (build/perf/devex groups) | The build-intelligence angle where on-topic | Group rules |
| Newsletters / awesome-rust-style lists | Submit only real, published artifacts; never claim inclusion | Each list's contribution bar |

**Not a venue**: internals.rust-lang.org (RFC/governance discussions), issue trackers of
unrelated projects, DMs to strangers, cross-posting the same text everywhere.

## 4. Launch sequencing (staged, feedback-gated)

```text
Stage 0 — Materials ready   ──▶  Stage 1 — Soft share  ──▶  Stage 2 — Public posts  ──▶  Stage 3 — TWiR + lists
     (this doc, §5)              (trusted contacts)          (forum + r/rust + HN)        (only after feedback absorbed)
```

| Stage | Entry criteria | Actions | Exit criteria |
| --- | --- | --- | --- |
| 0 | Public repo reachable — **met**: `github.com/Roy-Wanyoike/wanyrix` is public with a live issue tracker | Polish README, demo script, FAQ; set up issue tracker + labels (§7) | A stranger can go README → running dashboard in < 5 min |
| 1 | Stage 0 done | Share privately with trusted Rust devs; ask for blunt criticism; fix top complaints | ≥ 3 external people completed first-run without hand-holding |
| 2 | Stage 1 fixes landed | Tailored posts: Users Forum, r/rust, Show HN; author sticks around and answers everything for ≥ 48 h | Posts stand on their own; zero moderation complaints |
| 3 | Stage 2 feedback incorporated visibly | TWiR submission; awesome-rust-style list submissions; conference CFP watch | Each inclusion **actually occurs** before it is ever mentioned |

## 5. What is shareable today vs later

| Shareable **today** (reproducible from the repo) | Shareable **later** (label Roadmap until real) |
| --- | --- |
| Web dashboard demo over fixture workspaces (`helios-platform`, 47 crates · `atlas-consortium`) | `cargo install wanyrix` (crates.io publication — [`CRATES_IO_STRATEGY.md`](CRATES_IO_STRATEGY.md)) |
| Real engine analysis on a local workspace via the shipped `wanyrix` binary (doctor/graph/impact/build; engine v0.9.0) | crates.io publications of `wanyrix-protocol` / `wanyrix-core` |
| Honesty architecture: `estimated`/`measured`/`verified` badges, no silent upgrades | Cloud/team features (designed, not built) |
| Grounded AI transcript: server-rendered FACT block + validated `ai.*` fields | Any perf claims about the engine itself (until freshly measured) |
| Versioned machine flavors + 23-route API surface with documented error semantics | — |
| Evidence-cited findings with stable IDs and verification paths | — |
| 90-day trial *model* as a proposal ([`COMMERCIAL.md`](COMMERCIAL.md)) — never as a live offer | — |

## 6. First-run workflow & example (for community posts)

- **Installation (today)**: `bun install` → `bun run dev` → `http://localhost:3000` →
  follow the README's 5-minute "First analysis" walkthrough. No accounts, no telemetry,
  works offline ([`PRIVACY.md`](PRIVACY.md)). The engine CLI ships in-tree: build the
  `wanyrix` binary from `engine/` (see [`CLI.md`](CLI.md) for the 23-command surface).
- **Installation (Roadmap)**: `cargo install wanyrix` once the crates.io publication
  lands — the command set, flags, and exit codes (`0`/`2`, honest `101` broken-pipe
  note) are pinned in [`CLI.md`](CLI.md).
- **Example analysis**: use the README's real transcript — finding `FER-BLD-001`
  ("common-runtime sits on the critical path", 18.3 s compile, 41 downstream crates), the
  evidence table, and the grounded AI answer with `grounding.facts` + `ai.uncertainty`.
  Posts may quote it verbatim because it is a real captured API response.

## 7. Contribution pathways & feedback

Full rules: [`CONTRIBUTING.md`](CONTRIBUTING.md) (evidence standard
CODE+INTEGRATION+TEST+RUNTIME+DOC, 14-field issue records, honesty gates, brand gate,
conventional commits). Community-facing entry points:

| Contribution type | Where to start |
| --- | --- |
| Analyzers (new findings/sections) | `docs/DEVELOPMENT.md` fixture conventions; a finding = evidence + recommendation + verification path |
| Collectors (new evidence sources) | Engine track, v0 stage — propose first via an issue record; source-attribution format in [`W-EIR.md`](W-EIR.md) |
| Fixtures (new workspace shapes) | `src/lib/wanyrix/data.ts` + `docs/DEVELOPMENT.md` rules |
| Integrations (CI, editors, cargo tooling) | See [`CRATES_IO_STRATEGY.md`](CRATES_IO_STRATEGY.md) inventory; contract-first |
| Docs & triage | Labels below + the issue-record template |

**Feedback routing** (spec §55): the public GitHub issue tracker is live — file issues
there; label conventions below.

| Feedback type | Label | Notes |
| --- | --- | --- |
| Bugs | `kind/bug` | Repro + evidence required (the product's own standard) |
| **False positives** (a finding that shouldn't fire) | `kind/false-positive` | First-class — trust in the analyzer is the product |
| Missing Cargo support | `kind/compat` + `area/cargo` | e.g. workspaces, features, target-specific deps |
| Compiler compatibility issues | `kind/compat` + `area/rustc` | Include `rustc -vV` |
| Feature requests | `kind/feature` | Problem statement first, solution second |
| Performance problems | `kind/perf` | Numbers with epistemic status, please |

**Triage label convention** (applied at triage, kept consistent with the issue-record
severity ladder in [`CONTRIBUTING.md`](CONTRIBUTING.md)):

| Axis | Labels |
| --- | --- |
| Kind | `kind/bug` · `kind/feature` · `kind/docs` · `kind/false-positive` · `kind/compat` · `kind/perf` |
| Area | `area/build` · `area/deps` · `area/graph` · `area/architecture` · `area/experiments` · `area/ai` · `area/cargo` · `area/rustc` · `area/cli` · `area/web` |
| Severity | `P0` … `P4` (P0 breaks a shipped promise/data loss · P4 hygiene — same definitions as CONTRIBUTING) |
| Status | `status/triage` · `status/accepted` · `status/in-progress` · `status/fixed-pending-verification` · `status/verified` · `status/wontfix` |
| Participation | `good-first-issue` · `help-wanted` |

Status labels mirror the honesty gates: an issue only reaches `status/verified` after
RUNTIME evidence re-check — the same rule that applies internally.

## 8. Roadmap transparency policy

- The public roadmap is the README's phases 1–15; items are either **shipped**,
  **in progress**, or **Roadmap** — nothing in between, no euphemisms.
- Community feedback may reorder Roadmap items; it can never silently redefine what is
  already shipped.
- Any public claim that turns out wrong gets a public correction (the same standard the
  release scorecard applies to itself: GO / CONDITIONAL GO / NO-GO).

## 9. Release compatibility (what we commit to)

| Dimension | Policy |
| --- | --- |
| Rust versions | Engine/CLI MSRV: declared per crate at first publish and tested in CI; raised only in minor releases with a changelog notice ([`CRATES_IO_STRATEGY.md`](CRATES_IO_STRATEGY.md)). Current stable required only for *developing* the web platform toolchain (Bun/Node). |
| Platforms | Engine/CLI target: Linux (primary), macOS, Windows at first engine release; web platform: any modern browser today. |
| Cargo versions | Track the toolchain shipped with stable Rust; Cargo-specific behavior (workspaces, features, target-specific deps) tracked under `area/cargo`. |
| Machine contracts | `wanyrix.report/v1`-style flavors are additive: `v1` never changes shape — breaking changes mint `vN+1`. Already enforced by tests. |

Engine values in this table are policy commitments, not measurements — first validated at
the first crates.io release.

## 10. Community etiquette & code of conduct

- Adopt the **Rust Community Code of Conduct** (rust-lang.org/policies/code-of-conduct)
  for all Wanyrix-run spaces, with the Rust moderation spectrum; adopting it for this
  repo is part of the governance bundle (#119).
- In external communities we follow **their** rules and moderators, not ours: read the
  pinned rules, disclose affiliation, never argue moderation publicly, accept "no" the
  first time.
- Engage as a maintainer who answers hard questions, not a marketer: criticism of the
  product is filed, not defended.

## 11. 90-day community engagement calendar

T0 = the day the public repo is reachable — **reached** (the repo is public; Stage 0
housekeeping continues per the governance bundle #119). All items are proposals gated on
real completion of the previous item; slipping beats spamming.

| Week | Focus | Concrete actions | Success signal |
| --- | --- | --- | --- |
| T0+1 | Housekeeping | Tracker live, labels (§7) applied to starter set, 5–10 `good-first-issue` entries opened on the tracker | Every open issue has kind+severity labels |
| T0+2 | Soft share (Stage 1) | 1:1 shares with trusted Rust devs; explicit ask for blunt criticism | ≥ 3 first-run completions |
| T0+3–4 | Fix + tailor | Fix Stage-1 complaints; draft channel-specific posts; re-verify each community's rules | Drafts reviewed against current rules |
| T0+5 | Users Forum post | Tailored "Show and tell" post; author replies to everything for 48 h | Zero moderation friction; ≥ 1 actionable critique filed |
| T0+6 | r/rust post | Distinct framing (honesty architecture angle) after rule re-check | Post stands; no removal |
| T0+7 | Blog post | "Why our AI can't lie" or "Estimated ≠ Measured ≠ Verified" deep-dive with the real transcript | Published; linked from README |
| T0+8 | Show HN | Submit the blog post or the demo; author on-call all day | Honest Q&A thread |
| T0+9–10 | TWiR + respond | TWiR submission (their documented process); triage the influx; publish a "feedback → fixes" changelog note | All feedback labeled within 7 days |
| T0+11 | Lists + meetups | awesome-rust-style submissions (only if quality bar genuinely met); contact 1–2 local meetup organizers | Inclusion only where it **actually** occurs |
| T0+12 | Review | Engagement retro vs metrics below; decide cadence (monthly note? release notes?) | Written retro in the repo |
| T0+13 | CFP watch | Shortlist 2–3 conferences with real demo-able artifacts; draft CFPs | CFPs ready before deadlines |
| T0+14 | Cadence lock | Establish recurring community note + triage SLA review | Calendar repeats sustainably |

**Health signals to watch (not vanity metrics):** median time-to-first-response (< 48 h),
issues triaged < 7 days, false-positive report rate trending down, share of PRs from
external contributors, and whether strangers complete the 5-minute first-run unaided.

## 12. Cross-links

[`CONTRIBUTING.md`](CONTRIBUTING.md) · [`CRATES_IO_STRATEGY.md`](CRATES_IO_STRATEGY.md) ·
[`OPEN_SOURCE_STRATEGY.md`](OPEN_SOURCE_STRATEGY.md) · [`COMMERCIAL.md`](COMMERCIAL.md) ·
[`PRIVACY.md`](PRIVACY.md) · [`CLI.md`](CLI.md) · [`USER_GUIDE.md`](USER_GUIDE.md) ·
[`AUDIT.md`](AUDIT.md) (audit records)
