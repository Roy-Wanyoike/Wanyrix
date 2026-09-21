# Wanyrix CLI — contract reference

Status: the `wanyrix` binary **exists** — `wanyrix-engine` v0.9.0
([`engine/README.md`](../engine/README.md)) implements `doctor · graph · health ·
store · synth · daemon · telemetry · build · init · status · analyze · dependencies ·
experiment · events · ai · git · impact · what-changed`. Every engine command emits a versioned JSON
envelope (`wanyrix.doctor/v1`, `wanyrix.graph/v1`, `wanyrix.health/v1`,
`wanyrix.daemon/v1`, `wanyrix.telemetry/v1`, `wanyrix.build/v1`, `wanyrix.init/v1`,
`wanyrix.status/v1`, `wanyrix.analyze/v1`, `wanyrix.dependencies/v1`,
`wanyrix.experiment/v1`, `wanyrix.events/v1`, `wanyrix.ai/v1`, `wanyrix.git/v1`,
`wanyrix.impact/v1`, `wanyrix.what-changed/v1`) behind a `--json` switch, plus
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
3. **Same payloads as the web.** An engine JSON payload is the versioned envelope the
   mirrored web surface renders (see the mapping table below).
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
| 4 | `wanyrix store init|save|list|fsck` | SQLite scan store (WAL journal, layout v1) — persists exactly what `doctor --json` measured | History view / scan-run records |
| 5 | `wanyrix daemon start|call` | `wanyrix.daemon/v1` — one measured scan kept in memory, served over a local Unix socket (no TCP, no network) | Runtime view |
| 6 | `wanyrix telemetry ingest -` | `wanyrix.telemetry/v1` — redacted, aggregated rustc JSON diagnostics (source snippets dropped unconditionally) | Diagnostics view (`GET /api/wanyrix/diagnostics?ws=…`) |
| 7 | `wanyrix synth --crates <n> --out <dir> [--seed <s>]` | deterministic synthetic Rust workspace (same `(seed, count)` → byte-identical tree) | fixture generator used by tests/benchmarks |
| 8 | `wanyrix init [--path <dir>] [--db <file>] [--json]` | `wanyrix.init/v1` — measured workspace identity written to `.wanyrix/state.json`; idempotent (`created: false` echoes, never resets) | onboarding step for the CLI journey |
| 9 | `wanyrix status [--path <dir>] [--db <file>] [--socket <sock>] [--json]` | `wanyrix.status/v1` — fresh measured scan + init baseline drift + newest stored scan + daemon liveness probe | dashboard header status pill |
| 10 | `wanyrix analyze [--path <dir>] [--exclude <dir>]… [--json]` | `wanyrix.analyze/v1` — doctor + graph + health envelopes embedded verbatim under one schema (zero re-shaping drift) | one call serving the whole dashboard |
| 11 | `wanyrix dependencies [--path <dir>] [--exclude <dir>]… [--json]` | `wanyrix.dependencies/v1` — per-crate direct deps/dependents, fan-in/out, duplicates, path-dep resolution tallies, measured cycles | Dependencies view (`GET /api/wanyrix/graph?ws=…`) |
| 12 | `wanyrix experiment record|measure|verify|list` | `wanyrix.experiment/v1` ledger (`.wanyrix/experiments.jsonl`) — estimated → measured (2 REAL builds) → verified (measured improvement ONLY) | Experiments view (honesty gates 19/21) |
| 13 | `wanyrix events [--path <dir>] [--json]` | `wanyrix.events/v1` — the durable event log (`.wanyrix/events.jsonl`): one append-only `wanyrix.event/v1` mirror of every real ledger transition; corrupt lines are skipped and named, never a silent drop | event receipt trail (issue #63 first slice) |
| 14 | `wanyrix ai [--path <dir>] -q "<question>" [--endpoint <host:port>] [--model <name>] [--timeout-secs <n>] [--json]` | `wanyrix.ai/v1` — a LOCAL model (Ollama-class, default `127.0.0.1:11434`) answering over the measured evidence digest ONLY (never source code); named errors when no local server is reachable; AI output is labeled inference, never a measurement | local AI surface (commercial queue #66 item 8) |
| 15 | `wanyrix git [--path <dir>] [--exclude <dir>]… [--json]` | `wanyrix.git/v1` — measured repository facts: branch, HEAD, dirty state, changed files (porcelain v1, renames contribute both paths, cap 500 with exact counts), changed files mapped onto scanned crate roots, commit count, 10 newest commits. Redacted by design: paths and subjects only — never diffs, contents, or author identities (issue #67) | Git facts panel (`GET /api/wanyrix/git?ws=…`) |
| 16 | `wanyrix impact --crate <name> [--path <dir>] [--exclude <dir>]… [--json]` | `wanyrix.impact/v1` — reverse-dependency blast radius from the measured edge list: direct dependents by kind, transitive closure over normal+build edges only (dev edges never propagate — documented rule), blast radius in per-mille (integer math); unknown crates are a NAMED refusal (issue #68) | Impact panel (`GET /api/wanyrix/impact?ws=…&crate=…`) |
| 17 | `wanyrix what-changed [--path <dir>] [--exclude <dir>]… --db <store> [--json]` | `wanyrix.what-changed/v1` — the fresh measured scan diffed against the NEWEST stored scan for the workspace: added/resolved/changed findings (duplicate-safe pairing), measured severity deltas; no baseline yet is a valid envelope with a named remediation note (issue #68) | What-changed panel (`GET /api/wanyrix/what-changed?ws=…`) |

Common flags: `--path` (workspace root, default `.`), `--json` / `--pretty`
(pretty has no effect without `--json`), and per-subcommand options documented by
`wanyrix --help` and `wanyrix <command> --help`.

`--exclude <dir>` (repeatable, scan surfaces #1–3, #10, #11, #15–17): prunes a
directory subtree — relative to `--path`, forward-slash form — from the walk.
The normalized, deduped, sorted exclusion list is **echoed in the envelope**
(`scan.excludes` on the doctor envelope; `meta.excludes` on graph; a top-level
`excludes` where the envelope has no provenance block) and the pruned subtree is
counted in the skipped entries — never a silent drop. Absolute paths, `..`, `.`
and empty values are rejected with a named `invalid --exclude value` error (exit
2). Without the flag every envelope is byte-identical to its pre-#76 contract.
Example: `wanyrix doctor --path engine --exclude tests/fixtures` reports 0
fixture findings while the engine's own crates stay measured.

`store save -` reads a
`wanyrix doctor --json` payload from stdin; `telemetry ingest -` reads a
`cargo build --message-format=json` stream from stdin; `daemon call` takes
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

## Exit codes (as implemented by the binary)

| Code | Meaning | Set when |
| --- | --- | --- |
| `0` | success | command completed — for `doctor`, findings do **not** fail the exit code; CI consumers parse the JSON |
| `2` | error | bad usage/flags, unreadable workspace, store/IO failure, or `daemon call` receiving an `ok:false` frame |

That is the entire ladder: `main.rs` maps any `EngineError` to `2` with a
`wanyrix: error: …` line on stderr, and success to `0`. There is deliberately no
"findings present" exit code — presence of findings is data, not failure, and the
severity ladder lives inside the payload (`critical` / `warning` / `info`).

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
- An `impact`/`report` engine subcommand to absorb the web-only surfaces above is
  intentionally not faked in the binary; the web platform serves them today.
- Anything that would fake engine evidence in this repo is forbidden by the honesty
  gates (`docs/CONTRIBUTING.md`).
