# Wanyrix — crates.io Strategy

Status: **policy + plan**. Satisfies spec §56 (Rust ecosystem integration) and §57
(crates.io strategy). Nothing has been published to crates.io yet — the engine is at
**v0.9.0** with the CLI binary shipped (v0.8.0; the full command surface is pinned in
[`CLI.md`](CLI.md)) — so this document fixes *what gets published, in what order, under
which rules* so the first release is boring, correct, and trustworthy. It complements
[`RUST_COMMUNITY_GUIDE.md`](RUST_COMMUNITY_GUIDE.md) (community side) and
[`OPEN_SOURCE_STRATEGY.md`](OPEN_SOURCE_STRATEGY.md) (license, governance, cadence).

Prime directive (spec §57): **do not publish internal implementation crates merely for
appearance.** A crate ships only when it is independently useful, documented, and stable
enough to promise.

## 1. Publication order

| Order | Crate | Kind | Contents | Publish when | Depends on |
| --- | --- | --- | --- | --- | --- |
| 1 | `wanyrix-protocol` | lib | Shared types & schema definitions: W-EIR evidence shapes, finding records (stable IDs, severity, confidence), flavor envelopes (`wanyrix.report/v1`-style), report/scorecard payloads | First — smallest, most reusable, zero engine internals; it is the contract the web platform already pins with tests (types currently mirrored in `src/lib/wanyrix/types.ts` as fixtures) | nothing |
| 2 | `wanyrix-core` | lib | Engine library: workspace loading, collectors, Engineering Graph construction, analysis orchestration, experiment model | Met — engine v0.9.0 measures real workspaces end-to-end; crate publish still waits on 1 | `wanyrix-protocol` |
| 3 | `wanyrix` | bin (+ thin lib `wanyrix-cli` for testability) | The CLI: `doctor`, `graph`, `impact`, `report`, `experiment start` — the full command surface + exit codes pinned in [`CLI.md`](CLI.md) | Met — CLI binary shipped (v0.8.0, current v0.9.0); crate publish still after 1–2 | `wanyrix-core` |
| — | `wanyrix-eir` | (folded) | W-EIR types live in `wanyrix-protocol` initially | Split out **only if** the IR grows its own release lifecycle | — |
| — | `wanyrix-graph` | conditional lib | Graph algorithms (blast radius, critical path, duplicate detection) | Only if the algorithms stabilize enough to be independently reusable outside the engine | `wanyrix-protocol` |
| — | `wanyrix-analyzer` | conditional lib | Pluggable analyzer API + built-in rules | Only if a plugin API stabilizes; otherwise it stays internal — no cosmetic split (§ prime directive) | `wanyrix-core` |

Every published crate ships with: useful documentation, runnable examples, stated API
stability expectations, license, README, changelog, and tests — spec §57's checklist, made
verifiable in §6.

## 2. Versioning policy

Two independent version axes — crate version and machine-schema version. They are never
coupled.

| Axis | Scheme | Rules |
| --- | --- | --- |
| Crate version | SemVer (`MAJOR.MINOR.PATCH`) | `0.x`: breaking changes bump `x` (cargo treats `0.y` as incompatible y ranges); `1.x`: SemVer strictly. Pre-1.0 crates carry an explicit "API unstable" banner in their crate-level docs. |
| Machine schema (flavors) | `wanyrix.<name>/vN` — already shipped in the product (`wanyrix.report/v1`, `wanyrix.markdown/v1`, `wanyrix.scan-history/v1`, `wanyrix.release-scorecard/v1`) | Additive-only within `vN`; breaking changes mint `vN+1`; the protocol crate serializes and validates these envelopes so consumers can pin a schema version independent of crate version. Already test-enforced in the web platform. |
| MSRV | Declared per crate (`rust-version` key) | Pinned to the stable toolchain at first publish; raised only in a minor release with a changelog notice; never in a patch; verified in CI (see §5). |
| Compatibility promise | Same as the compiler-era ecosystem norm | A `1.x` consumer may upgrade any `1.y` freely; `0.x` consumers pin `0.x` exactly (documented in each crate's README). |

## 3. Feature-flag structure

Principles: default features are minimal; heavy/optional dependencies are opt-in; **no
feature flag may add telemetry, networking, or phone-home** (privacy stance,
[`PRIVACY.md`](PRIVACY.md)).

| Crate | Default | Optional features (planned) | Notes |
| --- | --- | --- | --- |
| `wanyrix-protocol` | `serde` | — | Pure types; zero heavyweight deps on purpose — it is meant to be a cheap dependency for API clients. |
| `wanyrix-core` | deterministic core only | `serde` (default), `parallel` (rayon-based collectors, if measured to matter), `wasm` (browser/embedded graph use) | Async runtime choice stays out of the default build; the deterministic core must work fully offline (product promise, `docs/ARCHITECTURE.md`). |
| `wanyrix` (CLI) | full CLI | — | No AI by default; the AI layer is additive and never in the deterministic path (Gate 18), mirroring the web platform. |

Feature rules: features are strictly additive (no feature removes behavior), every feature
combination in the table compiles in CI, and docs.rs builds with `all-features` so docs
never hide what exists.

## 4. Naming & reservation plan

- crates.io has **no organization namespaces** — crate names are global and first-come-
  first-served, and name-squatting without intent to publish is against the spirit (and
  letter) of crates.io policy. Therefore: **no placeholder crates, no squatting.**
- The namespace is claimed *by publishing real crates in the order above*: the first real
  release of `wanyrix-protocol` (§1) anchors the family; `wanyrix-core` and `wanyrix`
  follow as soon as they genuinely exist.
- `wanyrix` itself is the **binary crate name**; if unavailable at publish time, the CLI
  ships as `wanyrix-cli` with the binary still named `wanyrix` — decided at publish time,
  never pre-announced.
- Repository links in each crate point to the single canonical GitHub home
  (`github.com/Roy-Wanyoike/wanyrix` — the public push has landed); every crate README
  carries the same one-paragraph product description, the license badge, and an honest
  status line (shipped vs Roadmap).
- Directory-of-record commitments once real: docs.rs pages, GitHub topics (`rust`,
  `cargo`, `build-intelligence`, `developer-tools`, `engineering-intelligence`),
  RustForge/awesome-rust-style listings — **submitted only**, never claimed before
  inclusion.

## 5. docs.rs hygiene

| Requirement | Enforcement |
| --- | --- |
| Every public item documented | `#![warn(missing_docs)]` → promoted to `deny` before 1.0; crate-level doc shows status (shipped/Roadmap) and a quick example |
| Examples compile | Doc-tests run in CI on every PR (`cargo test --doc`) |
| Builds on docs.rs | `[package.metadata.docs.rs] all-features = true, rustdoc-args = ["--cfg", "docsrs"]`; no native/system deps in the default build |
| Badges | crates.io version + docs.rs + CI badge, added only when the underlying service actually exists (no dead badges) |
| README on crates.io | `readme = "README.md"` per crate; long-form docs live in `docs/` of the repo, not duplicated inline |

## 6. Publish checklist (per crate, per release)

Run in order; any failure stops the release. This is the mechanical form of spec §57's
per-crate requirements.

```text
[ ] 1.  Changelog entry exists for this version (Keep-a-Changelog format) — no empty releases
[ ] 2.  Version bumped in Cargo.toml; workspace lockfile updated
[ ] 3.  cargo build --all-features            (clean)
[ ] 4.  cargo test  --all-features             (incl. doc-tests)
[ ] 5.  cargo clippy --all-features -- -D warnings
[ ] 6.  cargo doc  --no-deps                   (no broken intra-doc links)
[ ] 7.  cargo semver-checks                    (against last release; breaking change ⇒ version bump proof)
[ ] 8.  cargo package --list                   (review: no secrets, no junk, license files included)
[ ] 9.  cargo publish --dry-run --allow-dirty  (fresh target dir)
[ ] 10. MSRV check on declared toolchain (CI job green)
[ ] 11. git tag <crate>-vX.Y.Z  + push tag
[ ] 12. cargo publish
[ ] 13. Verify docs.rs built; verify crates.io page renders README correctly
[ ] 14. Post-release note: changelog link posted to the community channel (RUST_COMMUNITY_GUIDE.md §11 cadence)
```

Machine contracts shipped in a release are additive-only (§2); if a release must change a
schema, it publishes `vN+1` and the checklist gains a migration note.

## 7. First-release content for `wanyrix-protocol`, grounded in today's contracts

The protocol crate is not vaporware-by-design: its types already exist as test-pinned
contracts in the web platform (fixture layer) and get ported, not invented. What v0.1.0
contains:

| Protocol item | Exists today as | Source of truth |
| --- | --- | --- |
| Finding record: stable ID (`FER-`/`WAN-` prefixes), title, section, severity (`critical`/`warning`/`info`) | Typed finding payloads on the doctor/findings routes | `src/lib/wanyrix/types.ts`, `docs/DEVELOPMENT.md` |
| Evidence items with source attribution (`cargo build --timings`, `git log`, `cargo metadata graph`, …) | Evidence tables behind every finding | [`README.md`](../README.md) honesty architecture, [`W-EIR.md`](W-EIR.md) |
| Epistemic status: confidence (`deterministic/high/medium/estimated`) + upgrade path (`estimated`→`measured`→`verified`) | Badges + Gate 21 enforcement | Tests pin the separation |
| Flavor envelopes: `wanyrix.report/v1`, `wanyrix.markdown/v1`, `wanyrix.scan-history/v1`, `wanyrix.release-scorecard/v1` (incl. the honest server-empty scan-history note) | Byte-pinned golden tests on the report route | `tests/unit/client-export.test.ts` |
| Scan-run record (duration, finding count, severity counts, trigger) | `wanyrix.scan-history/v1` run shape | `tests/unit/scan-runs.test.ts` |
| Error semantics: unknown-workspace `404 {error, knownWorkspaces}`, enum/missing-param `400`, oversized-body `413` | Live API behavior | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Exit-code ladder `0`/`2` (success / error) with the honest `101` broken-pipe note — deliberately **no** "findings present" code | CLI contract dialog + the real binary | [`CLI.md`](CLI.md) |

**Explicitly internal — never published for appearance** (spec §57 prime directive):
fixture workspace data (`helios-platform`, `atlas-consortium` files), the web platform's
view/store internals, analyzer rule *contents* until a real plugin API exists, and the
simulator heuristics. They ship inside their product, not as standalone crates.

## 8. Ecosystem integration inventory

Honest status definitions: **integrated** = shipped and exercised in this repo today
(fixture/contract level, test-pinned); **planned** = designed, scheduled on the engine
track; **not-started** = no work yet. Nothing here claims engine-side live ingestion —
that is AUDIT-I8 territory.

| Integration | Purpose | Status | Where it lives today |
| --- | --- | --- | --- |
| `cargo metadata` | Workspace/dependency source of truth for the Engineering Graph (blast radius, duplicates, critical path) | **integrated** | Engine scans real manifests (`scan`/`doctor`/`graph` v0.9.0); web graph payloads encode cargo-metadata-shaped data over fixtures and the registration bridge runs the real engine on local projects |
| `cargo build --timings` | Build-time evidence attribution (the named source in finding evidence tables) | **integrated** (engine) | Instrumented `cargo build` (`wanyrix build` → `wanyrix.build/v1`): wall clock, fresh/cache-hit rate, per-artifact stream activity, redacted diagnostics |
| rustc JSON diagnostics (`--message-format=json`) | Borrow/async diagnostics → Diagnostics view, borrow explainers | **integrated** (engine, v0.3.0+) | `wanyrix telemetry ingest` (`wanyrix.telemetry/v1`) — redacted, aggregated rustc JSON diagnostics; web Diagnostics view consumes the contract |
| rust-analyzer | IDE-surface alignment (findings where developers work) | **not-started** | No work; evaluated after CLI |
| `cargo bench` + criterion | Experiment harness: baseline → candidate → measured delta for verified upgrades | **integrated** (engine) | `wanyrix experiment record\|measure\|verify\|list` over the `.wanyrix/experiments.jsonl` ledger (estimated → measured via REAL builds → verified); web Experiments view |
| `flamegraph`/profiling | Runtime intelligence (phase 11) | **not-started** | Roadmap |
| cargo workspace lints/CI (`cargo-semver-checks`, `cargo publish --dry-run`) | Release hygiene for our own crates | **planned** | §6 checklist; enforced once a Cargo workspace exists here |
| GitHub topics / tooling directories / awesome-rust-style lists | Discoverability | **planned** | Submission-only policy — [`RUST_COMMUNITY_GUIDE.md`](RUST_COMMUNITY_GUIDE.md) §3 |

Rule for every row: a cell may only move to *integrated* with CODE+INTEGRATION+TEST+
RUNTIME evidence — the [`CONTRIBUTING.md`](CONTRIBUTING.md) standard. No status upgrades
on hope.

## 9. Cross-links

[`RUST_COMMUNITY_GUIDE.md`](RUST_COMMUNITY_GUIDE.md) ·
[`OPEN_SOURCE_STRATEGY.md`](OPEN_SOURCE_STRATEGY.md) (license + governance + cadence) ·
[`CLI.md`](CLI.md) (the contract the CLI crate implements — shipped) ·
[`W-EIR.md`](W-EIR.md) (the IR behind `wanyrix-protocol`) ·
[`COMMERCIAL.md`](COMMERCIAL.md) (why the local core is never crippled) ·
[`AUDIT.md`](AUDIT.md) (audit records, incl. engine scope)
