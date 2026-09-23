# Wanyrix CLI — contract reference

Status: the `wanyrix` binary **exists** — `wanyrix-engine` v0.9.0
([`engine/README.md`](../engine/README.md)) implements `doctor · graph · health ·
store · synth · daemon · telemetry · build · init · status · analyze · dependencies ·
experiment · events · ai · git · impact · what-changed · compare · export · sync · activate · entitlement · license`. Every engine command emits a versioned JSON
experiment · events · ai · git · impact · what-changed · chain · export · sync · activate · entitlement · license`. Every engine command emits a versioned JSON
envelope (`wanyrix.doctor/v1`, `wanyrix.graph/v1`, `wanyrix.health/v1`,
`wanyrix.daemon/v1`, `wanyrix.telemetry/v1`, `wanyrix.build/v1`, `wanyrix.init/v1`,
`wanyrix.status/v1`, `wanyrix.analyze/v1`, `wanyrix.dependencies/v1`,
`wanyrix.experiment/v1`, `wanyrix.events/v1`, `wanyrix.ai/v1`, `wanyrix.git/v1`,
`wanyrix.impact/v1`, `wanyrix.what-changed/v1`, `wanyrix.compare/v1`, `wanyrix.export/v1`, `wanyrix.sync/v1`,
`wanyrix.impact/v1`, `wanyrix.what-changed/v1`, `wanyrix.chain/v1`, `wanyrix.export/v1`, `wanyrix.sync/v1`,
`wanyrix.entitlement/v1`, `wanyrix.entitlement.token/v1`, `wanyrix.entitlement.cache/v1`,
`wanyrix.license-keygen/v1`) behind a `--json` switch, plus
human-readable output by default. The web platform mirrors the same payloads over
HTTP; the in-app **CLI contract** dialog
(`src/components/wanyrix/cli-dialog.tsx`, opened from the top bar's terminal entry)
pins the command set, the flags, and the exit codes shown here.

## Design rules (as surfaced by the dialog)

1. **Every read command has a `--json` switch.** Human output is the default; `--json`
   emits the machine-readable, versioned payload (Gate 18).
2. **Deterministic core, no AI in the path.** Copying a command in the dialog toasts:
   *"deterministic surface, no AI in the path."* The deterministic layer never calls a
   model. AI is strictly additive and clearly labeled: the web explain dialog grounds
   on served evidence, and the v0.7.0 `wanyrix ai` subcommand talks ONLY to a local
   model server the user pointed at — over a digest of measured evidence, never source
   code, and its output is never a measurement.
3. **Same payloads as the web — with the doctor envelope a documented subset.** An engine
   JSON payload is the versioned envelope the mirrored web surface renders (see the mapping
   table below). The one measured nuance: the web `DoctorReport` carries build-telemetry
   fields engine v1 cannot measure (`buildTime`, `estimatedRange`, `criticalPath`, `phases`,
   and the `summary.developerBuild/ciBuild/diskUsage` block) — the engine deliberately does
   NOT fabricate them; the FINDINGS remain field-for-field conformant and the divergence is
   pinned in `engine/tests/conformance.rs` (documented intentional divergences 1–4).
4. **No silent modification.** AI never edits code silently; patches stay reviewable
   diffs behind explicit approval (Gates 9/19).
5. **Honesty contract.** The engine measures the filesystem and labels what is absent;
   the store persists exactly what `doctor` measured; the daemon serves cached
   *measured* scans; telemetry is redacted by default. Nothing is simulated.

## Engine commands (the real binary surface)

| # | Command | Emits | Mirrors (web surface) |
| --- | --- | --- | --- |
| 1 | `wanyrix doctor [--path <dir>] [--exclude <dir>]… [--json] [--pretty]` | `wanyrix.doctor/v1` — crate list + measured findings with evidence | Build Doctor view (`GET /api/wanyrix/doctor?ws=…`) |
| 2 | `wanyrix graph [--path <dir>] [--exclude <dir>]… [--json] [--pretty]` | `wanyrix.graph/v1` — dependency graph from the measured edge list | Engineering Graph (`GET /api/wanyrix/graph?ws=…`) |
| 3 | `wanyrix health [--path <dir>] [--exclude <dir>]… [--json] [--pretty]` | `wanyrix.health/v1` — KPI summary derived from doctor + graph | Scorecard view (`GET /api/wanyrix/health?ws=…`) |
| 4 | `wanyrix store init|save|list|fsck` | SQLite scan store (WAL journal, layout v1) — persists exactly what `doctor --json` measured. `store list --json` emits the `wanyrix.store-scans/v1` collection envelope (`schema`, `db`, `workspace` — the `--workspace` filter echoed, `null` = unfiltered — `count`, `scans`, `generatedAt` LAST) and `store fsck --json` emits `wanyrix.store-fsck/v1` (`db`, `repair`, `healthy`, `scansChecked`, `findingsRows`, problem triples as named objects (`scanId`/`findingCount`/`actualRows` — never positional arrays), removal counts, `generatedAt` LAST) — design rule 1 (issue #143) | History view / scan-run records |
| 5 | `wanyrix daemon start|call` | `wanyrix.daemon/v1` — one measured scan kept in memory, served over a local Unix socket (no TCP, no network). `daemon start` accepts `--path <dir>` (parity with `daemon call --path`, issue #143): relative request paths resolve against that anchor, absolute ones pass through, the `status` frame echoes `workspaceRoot`, and a nonexistent anchor is refused BEFORE the socket binds | Runtime view |
| 6 | `wanyrix telemetry ingest -` | `wanyrix.telemetry/v1` — redacted, aggregated rustc JSON diagnostics (source snippets dropped unconditionally) | Diagnostics view (`GET /api/wanyrix/diagnostics?ws=…`) |
| 7 | `wanyrix synth --crates <n> --out <dir> [--seed <s>]` | deterministic synthetic Rust workspace (same `(seed, count)` → byte-identical tree) | fixture generator used by tests/benchmarks |
| 8 | `wanyrix init [--path <dir>] [--db <file>] [--json] [--pretty]` | `wanyrix.init/v1` — measured workspace identity written to `.wanyrix/state.json`; idempotent (`created: false` echoes, never resets) | onboarding step for the CLI journey |
| 9 | `wanyrix status [--path <dir>] [--db <file>] [--socket <sock>] [--json] [--pretty]` | `wanyrix.status/v1` — fresh measured scan + init baseline drift + newest stored scan + daemon liveness probe | dashboard header status pill |
| 10 | `wanyrix analyze [--path <dir>] [--exclude <dir>]… [--json] [--pretty]` | `wanyrix.analyze/v1` — doctor + graph + health envelopes embedded verbatim under one schema (zero re-shaping drift) | one call serving the whole dashboard |
| 11 | `wanyrix dependencies [--path <dir>] [--exclude <dir>]… [--json] [--pretty]` | `wanyrix.dependencies/v1` — per-crate direct deps/dependents, fan-in/out, duplicates, path-dep resolution tallies, measured cycles | Dependencies view (`GET /api/wanyrix/graph?ws=…`) |
| 12 | `wanyrix experiment record|measure|verify|list` | `wanyrix.experiment/v1` ledger (`.wanyrix/experiments.jsonl`) — estimated → measured (2 REAL builds) → verified (measured improvement ONLY). The per-record subcommands (`record`/`measure`/`verify`) emit the SINGULAR `wanyrix.experiment/v1`; `experiment list --json` emits the PLURAL `wanyrix.experiments/v1` collection envelope (`schema`, `workspace`, `count`, `experiments`, `generatedAt`). `verify` takes `--min-margin-pct <pct>` (default 10, `0`–`100`): the candidate must be faster by MORE than that percentage of the measured baseline wall clock to upgrade to `verified`; a delta at or below the margin is the explicit `within-noise` outcome (`verifyOutcome` field + `measuredDeltaMs`/`minMarginMs`/`note`) — exit-level success, but the tier stays `measured`, the ledger is NOT rewritten and NO event fires: build-timing noise never upgrades evidence (issue #143) | Experiments view (honesty gates 19/21) |
| 13 | `wanyrix events [--path <dir>] [--json] [--pretty]` | `wanyrix.events/v1` — the durable event log (`.wanyrix/events.jsonl`): one append-only `wanyrix.event/v1` mirror of every real ledger transition; corrupt lines are skipped and named, never a silent drop | event receipt trail (issue #63 first slice) |
| 14 | `wanyrix ai [--path <dir>] -q "<question>" [--endpoint <host:port>] [--model <name>] [--timeout-secs <n>] [--json] [--pretty]` | `wanyrix.ai/v1` — a LOCAL model (Ollama-class, default `127.0.0.1:11434`) answering over the measured evidence digest ONLY (never source code); named errors when no local server is reachable; AI output is labeled inference, never a measurement. `--endpoint`/`--model` fall back to `$WANYRIX_AI_ENDPOINT` / `$WANYRIX_AI_MODEL`. The client speaks PLAIN HTTP only: an `https://` endpoint is REFUSED up front with a named error (exit 2, nothing dialed) instead of being silently downgraded to plain TCP — TLS is not implemented, and local model servers do not need it (issue #89) | local AI surface (commercial queue #66 item 8) |
| 15 | `wanyrix git [--path <dir>] [--exclude <dir>]… [--json] [--pretty]` | `wanyrix.git/v1` — measured repository facts: branch, HEAD, dirty state, changed files (porcelain v1, renames contribute both paths, cap 500 with exact counts), changed files mapped onto scanned crate roots, commit count, 10 newest commits. Redacted by design: paths and subjects only — never diffs, contents, or author identities (issue #67) | Git facts panel (`GET /api/wanyrix/git?ws=…`) |
| 16 | `wanyrix impact --crate <name> [--path <dir>] [--exclude <dir>]… [--json] [--pretty]` | `wanyrix.impact/v1` — reverse-dependency blast radius from the measured edge list: direct dependents by kind, transitive closure over normal+build edges only (dev edges never propagate — documented rule), blast radius in per-mille (integer math); unknown crates are a NAMED refusal (issue #68) | Impact panel (`GET /api/wanyrix/impact?ws=…&crate=…`) |
| 17 | `wanyrix what-changed [--path <dir>] [--exclude <dir>]… --db <store> [--json] [--pretty]` | `wanyrix.what-changed/v1` — the fresh measured scan diffed against the NEWEST stored scan for the workspace: added/resolved/changed findings (duplicate-safe pairing), measured severity deltas; no baseline yet is a valid envelope with a named remediation note (issue #68) | What-changed panel (`GET /api/wanyrix/what-changed?ws=…`) |
| 18 | `wanyrix export [--path <dir>] [--out <dir>] [--exclude <dir>]… [--json] [--pretty]` | `wanyrix.export/v1` — artifacts-as-code (issue #91): one measured pass (the `analyze` pipeline, zero re-shaping) written VERBATIM as `doctor.json` / `graph.json` / `health.json` under `<out>` (default `<path>/.wanyrix/exports`) plus an `index.json` manifest binding each artifact to its exact bytes (file name, `wanyrix.*` schema id, byte count, sha256) with the engine version and the `--exclude` echo. NO wall-clock timestamps (`generatedAt` carries the literal `not-measured`) and relative paths only, so repeat exports of unchanged input are byte-identical and team-diffable in PRs; an `<out>` that exists as a FILE, an unwritable target and absolute `--path`/`--out` are NAMED refusals. Gating: FREE per the tier matrix (docs/COMMERCIAL.md) — local artifacts-as-code is never gated; the paid capability is export SHARING (`sync`), not local writing | Exports view (`POST /api/wanyrix/export`) |
| 19 | `wanyrix sync push --remote <path\|url> [--branch <branch>] [--path <dir>] [--json] [--pretty]` | `wanyrix.sync/v1` (push flavor) — serverless team sync (issue #92): a git branch IS the shared store. ONE measured pass (the same pipeline as `export`, zero re-shaping) is committed to the remote's REGISTRY BRANCH (default `wanyrix-registry`, orphan) as EXACTLY ONE commit with a deterministic message (`wanyrix-sync push <workspace-id> <sha256-min>..<sha256-max>` — no wall-clock in message or artifacts); the subtree reuses the `wanyrix.export/v1` artifact contract verbatim (`<workspace-id>/doctor.json\|graph.json\|health.json\|index.json`, sha256-bound); a byte-identical re-push is a measured no-op (`committed: false` + `noopReason`, ZERO new commits); missing remote, non-git remote and refused pushes are NAMED refusals (`sync remote unavailable`, git stderr verbatim); relative `--path` only; local-path remotes are the supported test surface. Gating (AUD-1): **TEAM** — the dispatch runs the entitlement gate for `sync.push` BEFORE any measurement or transport; a missing/deleted cache or a plan below `team` is a named `subscription required` refusal (exit 2, stdout empty, remediation names `wanyrix activate` + docs/COMMERCIAL.md); an expired token inside the 30-day revalidation grace still pushes with a visible grace note on stderr; `WANYRIX_ALLOW_UNLICENSED=1` is the documented CI/dev escape hatch (default strict, docs/COMMERCIAL.md) | none yet — serverless git transport (issue #92); a hosted bridge is the documented next rung (`docs/CLOUD_DESIGN.md` — design only) |
| 20 | `wanyrix sync pull --remote <path\|url> [--branch <branch>] [--path <dir>] [--json] [--pretty]` | `wanyrix.sync/v1` (pull flavor) — fetches the registry branch and merges every workspace subtree into the local mirror (`<path>/.wanyrix/sync/registry` — the engine's own state dir, invisible to measurement). Merge key: (workspace id, finding id) + content hash — peer-only findings are ADOPTED, identical content kept, differing content a NAMED `SYNC-CONFLICT-n` finding (local bytes kept, the peer version stays in the registry; never a silent overwrite); evidence tiers NEVER upgrade (a peer `verified` claim imports as `peer-reported-verified` until locally re-verified, listed in the envelope's relabels); registry content violating its own `index.json` sha256 binding is a NAMED refusal (`sync conflict`); pulling before any push names the missing branch with the remediation (`sync registry branch unavailable`); non-workspace registry entries are named (`foreignEntries`), never silently ignored. Gating (AUD-1): **TEAM** — same dispatch gate as push (surface `sync.pull`; the single mapping in docs/COMMERCIAL.md gates BOTH directions — a registry a licenseless machine could read would leak exactly the data the gate protects), same refusal shape, same grace and escape-hatch semantics | none yet — serverless git transport (issue #92); a hosted bridge is the documented next rung (`docs/CLOUD_DESIGN.md` — design only) |
| 21 | `wanyrix activate --key <token-file\|literal> [--json] [--pretty]` | `wanyrix.entitlement/v1` — offline activation (issue #94 E2): verifies the ed25519-signed entitlement token (`wanyrix.entitlement.token/v1`) OFFLINE against the embedded release key. Until release signing the embedded key is the dev `PENDING_RELEASE_KEY` placeholder, so a stock build fails closed on EVERY activation with a NAMED, actionable refusal (exit 2) that names the `WANYRIX_ACTIVATION_PUBKEY` override and docs/COMMERCIAL.md — never a raw crypto/hex error (issue #142); the override serves on-prem entitlement servers, tests, and the documented sandbox journey. Caches the token verbatim + a receipt (`wanyrix.entitlement.cache/v1`) at `.wanyrix/entitlement.json`. ZERO network I/O — pinned by a source-level scan test. Tampered tokens, wrong schema/version and expired-beyond-grace tokens are NAMED refusals and are NEVER cached | Plans view → issued-token activation hint |
| 22 | `wanyrix entitlement [--json] [--pretty]` | `wanyrix.entitlement/v1` — the cached entitlement read honestly: status (`active` / `grace` / `not-activated` / `expired`), plan, team, seats (measured on THIS machine — offline verification cannot count others, the `seatsNote` says so), issued/expiry day (UTC day counts), days-until-revalidation, the 30-day revalidation grace window, and the tier-gated surface registry. No license is an honest `not-activated` envelope (the free tier), NEVER an error; a cache tampered after activation is a named signature refusal on every read | Plans view (license status) |
| 23 | `wanyrix license keygen --out <dir>` · `wanyrix license issue --plan team --team <id> --days <n> [--seats <n>] --key <hex-file\|literal> [--out <file>] [--json]` | `wanyrix.license-keygen/v1` · `wanyrix.entitlement.token/v1` — maintainer tooling (issue #94 E2): keygen writes a 0600 private key + public half (entropy from /dev/urandom via std::fs — no `rand` dep; existing keys are NEVER overwritten); issue mints an ed25519-signed token (plan `team\|enterprise` — `free` is NEVER issued because the free tier needs no license; days 1..=36500; seats 1..=100000; nonce = 16 urandom bytes). Private keys are never committed | sandbox license issuer (`POST /api/wanyrix/license/issue`, web-only) |
| 24 | `wanyrix compare --db <store> --from <id> --to <id> [--json] [--pretty]` | `wanyrix.compare/v1` — the time-machine diff of two STORED scans (issue #115): findings added/resolved/changed (duplicate-safe pairing), crate added/removed/version-changed deltas and measured severity deltas, both sides read back VERBATIM from the store — never re-measured, never re-shaped. Clock-free and byte-stable: `generatedAt` carries the literal `not-measured`, so repeated invocations are byte-identical; unknown scan ids, cross-workspace pairs and corrupt entries (findings rows disagreeing with the committed count) are NAMED refusals (exit 2); identical scans are a valid zero-delta envelope. Edge deltas are honestly labeled not-recorded (the store persists `wanyrix.doctor/v1` payloads, which carry no edge list — never guessed into an empty delta); scans saved before inventory persistence label `cratesRecorded`/`toolchainRecorded` `false` | none yet — the web History view compares run pairs per-browser; wiring `wanyrix.compare/v1` server-side is a tracked backlog item |
| 25 | `wanyrix chain --db <store> [--path <dir>] [--finding <id>\|--scan <id>] [--json] [--pretty]` | `wanyrix.chain/v1` — engineering-memory chain query (issue #100): one deterministic, OFFLINE, read-only join of the scan store (`--db`), the experiment ledger and the event log under `--path` into the per-finding evidence chain — scan → finding(s) → experiment(s) → measurement → verification verdict. Evidence labels (`estimated`/`measured`/`verified`) are echoed VERBATIM — never upgraded or downgraded; links are stored (`experiment record --finding <id>`), never guessed; `--finding`/`--scan` scope the chain (mutually exclusive; unknown ids or a scope owned by a different workspace are NAMED exit-2 refusals); orphaned experiment→finding links, corrupt ledger/event lines and inconsistent store rows are NAMED in the envelope, never a silent drop; NO wall-clock (`generatedAt` = `not-measured`) — repeat queries over unchanged inputs are byte-identical | none yet — web wiring is the documented follow-up (issue #100) |

Common flags: `--path` (workspace root, default `.`), `--json` / `--pretty`
(pretty has no effect without `--json`), and per-subcommand options documented by
`wanyrix --help` and `wanyrix <command> --help`.

`--exclude <dir>` (repeatable, scan surfaces #1–3, #10, #11, #15–18): prunes a
directory subtree — relative to `--path`, forward-slash form — from the walk.
The normalized, deduped, sorted exclusion list is **echoed in the envelope**
(`scan.excludes` on the doctor envelope; `meta.excludes` on graph; a top-level
`excludes` where the envelope has no provenance block — and `excludes` on the
export manifest) and the pruned subtree is
counted in the skipped entries — never a silent drop. Absolute paths, `..`, `.`
and empty values are rejected with a named `invalid --exclude value` error (exit
2). Without the flag every envelope is byte-identical to its pre-#76 contract.
One deliberate exception (issue #91): the engine's OWN `.wanyrix` state
directory is invisible to measurement — never walked, never counted — so the
tool's own artifacts (state.json, store.db, exports) can never perturb a
re-measurement of the same tree.
Example: `wanyrix doctor --path engine --exclude tests/fixtures` reports 0
fixture findings while the engine's own crates stay measured.

`store save [<scan>] --db <db>` and
`telemetry ingest [<input>]` accept the source
positionally: `store save -` reads a
`wanyrix doctor --json` payload from stdin and `telemetry ingest -` reads a
`cargo build --message-format=json` stream from stdin. The equivalent long
forms `--scan <path|->` and `--input <path|->` are accepted too; giving both
the positional value and the flag is a named refusal (exit 2), never a silent
preference. `daemon call` takes
`status | doctor | graph | health | shutdown` as the request kind.

## Web-only surfaces (platform features, no engine subcommand)

These surfaces are served by the Next.js API routes directly. They are labeled
**web-only** rather than pretending an engine subcommand exists:

| Surface | Web route | Payload |
| --- | --- | --- |
| Impact Simulator (add-dep / upgrade-dep / edit-file what-ifs) | `GET /api/wanyrix/impact?type=…&target=…&ws=…` | web-computed projection of the measured graph |
| Topbar Report (Markdown / JSON snapshot) | `GET /api/wanyrix/report?format=json\|markdown&ws=…` | `wanyrix.report/v1` · `wanyrix.markdown/v1` |
| Release scorecard download | `GET /api/wanyrix/report?flavor=scorecard&ws=…` | `wanyrix.release-scorecard/v1` |
| Scan history export | `GET /api/wanyrix/report?flavor=scan-history&ws=…` | `wanyrix.scan-history/v1` (server-side `runs` honestly empty — runs are per-browser localStorage; the `note` field says so) |
| Scan-run sync log (durable server log) | `GET`/`POST /api/wanyrix/scan-runs?ws=…` | `wanyrix.scan-runs/v1` — the web client fire-and-forget POSTs each completed run (optionally with its findings fingerprint `findingIds` + `findingIdsTruncated`, validated: ≤96 chars/id, ≤400 entries); GET serves the persisted rows verbatim (SQLite/Prisma), never fabricated |
| Real engine execution (Build Doctor view) | `GET /api/wanyrix/engine/doctor` | `wanyrix.engine-exec/v1` — spawns the actual `wanyrix` binary built from `engine/` and returns its verbatim `wanyrix.doctor/v1` stdout (scan target: the engine crate itself, or a registered local project via `?workspace=<id>`); 503 when the binary is not built on the host |
| Workspace registration bridge (Connect a project) | `GET`/`POST`/`DELETE /api/wanyrix/workspaces` | GET serves the demo registry + `registered` rows; POST validates the absolute path, runs the REAL engine (doctor + graph) against it and upserts the measured counts (Prisma `RegisteredWorkspace`); DELETE unregisters — failures register nothing |
| Experiments board | `GET /api/wanyrix/experiments?ws=…` | `EXP-*` records |
| Sandbox license issuer (Plans view) | `POST /api/wanyrix/license/issue` | `wanyrix.license-issue/v1` — wraps the REAL `wanyrix license issue` binary and returns the signed `wanyrix.entitlement.token/v1` token VERBATIM + the honesty label (`estimated`: sandbox-local issuance, no payment method, never a simulated purchase). `plan ∈ {team, trial}` (trial = exactly 14 days, team = 365); `free` is never issued and `enterprise` belongs to the on-prem server (roadmap #66). Honest 503 when `WANYRIX_SIGNING_KEY` (dev signing key file) is not configured — the issuer never simulates a license; 405/400/502/504 follow the family contract |

## Exit codes (as implemented by the binary)

| Code | Meaning | Set when |
| --- | --- | --- |
| `0` | success | command completed — for `doctor`, findings do **not** fail the exit code; CI consumers parse the JSON |
| `2` | error | bad usage/flags, unreadable workspace, store/IO failure, a named refusal (`export` absolute paths, `ai` https endpoint, `sync` missing/non-git remote, missing registry branch, tampered registry content, absolute `--path`, `subscription required` for the TEAM-gated `sync push`/`sync pull` without a qualifying activated license — docs/COMMERCIAL.md tier matrix; `export` and all core surfaces are never gated), or `daemon call` receiving an `ok:false` frame |
| `141` | broken pipe (clean stop, the engine's own chosen code) | stdout was closed before the payload was fully written — e.g. `wanyrix doctor --json \| head -c 10` on a payload larger than the pipe buffer. `main.rs` maps the EPIPE write failure to the Unix `128 + SIGPIPE(13)` convention and stops cleanly: no panic, no backtrace note on stderr (issue #143; replaces the Rust runtime's raw `101` panic path pipeline wrappers used to observe) |

The mapped ladder is `0`/`2`/`141`: `main.rs` maps any `EngineError` to `2` with a
`wanyrix: error: …` line on stderr, success to `0`, and a closed stdout (EPIPE) to
the clean `141` stop. There is deliberately no
"findings present" exit code — presence of findings is data, not failure, and the
severity ladder lives inside the payload (`critical` / `warning` / `info`).

## CI contract (the neutral referee, issue #92)

`.github/workflows/wanyrix.yml` is the L2 referee: on every PR (plus pushes to
`main` and `workflow_dispatch`) it runs the engine gates — `cargo fmt --all
-- --check`, `cargo build --locked`, `cargo clippy --locked --all-targets -- -D
warnings`, `cargo test --locked --workspace` — and then measures the PR with
the engine's own surfaces: `wanyrix analyze --json` plus
`wanyrix impact --crate wanyrix-engine` (the primary crate, declared once via
the `WANYRIX_PRIMARY_CRATE` env). The verbatim envelopes are published as the
job summary (a measured-counts table) and the `wanyrix-referee-envelopes`
artifact. `scripts/wanyrix-referee.sh` is the exact script the step runs, so
the same bytes are reproducible locally:

```bash
cd engine && cargo build --locked && cd ..
bash scripts/wanyrix-referee.sh   # GITHUB_STEP_SUMMARY unset → the summary prints to stdout
```

The envelope schemas documented above are the machine contract the referee
publishes — nobody shares a database; CI output is the shared truth.

**Honesty label (deliberate, keep current):** GitHub Actions is billing-locked
on this repository — the referee workflow has NEVER run on hosted Actions
runners and is validated LOCALLY ONLY: YAML parse (`bunx js-yaml`), `bash -n`
on the step script, and a full local dry-run of `scripts/wanyrix-referee.sh`
against a locally built binary (the artifact upload is the only
runner-specific step). The label lives in the workflow header and stays there
until the first hosted run.

## Web error contract (HTTP side)

- unknown `ws` → HTTP 404 `{error, knownWorkspaces}` — never a silent substitution
  of the default workspace
- missing param / unknown `type` / unknown `kind` → HTTP 400
- 405s carry an `Allow` header so any CLI wrapper can discover the method

## Web platform as the contract mirror

- `src/lib/wanyrix/hooks.ts` — every view fetches its payload through one hook per
  surface, keyed by active workspace (`?ws=`), so UI consumers read the same shape
  the engine emits.
- `src/lib/wanyrix/api.ts` — shared workspace guard + `Allow`-carrying 405 factory
  used by all routes.
- `src/lib/wanyrix/flavors.ts` — server-side builders for the scorecard/scan-history
  flavors, field-for-field identical to the in-app download exporters.
- Human ⇄ JSON parity is enforced in the UI: Build Doctor's Human/`--json` mode toggle
  renders the same finding content two ways.

## Roadmap

- ~~`wanyrix init`, repository discovery~~ — shipped in v0.5.0 (`init`, `status`, `analyze`, `dependencies`, `experiment` ledger + `verify` gate).
- ~~durable event log~~ — shipped in v0.6.0 (`events`, `wanyrix.event/v1`); the out-of-process plugin contract follows [`docs/PLUGIN_AND_EVENTS.md`](PLUGIN_AND_EVENTS.md)'s decision points.
- ~~local AI~~ — shipped in v0.7.0 (`ai`, `wanyrix.ai/v1`): local-model (Ollama-class) grounding over the measured evidence digest only; named refusals when no local server is reachable.
- ~~offline entitlement verification~~ — shipped in v0.9.0 (issue #94: `activate`, `entitlement`, `license keygen|issue`; offline ed25519 tokens, 30-day revalidation grace, premium-surface gate with core surfaces never gated — see [`docs/COMMERCIAL.md`](COMMERCIAL.md)).
- An `impact`/`report` engine subcommand to absorb the web-only surfaces above is
  intentionally not faked in the binary; the web platform serves them today.
- Anything that would fake engine evidence in this repo is forbidden by the honesty
  gates (`docs/CONTRIBUTING.md`).
