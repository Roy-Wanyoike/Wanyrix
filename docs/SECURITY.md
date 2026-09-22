# Wanyrix Web Platform — Security Posture

Scope: this repository (the Next.js web platform). Status: **local-first demonstrator**
— the shipped threat surface is deliberately minimal, and this document states what is
actually enforced in code today vs. what is **Roadmap**. See also
[`docs/PRIVACY.md`](PRIVACY.md) (data flows) and the engine boundary section of [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
(engine scope).

## 1. Authentication & authorization

- **No auth surface exists.** There are no accounts, sessions, cookies, or login
  routes; `next-auth` is unused scaffold. Every API route is an unauthenticated
  local surface (`/api/wanyrix/*`) — fixture-derived data on the read routes, and,
  since the registration bridge, engine-measured / client-POSTed records on the
  sync routes (Gate 21: the server never invents data).
- Consequence: nothing in this app authorizes anything. Organization/tier data is
  explicitly badged fixture (AUDIT-I3 acceptance: *"must not expose or mutate anything
  beyond fixtures until real auth exists"*). Cloud/auth features are **Roadmap**
  (nothing is authorized or billed today).
- **State-changing surfaces exist** (no longer "none"): `POST /api/wanyrix/scan-runs`
  persists the durable scan-run log; `POST`/`DELETE /api/wanyrix/workspaces` registers
  or removes a local project (running the real engine on `POST`, writing the local
  SQLite store); `POST /api/wanyrix/license/issue` executes the real engine's offline
  license issuer; `GET /api/wanyrix/engine/{build,doctor,impact}` and `/git` execute
  the real engine binary on demand (read surfaces, no writes); `POST
  /api/wanyrix/storage/{rebuild,reclaim}` mutate in-process simulated state only.
  All durable writes land in the local SQLite file on the machine running the server —
  see [`docs/PRIVACY.md`](PRIVACY.md) for exactly what is stored.
- **Network boundary (QA-3-B-1): the dev server binds loopback only.** The
  `dev` script starts the server as `next dev -H 127.0.0.1 -p 3000`
  (guarded in `package.json` by the `//` security-guard key directly above
  `scripts`), so the unauthenticated surface above is reachable only from
  the machine itself — matching the "local machine" wording used throughout
  this document. Two honesty notes: (1) the binding is start-time config —
  the dev server that was running when this fix landed had been started
  from the pre-fix script and held the wildcard bind (`ss -tlnp` →
  `*:3000`, measured 2026-09-22 before it was restarted); the loopback bind
  is enforced from the first start AFTER this change. (2) The guarded
  script is the enforced default — a deployment that starts the server
  through any other harness must pass an equivalent loopback hostname, and
  if it does not, the reachable set widens beyond what this document
  claims. Production serving (`next start` of the standalone build) is out
  of scope for the local-first demonstrator (Roadmap, §8).
- `POST /explain` remains a pure reasoning endpoint that writes nothing. GET-only
  routes enforce method discipline: `POST/PUT/DELETE/PATCH` return `405` carrying the
  RFC 9110 `Allow` header (ENG-TCA-6a, ENG-TE-1).

## 2. Secrets

- **No secrets in the tree.** The only tracked env file is `.env.example`, a placeholder
  template; the real `.env` is git-ignored (`git check-ignore .env` → ignored) and
  holds a local SQLite path (`DATABASE_URL=file:…`), not a credential.
- The AI provider credentials are resolved server-side by the `z-ai-web-dev-sdk` at
  runtime — they are never embedded in source or shipped to the browser.
- Checked by: `git check-ignore .env` → ignored, and review of tracked files (only the
  placeholder `.env.example` is committed); a dedicated secret-scanning CI job is
  **Roadmap**.

## 3. Input validation (defense in depth on every route)

| Control | Implementation | Behavior |
| --- | --- | --- |
| Workspace guard | `workspaceGuard`/`resolveWorkspace` (`src/lib/wanyrix/api.ts`) on every `ws`-accepting route, validated against the `/workspaces` registry | unknown workspace → `404 {error, knownWorkspaces}`; absent/empty → registry default. Silent substitution impossible (ENG-TCA-1) |
| Kind validation | `/explain` rejects an explicit unknown `kind` | `400 unknown kind '…' (expected: issue \| borrow \| impact \| gate \| general)` (ENG-TCA-6c) |
| Required params | `/impact` missing `target`, `/explain` missing `context`/`question` | `400` (missing-param vs unknown-target split — ENG-TCA-6b) |
| Enum params | `/impact` `type`, `/report` `format` + `flavor` | unknown value → `400` naming valid values |
| Payload caps | `/explain` rejects bodies > 256 KB via `content-length` **and** actual byte count, before parsing or provider work | `413` in ~5 ms (measured — `docs/PERFORMANCE.md`); prompt context truncated at 48,000 chars with `contextTruncated` flag |
| Method discipline | 405 responses carry the RFC 9110 `Allow` header (ENG-TCA-6a, ENG-TE-1) | clients can discover the correct method |

There are no SQL, shell, or path-traversal inputs: routes read fixture data by id
through typed getters; no user string is ever used as a file path or query.

## 4. XSS posture

- **JSON APIs**: every API response is `application/json`; an XSS payload in a query
  param is JSON-encoded, never HTML (verified live: `?ws=<script>` reflects as a JSON
  string).
- **React escaping**: all UI is JSX-rendered — React escapes interpolated strings by
  default. There is **one** `dangerouslySetInnerHTML` in the tree
  (`src/components/ui/chart.tsx`), and it injects CSS theme variables built from the
  developer-defined `ChartConfig` prop, not user input.
- No `innerHTML`/`eval` usage anywhere in `src/`. Markdown rendering (react-markdown)
  does not enable raw-HTML pass-through by default.

## 5. Supply chain

- Dependencies are pinned in `package.json` with a committed lockfile (`bun.lock`);
  runtime deps are mainstream UI/framework packages.
- **No telemetry/analytics endpoints ship in the product code.** The scaffold's
  `@vercel/analytics` snippet was removed from the rendered tree: `src/app/layout.tsx`
  carries an explicit no-analytics note (ENG-T3A-1) and no module under `src/` imports
  it (the unused package entry remains in `package.json`). Zero-telemetry policy:
  [`docs/PRIVACY.md`](PRIVACY.md).
- Prisma backs the optional durable sync targets (durable scan-run log, registered
  workspaces) in a **local SQLite file** on the machine running the server — see
  [`docs/PRIVACY.md`](PRIVACY.md) for exactly what is stored and why.
- **CI exists** as four workflow definitions under `.github/workflows/`:
  `ci.yml` (web gate: lint · types · tests · brand gate), `wanyrix.yml` (engine
  referee: fmt · build · clippy · tests + measured envelopes), `release.yml`
  (tag/dispatch-triggered release engineering), and `perf.yml` (dispatch-only
  perf/soak/flake harnesses). `release.yml` ships a CycloneDX **SBOM** job and a
  **cargo-audit** advisory-audit job alongside multi-target binaries and checksums.
  Honesty note: the repository's hosted Actions runners are billing-locked (documented
  in the `wanyrix.yml` honesty label) — hosted run records exist but no job steps have
  executed, so these gates are validated locally, not on hosted runners. Renovate /
  Dependabot: **Roadmap** (not configured).

## 6. AI / sandbox data boundaries

- The explain route forwards **only** what the caller explicitly submits: the `context`
  payload, the `question`, a `kind` label, and — when the context names a stable id —
  the server-side registry record for that id. No localStorage content, no workspace
  files, no page state leaves the machine (see `docs/PRIVACY.md`).
- The provider runs in the platform's server sandbox; the browser never talks to it
  directly.
- **Grounding firewall** (ENG-TCA-4 / AUDIT-I7): the model writes only
  `ai.{commentary, inference, recommendation, uncertainty}`; the authoritative FACT
  block is re-rendered server-side and cannot be altered by the model. Post-validation
  (`validateModelGrounding`) checks every number, status word, and ID-like/quoted
  reference against the evidence corpus; violations are redacted
  (`⟨removed: not in evidence⟩`), listed in `groundingViolations`, and the response
  degrades to the deterministic answer. Known best-effort boundary: semantic
  misattribution of an evidence-true number is mitigated by field confinement +
  rejection, not by understanding (documented in `docs/ARCHITECTURE.md`).
- Status-escalation firewall: neither the model nor the simulator can emit
  `verified` — only recorded experiments can (Gate 21).

## 7. Data at rest

- Browser: all persisted UI state is localStorage (workspace preference, scan history,
  diff queue, theme, AI status label) behind the legacy-key → new-key storage migration
  layer (protocol documented in `docs/PRIVACY.md`, `docs/ARCHITECTURE.md`, and
  Settings' live migration-status panel). Clearing site data removes it; reset
  instructions in `docs/PRIVACY.md`.
- Server: the optional durable sync target is a **local SQLite file** (scan-run log +
  registered-workspace rows; see `docs/PRIVACY.md` for the exact fields). It lives on
  the machine running the dev server (`db/custom.db` in this checkout, path configured
  via the git-ignored `.env`) — no cloud copy exists.

## 8. Roadmap (not implemented — do not assume otherwise)

- **THREAT_MODEL.md** and a formal trust-boundary review (the posture above is the
  current informal equivalent).
- SAST/DAST and secret-scanning in CI (CI itself exists — see §5; these deeper gates
  are not wired yet).
- Renovate/Dependabot dependency-update automation (SBOM + cargo-audit already ship in
  `release.yml`; see §5).
- Signed releases and provenance attestation: `release.yml` deliberately stops short of
  artifact signing — it stages binaries, SBOM, advisory audit, and checksums so signing
  is the only remaining step (requires maintainer secrets).
- Authentication, multi-tenancy, plugin sandboxing (Phases 13–14 — roadmap).
- GitHub **private vulnerability reporting**: planned, tracked in the governance bundle
  (#119) — **not enabled yet**; do not assume a private channel exists (see Reporting).

## Reporting

The repository is public (`github.com/Roy-Wanyoike/wanyrix`) with an open issue
tracker: ordinary bugs — including security-relevant ones that are safe to disclose —
can be filed as GitHub issues. For findings you prefer **not** to disclose publicly,
GitHub's private vulnerability reporting is the intended channel once enabled:
enabling it is planned and tracked in the governance bundle (#119) — **it is not
enabled yet**, so please do not assume a private channel exists. Either way, include
reproduction steps and the affected surface (API route / CLI command / engine
behavior); process context in [`docs/CONTRIBUTING.md`](CONTRIBUTING.md).

## 9. Adversarial input fixtures (engine, issue #71)

The **engine** (`wanyrix-engine`) treats a repository as UNTRUSTED INPUT: hostile
content must fail safe — a named finding (`FER-ENG-ERR-n`) or a named error
(`EngineError` variant) — never a panic, never a hang, never a silent drop. The
fixture suite `engine/tests/adversarial.rs` (24 tests) pins this contract case by
case. Two real defects were found and fixed while building it (both hangs in
`engine/src/scan.rs`, fixed via the `pathutil::read_regular_file` guard: symlink /
non-regular-file / 16 MiB-cap refusal):

| # | Hostile case | Expected outcome (pinned) | Test name |
| --- | --- | --- | --- |
| 1 | Unicode/homoglyph crate names (CJK, emoji, Cyrillic homoglyph, RTL override) | Measured verbatim as strings; edge + finding ids keep the names; every JSON envelope stays valid UTF-8 and round-trips | `unicode_and_homoglyph_crate_names_round_trip_through_json` |
| 2 | Unquoted non-ASCII TOML dependency key (emoji) | Named critical `FER-ENG-ERR` finding ("invalid unquoted key"); declaring crate honestly absent | `unquoted_unicode_dep_key_is_a_named_parse_finding` |
| 3 | Non-UTF-8 directory name (lone `0xE9` byte) | Measured with a visible U+FFFD lossy marker; output stays valid UTF-8 JSON | `non_utf8_directory_name_is_measured_with_a_visible_lossy_marker` |
| 4 | 100-level deep directory nesting | Walk terminates at the documented depth cap (`MAX_DEPTH` = 48): depths ≤ 48 walked, first dir past the cap counted in `skipped`, deeper never visited | `deep_nesting_terminates_at_the_documented_depth_cap` |
| 5 | Huge manifest (4,100 dependencies) | Linear parse; full doctor + graph surface bounded (5 s blowup guard, not an SLO) | `huge_manifest_with_thousands_of_deps_is_bounded` |
| 6 | Manifest beyond the 16 MiB measured-file cap | Named `FER-ENG-ERR` ("exceeds the measured-file cap") — no OOM, no unbounded parse | `oversized_manifest_is_a_named_finding_not_an_oom` |
| 7 | Symlinked directories (incl. `ws → ws/loop` cycle) + symlinked `Cargo.toml` | Never followed, never read; every skip counted in `scan.skipped` | `symlinks_are_skipped_never_followed_never_parsed` |
| 8 | Scan root is a symlink loop (ELOOP) | Named `EngineError::Io` from canonicalize — no hang, no panic | `symlink_loop_as_scan_root_is_a_named_error` |
| 9 | `rust-toolchain.toml` symlinked to `/dev/zero` | **Defect fixed (was an infinite read/hang):** file refused by the regular-file guard, toolchain honestly measured as absent | `toolchain_symlink_to_dev_zero_cannot_hang_the_scan` |
| 10 | Non-regular file (unix socket / FIFO class) named `Cargo.toml` | **Defect fixed (was a blocking open):** named `FER-ENG-ERR` ("not a regular file"); fingerprint walk never opens it, hashes `<not-a-regular-file>`, and its presence still changes the fingerprint | `non_regular_file_wearing_a_measured_name_is_a_named_finding` |
| 11 | Invalid TOML manifest | Scan succeeds; exactly one critical `FER-ENG-ERR` naming the manifest and the parser reason | `invalid_toml_is_a_critical_finding_not_a_crash` |
| 12 | `[package]` missing `name` | Clean parse (not an error): record retained, crate honestly absent from every view, no finding | `missing_package_name_is_a_clean_parse_without_a_crate` |
| 13 | Non-string metadata (`version = 42`) | Named `FER-ENG-ERR` (untagged `MetaValue` mismatch) | `non_string_version_is_a_named_parse_finding` |
| 14 | UTF-8 BOM prefix | Clean parse (TOML spec 1.1 allows it) — pinned against future parser drift | `bom_prefixed_manifest_parses_cleanly` |
| 15 | CRLF line endings | Clean parse | `crlf_line_endings_parse_cleanly` |
| 16 | Empty `Cargo.toml` | Clean parse: no package, no crate, no finding | `empty_manifest_is_a_clean_parse_with_no_crate` |
| 17 | Binary bytes in a `.toml` | Named `FER-ENG-ERR` ("unreadable manifest") — read failure preserved verbatim | `binary_bytes_manifest_is_a_named_unreadable_finding` |
| 18 | 500-crate dependency chain | Scan + graph + Tarjan SCC + change `propagate_closure` all terminate; closure exact at both ends (499 / 0) | `chain_500_scan_graph_scc_and_impact_all_terminate` |
| 19 | Fan-out 200 hub | Terminates; reverse closure = the 200 direct dependents exactly | `fanout_200_impact_closure_terminates_and_is_exact` |
| 20 | Diamond + cycle mix (5 crates, 7 edges) | One 5-member SCC with all internal edges; impact closure terminates through the cycle | `diamond_cycle_mix_scc_is_found_and_impact_terminates` |
| 21 | Crates named like Rust keywords (`match`, `fn`, `type`, `crate`) | Ordinary strings in the model: measured, impact-targetable, serialized verbatim | `keyword_named_crates_are_ordinary_strings` |
| 22 | Read-only workspace directory (mode 0555) | Read surfaces (`doctor`/`graph`) still measure without writing; `store init` → named `Store` error; `product init` → named `Io` error and writes nothing | `read_only_workspace_read_surfaces_measure_and_write_surfaces_name_the_error` |
| 23 | `Cargo.toml` that is a DIRECTORY | Walked as a directory, never parsed as a manifest; root-manifest fallback picks the shallowest manifest deterministically | `cargo_toml_as_directory_is_walked_and_devnull_symlink_is_skipped` |
| 24 | `Cargo.toml` symlinked to `/dev/null` | Skipped by the no-follow policy (never opened), counted in `scan.skipped`, not a parse failure | `cargo_toml_as_directory_is_walked_and_devnull_symlink_is_skipped` |
| 25 | Empty scan root (zero manifests) | Named `NoManifests` error | `empty_scan_root_is_the_named_no_manifests_error` |

**Documented limitations** (honest boundaries of the current engine — not fixed by
this suite):

- **No sandboxed build isolation.** `wanyrix build` executes a real `cargo build`
  inside the workspace: a hostile `build.rs` runs arbitrary code at build time. The
  adversarial fixtures cover only the engine's *analysis* surfaces (scan/doctor/
  graph/health/store/daemon/impact/what-changed), never the build.
- **Engine-owned dotfiles are trusted as engine-written.** `.wanyrix/state.json`,
  `events.jsonl` and `experiments.jsonl` are read/written by `init`/`status`/
  `events`/experiment surfaces without the regular-file guard. A repository that
  pre-plants a symlink/FIFO at those exact paths can still block those surfaces on
  read. Scan-path reads are hardened (rows 9/10 above); dotfile hardening is
  tracked in #114.
- **The 16 MiB measured-file cap is a deliberate bound:** a legitimate repository
  with a larger `Cargo.toml`/`rust-toolchain` file would be reported as an
  unreadable finding rather than analyzed.
- The 5 s bounds asserted in the pathological-graph and huge-manifest fixtures are
  blowup guards (≈100× headroom in debug builds), not performance claims.
