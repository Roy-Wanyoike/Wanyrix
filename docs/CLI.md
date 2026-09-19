# Wanyrix CLI — contract reference

Status: the `wanyrix` binary **exists** — `wanyrix-engine` v0.3.0
([`engine/README.md`](../engine/README.md)) implements `doctor · graph · health ·
store · synth · daemon · telemetry`. Every engine command emits a versioned JSON
envelope (`wanyrix.doctor/v1`, `wanyrix.graph/v1`, `wanyrix.health/v1`,
`wanyrix.daemon/v1`, `wanyrix.telemetry/v1`) behind a `--json` switch, plus
human-readable output by default. The web platform mirrors the same payloads over
HTTP; the in-app **CLI contract** dialog
(`src/components/wanyrix/cli-dialog.tsx`, opened from the top bar's terminal entry)
pins the command set, the flags, and the exit codes shown here.

## Design rules (as surfaced by the dialog)

1. **Every read command has a `--json` switch.** Human output is the default; `--json`
   emits the machine-readable, versioned payload (Gate 18).
2. **Deterministic core, no AI in the path.** Copying a command in the dialog toasts:
   *"deterministic surface, no AI in the path."* The AI layer (`wanyrix explain`
   equivalent in the web UI) is additive and never required.
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
| 1 | `wanyrix doctor [--path <dir>] [--json] [--pretty]` | `wanyrix.doctor/v1` — crate list + measured findings with evidence | Build Doctor view (`GET /api/wanyrix/doctor?ws=…`) |
| 2 | `wanyrix graph [--path <dir>] [--json] [--pretty]` | `wanyrix.graph/v1` — dependency graph from the measured edge list | Engineering Graph (`GET /api/wanyrix/graph?ws=…`) |
| 3 | `wanyrix health [--path <dir>] [--json] [--pretty]` | `wanyrix.health/v1` — KPI summary derived from doctor + graph | Scorecard view (`GET /api/wanyrix/health?ws=…`) |
| 4 | `wanyrix store init|save|list|fsck` | SQLite scan store (WAL journal, layout v1) — persists exactly what `doctor --json` measured | History view / scan-run records |
| 5 | `wanyrix daemon start|call` | `wanyrix.daemon/v1` — one measured scan kept in memory, served over a local Unix socket (no TCP, no network) | Runtime view |
| 6 | `wanyrix telemetry ingest -` | `wanyrix.telemetry/v1` — redacted, aggregated rustc JSON diagnostics (source snippets dropped unconditionally) | Diagnostics view (`GET /api/wanyrix/diagnostics?ws=…`) |
| 7 | `wanyrix synth --crates <n> --out <dir> [--seed <s>]` | deterministic synthetic Rust workspace (same `(seed, count)` → byte-identical tree) | fixture generator used by tests/benchmarks |

Common flags: `--path` (workspace root, default `.`), `--json` / `--pretty`
(pretty has no effect without `--json`), and per-subcommand options documented by
`wanyrix --help` and `wanyrix <command> --help`. `store save -` reads a
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
| Scan-run sync log (durable server log) | `GET`/`POST /api/wanyrix/scan-runs?ws=…` | `wanyrix.scan-runs/v1` — the web client fire-and-forget POSTs each completed run; GET serves the persisted rows verbatim (SQLite/Prisma), never fabricated |
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

- `wanyrix init`, repository discovery, and config-file support — engine-repo scope.
- An `impact`/`report` engine subcommand to absorb the web-only surfaces above is
  intentionally not faked in the binary; the web platform serves them today.
- Anything that would fake engine evidence in this repo is forbidden by the honesty
  gates (`docs/CONTRIBUTING.md`).
