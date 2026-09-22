# Wanyrix Privacy

Local-first means: your data lives in your browser, and nothing moves unless you move it.
This document describes exactly what persists, what leaves the machine, and how to reset.

## What persists locally (browser localStorage)

| Data | Store / key | Contents |
| --- | --- | --- |
| Active workspace | workspace store (zustand persist) | selected workspace id |
| Scan history | scan store (zustand persist) | scan run records (`wanyrix.scan-history/v1` shape) |
| Diff queue | diff store (zustand persist) | reviewable patch proposals you opened |
| Preferences | theme (next-themes) + settings store | light/dark, view preferences |
| AI status | ai-status store | last explain outcome label (grounded/deterministic) |
| Legacy keys | `ferrix.*` | migrated copy-before-delete into `wanyrix.*` keys; status shown in Settings |

No cookies for tracking, no service worker caches of user content, no IndexedDB beyond the
above. All UI state is client-side; clearing site data removes it. There is also a small
**optional** server-side log (local SQLite) — described next.

## Server-side persistence (optional, local SQLite via Prisma)

The UI's source of truth stays per-browser localStorage. In addition, the server keeps a
durable sync target in a **local SQLite database** (Prisma ORM; the file lives on the
machine running the dev server — `DATABASE_URL="file:../db/custom.db"`, i.e.
`db/custom.db` in this checkout, configured via the git-ignored `.env`). Nothing is
replicated, uploaded, or shared: "server" here means your own machine. Two tables exist
(see `prisma/schema.prisma`):

**`ScanRun` — the durable scan-run log** (`POST` / `GET /api/wanyrix/scan-runs`). The
client fire-and-forget syncs each completed scan run; the server persists exactly what
was measured and sent, idempotently (upsert on the client's deterministic run id):

| Field | Contents |
| --- | --- |
| `id` | client-generated run id (`run-<seq>-<startedAt>`) |
| `workspaceId` | which workspace the run measured |
| `startedAt`, `finishedAt`, `durationMs` | client-measured wall-clock timing |
| `findingCount`, `critical`, `warning`, `info` | severity **counts only** — no finding text |
| `findingIds`, `findingIdsTruncated` | findings fingerprint (sorted unique finding ids, capped at 400) so finding-level diffs survive across sessions/browsers |
| `trigger` | what started the run (`manual` · `topbar` · `palette` · `engine-exec`) |
| `syncedAt` | when the server received it |

Why: scan history and finding-level diffs that survive clearing browser storage or
switching browsers. Honesty contract (Gate 21): the server never invents runs,
durations, or figures — every row was measured in a real browser session and POSTed
by it.

**`RegisteredWorkspace` — registered local projects** (`GET` / `POST` /
`DELETE /api/wanyrix/workspaces`). Connecting a local project stores:

| Field | Contents |
| --- | --- |
| `id` | deterministic: `ws-local-<slug>-<fnv1a8(abs path)>` |
| `name` | directory basename |
| `path` | canonical absolute path of the project on this machine |
| `registeredAt`, `lastCheckedAt`, `lastStatus` | registration / last real engine scan time, `ok` \| `failed` |
| `crates`, `edges`, `findings`, `critical`, `warning`, `info` | counts **measured by the real engine** — never invented |
| `toolchain` | last measured toolchain label |

Why: this is the workspace registration bridge. Registration runs the real engine
(doctor + graph) against the path you submit; later engine-backed scans only ever run
paths stored in this table. Input hardening: user input never passes through a shell
(`execFile` + args array), only validated absolute paths are scanned, output buffers
are capped, and every spawn carries a timeout.

**Never stored server-side**: source code, file contents, finding titles or messages,
credentials, cookies, or anything from your browser's localStorage. The scan-run log
holds counts and finding ids only; the workspace registry holds a path and measured
counts.

**Deleting server-side data**: `DELETE /api/wanyrix/workspaces?id=…` removes a
registered project. The scan-run log has no HTTP delete by design (wrong methods →
`405` with `Allow: GET, POST`) — stop the dev server and delete the SQLite file
(`db/custom.db`) to purge it. Because the database is a local file, deleting the file
(or the checkout) deletes the data; there is no cloud copy.

## What the AI explain feature sends

- **Only on user action.** The explain request happens when you click Explain/Ask — never
  in the background, never probed on a timer (the AI status pill reads the last outcome;
  it does not ping the provider).
- **Payload**: the explicit `context` you submit (the evidence fields shown in the dialog)
  + your `question` + a `kind` label. Nothing else from the page, no localStorage content,
  no workspace files.
- **Cap**: contexts over 256 KB are rejected locally by the API with `413` (limit stated
  in the error). Contexts over 48,000 characters are truncated before reaching the model
  provider and the response is flagged `contextTruncated`.
- **Grounding**: facts in the response are re-rendered server-side from your context —
  the model cannot inject or rewrite them. Model text is post-validated and redacted if
  it asserts anything your context does not contain.
- Model output is generated by the configured provider (z-ai SDK). Treat it like any
  third-party LLM call: only submit context you are comfortable sending to the provider.

## What we do NOT do

- **No product telemetry, analytics, or crash reporting endpoints** — network calls from
  this app are the Wanyrix API routes and (only for explain) the model provider. The
  root layout ships no analytics component: `src/app/layout.tsx` documents this
  explicitly (ENG-T3A-1), and no module under `src/` imports an analytics package.
  See [`docs/SECURITY.md`](SECURITY.md) for the zero-telemetry posture.
- **No background sync, no auto-upload** of repositories, scans, or findings — the
  server-side log above only ever receives what the client explicitly POSTs, and it
  stays on your machine.
- **No silent modification** — patch proposals are reviewable diffs; nothing is applied.

## How to reset / delete your data

1. **Settings → data & privacy** for guided pointers, or
2. Clear site data for `http://localhost:3000` in your browser (removes workspaces
   preference, history, diff queue, theme, migrated stores).
3. Restarting the dev server resets simulated in-process state (storage dialog rows show
   simulated telemetry and are labeled as such).
4. Server-side rows (see the SQLite section above): `DELETE /api/wanyrix/workspaces?id=…`
   for a registered project; delete `db/custom.db` (dev server stopped) to purge the
   scan-run log.

## Cloud

Wanyrix Cloud (history sync, team dashboards, hosted AI) is **roadmap — disabled today**.
When it ships, the local deterministic core remains fully
functional without an account, and billing failures can never corrupt local engineering
data (entitlement separation).
