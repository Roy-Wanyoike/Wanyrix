# Wanyrix Audit — Issue Registry

**Audit:** AUDIT-2026-09-18 · **Baseline:** `e06866a` · **Working tree at filing:** post-migration + storage fix (uncommitted)

## Why issues are filed here and not on GitHub

The sandbox has **no GitHub write access**: no `gh` CLI, no stored credentials
(`git push` → `could not read Username`), and the GitHub API returns **404** for both
`Roy-Wanyoike/ferrix` and `Roy-Wanyoike/wanyrix` anonymously (repo is private, renamed,
or removed). Per audit rules, no duplicate issue may be created — but the existing
issue set is equally unverifiable from here (requires auth). Therefore:

1. Every gap is filed as a full issue record in this directory (`AUDIT-I1.md` … `AUDIT-I10.md`).
2. Each record carries the complete 14-field template and a **ready-to-run**
   `gh issue create` payload for the moment authenticated access exists.
3. `docs/audits/GITHUB_ACTIONS_REQUIRED.md` lists the manual GitHub-side steps
   (rename, push, then bulk-file these issues).

## Duplicate-check record (Rule 4)

| Check | Result |
| --- | --- |
| Open/closed issues on GitHub | **UNVERIFIABLE** (API 404, no auth) — re-check before filing |
| Open/merged PRs on GitHub | **UNVERIFIABLE** — re-check before filing |
| Local git history (`git log --all`) | Searched: no prior issue/PR covers identity migration or persistence fix. Round-1…10 commits touched features, not these gaps |
| In-app issues board (issues-view, `WAN-101…119`) | Product fixture — mirrors demo PRs, not audit issues |

## Index

| ID | Title | Type | Severity | Status |
| --- | --- | --- | --- | --- |
| [AUDIT-I1](AUDIT-I1.md) | Persisted stores silently non-persistent + legacy migration dead (zustand storage thunk bug) | BUG | **P0** | **FIXED in audit** (regression test still required) |
| [AUDIT-I2](AUDIT-I2.md) | Identity migration reported complete but never executed — process/integrity failure | PROCESS / BUG | **P0** | **FIXED in audit** |
| [AUDIT-I3](AUDIT-I3.md) | Navigation 9/14 — Repositories, Findings, Architecture, Runtime, Organization, Settings missing | MISSING_FEATURE | P2 | Open |
| [AUDIT-I4](AUDIT-I4.md) | Zero automated tests (no framework installed) | TEST_GAP | **P1** | Open |
| [AUDIT-I5](AUDIT-I5.md) | GitHub unreachable from sandbox — rename + push + issue filing blocked | INTEGRATION_FAILURE | **P1** | Open (needs human) |
| [AUDIT-I6](AUDIT-I6.md) | No product documentation tree (architecture, CLI reference, data contracts) | DOCUMENTATION | P3 | Open |
| [AUDIT-I7](AUDIT-I7.md) | `explain` AI route: shallow grounding with id-only context; GET contract undocumented | PARTIAL_IMPLEMENTATION | P3 | Open |
| [AUDIT-I8](AUDIT-I8.md) | Rust engine surfaces absent from repo (CLI binary, daemon, telemetry) — N/A or tracked | SCOPE NOTE | P3 | Open (platform repo) |
| [AUDIT-I9](AUDIT-I9.md) | Stale Turbopack chunks after mass rename can serve pre-rename modules in dev | INFRASTRUCTURE | P4 | Open |
| [AUDIT-I10](AUDIT-I10.md) | WAN-* ↔ GitHub issue/PR linkage is by-convention only (no automated traceability) | MISSING_FEATURE | P4 | Open |

Severity policy: P0 = breaks a shipped promise / data loss; P1 = blocks credible development; P2 = material product gap; P3 = quality/completeness; P4 = future/hygiene. Severities were assigned against evidence, not aspiration.
