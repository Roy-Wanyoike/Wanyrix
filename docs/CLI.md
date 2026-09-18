# Wanyrix CLI — contract reference

Status: the `wanyrix` CLI **binary is Roadmap** (it lives with the Rust engine —
`docs/audits/issues/AUDIT-I8.md`). What ships **today** is the *contract*: the in-app
**CLI contract** dialog (`src/components/wanyrix/cli-dialog.tsx`, opened from the top
bar's terminal entry) pins the command set, the flags, and the exit codes. Every web
surface maps 1:1 to a CLI command — same payloads, same exit codes, `--json` on
everything — so when the engine binary lands it plugs into the interface documented
below, and everything on this page that describes a future binary is labeled
**Roadmap**.

## Design rules (as surfaced by the dialog)

1. **Every command has a `--json` switch.** Human output is the default; `--json`
   emits the machine-readable payloads defined here (Gate 18).
2. **Deterministic core, no AI in the path.** Copying a command in the dialog toasts:
   *"deterministic surface, no AI in the path."* The AI layer (`wanyrix explain`
   equivalent in the web UI) is additive and never required.
3. **Same payloads as the web.** A CLI JSON payload is byte-for-byte the HTTP payload
   the mirrored route serves (see the mapping table).
4. **No silent modification.** AI never edits code silently; patches stay reviewable
   diffs behind explicit approval (Gates 9/19).

## Commands (8, from the CLI contract dialog)

| # | Command | Maps to (web surface / HTTP) |
| --- | --- | --- |
| 1 | `wanyrix doctor` | Build Doctor view — findings + evidence (`GET /api/wanyrix/doctor?ws=…`, human rendering) |
| 2 | `wanyrix doctor --json` | `GET /api/wanyrix/doctor?ws=…` — the `DoctorReport` JSON |
| 3 | `wanyrix graph --duplicates --json` | Engineering Graph · duplicates panel (`GET /api/wanyrix/graph?ws=…` — `duplicates[]`, plus `resolutions` deep links) |
| 4 | `wanyrix impact add-dep <crate> --json` | Impact Simulator · add a dependency (`GET /api/wanyrix/impact?type=add-dep&target=<crate>&ws=…`) |
| 5 | `wanyrix impact upgrade-dep <crate> --json` | Impact Simulator · upgrade a dependency (`GET /api/wanyrix/impact?type=upgrade-dep&target=<crate>&ws=…`) |
| 6 | `wanyrix impact edit-file <path> --json` | Impact Simulator · edit a source file (`GET /api/wanyrix/impact?type=edit-file&target=<path>&ws=…`) |
| 7 | `wanyrix report --json` | Topbar Report → JSON snapshot (`GET /api/wanyrix/report?format=json&ws=…` → `wanyrix.report/v1`) |
| 8 | `wanyrix experiment start <finding-id>` | Experiments view — scaffold an experiment from a finding (`GET /api/wanyrix/experiments?ws=…` payloads; `EXP-*` records) |

Flags observed in the contract: `--json` (every command), `--duplicates`
(graph subsets the duplicate-version groups), and explicit positional targets
(`<crate>`, `<path>`, `<finding-id>`). On the HTTP side these become query params
(`type`, `target`, `ws`); the web workspace switcher is the moral equivalent of a
`--workspace <id>` flag.

## Exit codes (as designed — Roadmap until the binary exists)

| Code | Meaning | Set when |
| --- | --- | --- |
| `0` | success | command completed; for `doctor`, zero findings |
| `1` | findings present | scan/report ran fine but findings exist (CI gate signal — the mirror of the severity ladder `critical`/`warning`/`info`) |
| `2` | usage error | bad flag, unknown command, unknown target/type — the mirror of the HTTP `400` class |
| `3` | infrastructure failure | engine/store unavailable — the mirror of the HTTP `404`/`5xx` class |

The 2-c persona CI bot derived the same ladder from pure JSON (exit 2 with criticals
present in the fixture) — see `docs/audits/issues/ENG-REGISTRY-tca.md`, WF1.

## Machine-readable payloads (the serialization contract)

CLI `--json` payloads are the same versioned flavors the web serves:

| Flavor | Where the web serves it today |
| --- | --- |
| `wanyrix.report/v1` | `GET /api/wanyrix/report?format=json&ws=…` — full workspace snapshot (summary, doctor, graph, pr, experiments, gates, storage, honestyNotes) |
| `wanyrix.markdown/v1` | `GET /api/wanyrix/report?format=markdown&ws=…` (default) — versioned envelope `{schema, filename, markdown, bytes}` |
| `wanyrix.release-scorecard/v1` | `GET /api/wanyrix/report?flavor=scorecard&ws=…` |
| `wanyrix.scan-history/v1` | `GET /api/wanyrix/report?flavor=scan-history&ws=…` (server-side `runs` honestly empty — runs are per-browser localStorage; the `note` field says so) |

Error contract mirrored by CLI exit codes (`docs/ARCHITECTURE.md` has the full table):

- unknown `ws` → HTTP 404 `{error, knownWorkspaces}` → exit 3 (never silent substitution)
- missing param / unknown `type` / unknown `kind` → HTTP 400 → exit 2
- unknown impact target → HTTP 404 → exit 3
- 405s carry `Allow` → a CLI wrapper can always discover the method

## Web platform as the contract mirror

The web platform is the executable half of the contract today:

- `src/lib/wanyrix/hooks.ts` — every view fetches its command's payload through one
  hook per command, keyed by active workspace (`?ws=`), so UI and CLI consumers read
  identical bytes.
- `src/lib/wanyrix/api.ts` — shared workspace guard + `Allow`-carrying 405 factory used
  by all routes.
- `src/lib/wanyrix/flavors.ts` — server-side builders for the scorecard/scan-history
  flavors, field-for-field identical to the in-app download exporters.
- Human ⇄ JSON parity is enforced in the UI: Build Doctor's Human/`--json` mode toggle
  renders the same finding content two ways.

## What is explicitly NOT here yet (Roadmap)

- The `wanyrix` binary itself, `wanyrix init`, repository discovery, and daemon
  operation — engine-repo scope (AUDIT-I8).
- Anything that would fake engine evidence in this repo is forbidden by the honesty
  gates (`docs/CONTRIBUTING.md`); the dialog documents the contract instead of
  pretending to run it.
