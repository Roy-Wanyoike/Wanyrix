# The 2-minute Wanyrix demo

Everything below is copy-paste-able and was **executed for real before being
documented** (at `main` @ `cda2435`, engine v0.9.0). Outputs are pasted
verbatim — byte counts and `sha256`s are stable for this tree (artifacts are
byte-deterministic, timestamp last); wall-clock numbers and JSON timestamps
are machine-dependent. The dogfood target is the engine's own repository
(`engine/`) — Wanyrix measures real Rust workspaces, starting with itself.

**Prereqs:** Rust toolchain (1.98+, `cargo` on PATH) and [bun](https://bun.sh)
1.3+. No crates.io release exists yet (#118), so you build from source.

```sh
git clone https://github.com/Roy-Wanyoike/wanyrix && cd wanyrix
cd engine && cargo build --offline        # one-time; ~2 min cold, seconds warm
```

Budget: **< 2 minutes on a warm machine** (each engine step below ran in
≤ ~0.3 s). All scratch state goes to `/tmp` and the engine's gitignored
`.wanyrix/` — your checkout stays clean.

---

## Step 1 — `doctor`: measured findings, not vibes (~15 s)

```sh
cargo run --offline --quiet -- doctor --path . --json
```

Real output (excerpted; 95 findings on this tree):

```json
{
  "schema": "wanyrix.doctor/v1",
  "workspace": "wanyrix-engine",
  "crates": [ … ],
  "findings": [
    {
      "id": "FER-ENG-005-ping",
      "section": "Dependencies",
      "severity": "critical",
      "title": "Workspace dependency cycle (ping ↔ pong)",
      "description": "Crates `ping`, `pong` form a closed dependency loop over intra-workspace path dependencies (edge kinds: normal). Cargo rejects cycles that contain a normal or build dependency edge — this workspace does not build until the loop is broken.",
      "evidence": [
        { "label": "cycle", "value": "ping → pong → ping",
          "source": "filesystem — parsed Cargo.toml (measured)" }
      ]
    }
    // … 94 more (1 critical / 93 warnings / 1 info)
  ],
  "summary": { "critical": 1, "warning": 93, "info": 1, "total": 95 }
}
```

**What this proves:** the engine parsed the real Cargo manifests on disk and
backs every finding with evidence — yes, it flags its own fixture crates'
dependency cycle; honesty applies to itself first.

## Step 2 — `graph`: blast radius from one edge list (~10 s)

```sh
cargo run --offline --quiet -- graph --path . --json
```

Real output (excerpted):

```json
{
  "schema": "wanyrix.graph/v1",
  "workspace": "wanyrix-engine",
  "nodes": [
    { "id": "alpha", "band": "lib", "kind": "workspace", "buildTime": 0,
      "buildTimeStatus": "not-measured", "fanIn": 2, "fanOut": 0,
      "downstream": 4, "recompileImpact": ["beta", "delta", "epsilon", "gamma"] }
    // …
  ]
}
```

60 nodes, 106 edges on this tree (`python3 -c "import json;d=json.load(open('/dev/stdin'));print(len(d['nodes']),len(d['edges']))"` if you want the count).

**What this proves:** fan-in/fan-out and recompile closures are derived from
the served edges only — no ghost nodes; the graph math is the same math the
dashboard serves.

## Step 3 — `experiment record`: start the honesty ledger (~10 s)

```sh
cargo run --offline --quiet -- experiment record \
  --name "break-the-cycle" \
  --claim "Removing the ping/pong fixture crates resolves the critical cycle" \
  --finding FER-ENG-005-ping --json
cargo run --offline --quiet -- experiment list --json
```

Real output:

```json
{"schema":"wanyrix.experiment/v1","name":"break-the-cycle","claim":"Removing the ping/pong fixture crates resolves the critical cycle","findingId":"FER-ENG-005-ping","status":"estimated","createdAt":"2026-09-23T02:16:03Z"}
```

```json
{
    "count": 1,
    "experiments": [
        {
            "claim": "Removing the ping/pong fixture crates resolves the critical cycle",
            "createdAt": "2026-09-23T02:16:03Z",
            "findingId": "FER-ENG-005-ping",
            "name": "break-the-cycle",
            "schema": "wanyrix.experiment/v1",
            "status": "estimated"
        }
    ],
    "generatedAt": "2026-09-23T02:16:03Z",
    "schema": "wanyrix.experiments/v1",
    "workspace": "wanyrix-engine"
}
```

**What this proves:** experiments can't self-congratulate — a claim is born
`estimated` and stays there until `experiment measure` runs REAL builds;
`experiment verify` accepts only measured improvements exceeding the noise
margin, and a within-noise delta never upgrades the tier.

## Step 4 — `compare`: the time machine over two stored scans (~20 s)

Scan the workspace twice into a throwaway store — once full, once with the
cyclic fixture excluded — then diff the two stored scans:

```sh
cargo run --offline --quiet -- store init --db /tmp/demo-scans.db
cargo run --offline --quiet -- doctor --path . --json | \
  cargo run --offline --quiet -- store save --db /tmp/demo-scans.db --scan -
cargo run --offline --quiet -- doctor --path . --exclude tests/fixtures/cycle-ws --json | \
  cargo run --offline --quiet -- store save --db /tmp/demo-scans.db --scan -
cargo run --offline --quiet -- compare --db /tmp/demo-scans.db --from 1 --to 2
```

Real output (the two saves print `persisted scan 1` — 95 findings — and
`persisted scan 2` — 91 findings; the diff):

```text
wanyrix compare — wanyrix-engine (wanyrix.compare/v1)
db: /tmp/demo-scans.db
from: scan #1 (measured 2026-09-23T02:16:12Z) — 95 findings (1 critical, 93 warning, 1 info)
to:   scan #2 (measured 2026-09-23T02:16:12Z) — 91 findings (0 critical, 91 warning, 0 info)
toolchain: stable (unspecified (no rust-toolchain.toml))
crates: 0 added, 4 removed, 0 version-changed, 59 unchanged
  - deva 0.1.0
  - devb 0.1.0
  - ping 0.1.0
  - pong 0.1.0
findings: 0 added, 4 resolved, 0 changed
  - [warning] FER-ENG-003-ping — Intra-workspace path dependency without version (crate `ping`)
  - [warning] FER-ENG-003-pong — Intra-workspace path dependency without version (crate `pong`)
  - [critical] FER-ENG-005-ping — Workspace dependency cycle (ping ↔ pong)
  - [info] FER-ENG-006-deva — Dev-only dependency cycle (deva ↔ devb)
severity delta: -1 critical, -2 warning, -1 info (negative = fewer)
coverage: findings recorded · crates recorded · toolchain recorded · edges NOT recorded
  note: dependency edges are not recorded per scan: the store persists wanyrix.doctor/v1 payloads, which carry no edge list (edges are wanyrix.graph/v1 data) — edge deltas are labeled not-recorded, never guessed; a store layout that records edges is a tracked follow-up
```

**What this proves:** the time machine is honest to the byte level — both
sides are read back verbatim from the store (never re-measured), the exact
critical finding you saw in Step 1 is `resolved`, and the envelope loudly
labels what the store did NOT persist (`edges NOT recorded`) instead of
guessing an empty delta. Repeat the command: it is byte-identical
(`generatedAt` is the literal `not-measured`).

## Step 5 — `chain`: engineering memory, one offline query (~10 s)

The chain query joins the store, the experiment ledger and the event log into
a single per-finding evidence chain:

```sh
cargo run --offline --quiet -- chain --db /tmp/demo-scans.db --finding FER-ENG-005-ping --json
```

Real output (excerpted):

```json
{
    "schema": "wanyrix.chain/v1",
    "workspace": "wanyrix-engine",
    "scope": {
        "mode": "finding",
        "findingId": "FER-ENG-005-ping"
    },
    "scans": [
        {
            "scanId": 1,
            "finishedAt": "2026-09-23T02:16:12Z",
            "findingCount": 95,
            "findings": [
                {
                    "findingId": "FER-ENG-005-ping",
                    "severity": "critical",
                    "title": "Workspace dependency cycle (ping ↔ pong)",
                    "evidence": [
                        { "label": "cycle", "source": "filesystem — parsed Cargo.toml (measured)", "value": "ping → pong → ping" },
                        { "label": "members", "source": "measured crate list", "value": "ping, pong" },
                        { "label": "edge kinds", "source": "manifest dependency sections (measured)", "value": "normal" }
                    ],
                    "experiments": [
                        {
                            "schema": "wanyrix.experiment/v1",
                            "name": "break-the-cycle",
                            "claim": "Removing the ping/pong fixture crates resolves the critical cycle",
                            "findingId": "FER-ENG-005-ping",
                            "status": "estimated"
                        }
                    ]
                }
            ]
        }
    ],
    "unlinkedExperiments": [],
    "orphanLinks": [],
    "corruptLedgerLines": [],
    "corruptEventLines": [],
    "storeInconsistencies": [],
    "generatedAt": "not-measured"
}
```

**What this proves:** the whole story of one finding — scan → evidence →
linked experiment → its honest `estimated` status — reconstructs offline from
durable state, and the envelope names anything suspicious (orphans, corrupt
lines, store inconsistencies) instead of dropping it silently.

## Step 6 — `export`: artifacts as code (~15 s)

```sh
cargo run --offline --quiet -- export --path . --json
ls .wanyrix/exports/
```

Real output (excerpted):

```json
{
  "schema": "wanyrix.export/v1",
  "engine": "0.9.0",
  "workspace": "wanyrix-engine",
  "artifacts": [
    { "file": "doctor.json", "schema": "wanyrix.doctor/v1", "bytes": 150769,
      "sha256": "5cd10f985e52578fcc8e447916c5b311e2a5c14abbd131106fad9ecbf782ab3f" },
    { "file": "graph.json",  "schema": "wanyrix.graph/v1",  "bytes": 24409,
      "sha256": "dd1a62ee72e40f4ea2ce074b7be29c95c45f0cb8e4caba4da66c5fe57b8bd5b6" },
    { "file": "health.json", "schema": "wanyrix.health/v1", "bytes": 2750,
      "sha256": "edc3dd01ff6d477f28caca727a1d729fe69baca376eef301802dda7b4e1cd447" }
  ]
}
```

```text
$ ls .wanyrix/exports/
doctor.json  graph.json  health.json  index.json
```

Then run the export **again** and diff the manifests — they are byte-identical
(no wall-clock timestamps, relative paths only; re-running here produced the
same `index.json` sha256 both times). Your CI and your teammate get the same
bytes.

**What this proves:** "artifacts as code" is literal — deterministic exports
with a sha256 index you can audit.

## Step 7 — the web console, same workspace (~30 s)

In a second terminal, from the repo root:

```sh
cd .. && bun install --frozen-lockfile && bun run dev   # console on :3000
```

Open **http://127.0.0.1:3000** — the 19-view dashboard. The exec routes feed
it by spawning the REAL binary; the default target is the engine crate you
just scanned. Verify without a browser:

```sh
curl -s http://127.0.0.1:3000/api/wanyrix/engine/doctor | python3 -m json.tool
```

Real output (excerpted — the same workspace, served to the console; `profile`
reads `release` if you built with `--release`, otherwise the debug binary
your `cargo build` produced):

```json
{
  "schema": "wanyrix.engine-exec/v1",
  "durationMs": 87,
  "binary": { "version": "wanyrix 0.9.0", "profile": "debug" },
  "scanTarget": "engine/",
  "report": {
    "schema": "wanyrix.doctor/v1",
    "workspace": "wanyrix-engine",
    "summary": { "critical": 1, "warning": 93, "info": 1, "total": 95 }
  },
  "note": "Verbatim stdout of the real wanyrix binary executed on this machine (parsed only to validate the envelope). The engine emits wanyrix.doctor/v1 — build-time telemetry is deliberately absent (honesty gates); that data exists only in the web demo layer."
}
```

**What this proves:** the registration/exec bridge runs the REAL engine — the
console shows the same `wanyrix-engine` workspace with the same 95 measured
findings you produced in Step 1, not a separate demo dataset.

---

## Total

Seven steps, one clone, one build — under two minutes warm. You saw measure
(`doctor`, `graph`), an honesty-gated claim (`experiment record`), the time
machine (`compare`), engineering memory (`chain`), portable artifacts
(`export`), and the console serving the same truth. The full CLI contract
(25 surfaces, exit codes `0`/`2`/`141`) is [`docs/CLI.md`](docs/CLI.md); the
product tour is the [`README`](README.md); the honesty rules these steps
demonstrated are enforced by the suites measured in
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).
