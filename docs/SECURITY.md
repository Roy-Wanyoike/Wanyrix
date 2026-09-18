# Wanyrix Web Platform — Security Posture

Scope: this repository (the Next.js web platform). Status: **local-first demonstrator**
— the shipped threat surface is deliberately minimal, and this document states what is
actually enforced in code today vs. what is **Roadmap**. See also
[`docs/PRIVACY.md`](PRIVACY.md) (data flows) and the engine boundary section of [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
(engine scope).

## 1. Authentication & authorization

- **No auth surface exists.** There are no accounts, sessions, cookies, or login
  routes; `next-auth` is unused scaffold. Every API route is a read-only, unauthenticated
  local surface (`/api/wanyrix/*`) serving fixture-derived data.
- Consequence: nothing in this app authorizes anything. Organization/tier data is
  explicitly badged fixture (AUDIT-I3 acceptance: *"must not expose or mutate anything
  beyond fixtures until real auth exists"*). Cloud/auth features are **Roadmap**
  (`docs/COMMERCIAL.md`).
- No state-changing HTTP surface exists: `POST/PUT/DELETE/PATCH` on GET-only routes
  return `405` (with `Allow`); the only POST route (`/explain`) is a pure reasoning
  endpoint that writes nothing.

## 2. Secrets

- **No secrets in the tree.** The only environment file (`.env`) is git-ignored
  (`git check-ignore .env` → ignored; `git ls-files` contains no `.env`) and holds a
  local SQLite path (`DATABASE_URL=file:…`), not a credential.
- The AI provider credentials are resolved server-side by the `z-ai-web-dev-sdk` at
  runtime — they are never embedded in source or shipped to the browser.
- Checked by: `git ls-files | grep -c '^\.env'` = 0 (untracked) + review of tracked
  files; a dedicated secret-scanning CI job is **Roadmap**.

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
- **No telemetry/analytics endpoints ship in the product code.** One disclosed scaffold
  caveat: `@vercel/analytics` is wired in `src/app/layout.tsx` — inert on localhost,
  active only when deployed on Vercel; removal recommended and tracked in
  the zero-telemetry policy section of [`docs/PRIVACY.md`](PRIVACY.md).
- Prisma is present as scaffold but unused by product flows (no database writes).
- Automated `bun audit`/Renovate/Dependabot pipelines: **Roadmap** (no CI
  infrastructure exists in this sandbox; see AUDIT-I5).

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

## 7. Local data at rest

- All persisted state is browser localStorage (workspace preference, scan history, diff
  queue, theme, AI status label) behind the legacy-key → new-key storage migration
  layer (protocol documented in `docs/PRIVACY.md`, `docs/ARCHITECTURE.md`, and
  Settings' live migration-status panel). Clearing site data removes everything; reset
  instructions in `docs/PRIVACY.md`.

## 8. Roadmap (not implemented — do not assume otherwise)

- **THREAT_MODEL.md** and a formal trust-boundary review (pending-task §35 lists it; the
  posture above is the current informal equivalent).
- SBOM generation, SAST/DAST in CI, dependency-audit gates, secret-scanning CI.
- Signed releases and provenance attestation (meaningful only once releases are cut —
  AUDIT-I5).
- Authentication, multi-tenancy, plugin sandboxing (Phases 13–14 —
  `docs/COMMERCIAL.md`).

## Reporting

This repository accepts no external bug reports yet (no public issue tracker until the
GitHub rename/push completes — AUDIT-I5). Internal findings follow the audit process in
[`docs/CONTRIBUTING.md`](CONTRIBUTING.md).
