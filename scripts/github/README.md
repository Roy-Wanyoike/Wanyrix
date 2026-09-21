# Wanyrix GitHub Automation Kit

Executes the audit's issue+PR workflow (master prompt §67/§68) against the real
GitHub repository. **Requires a human-provided token** — the sandbox has no
GitHub credentials (re-verified repeatedly; see `docs/audits/issues/AUDIT-I5.md`).
The kit fails loudly without one; it never fakes success.

## One-time human step (≈5 minutes)

1. Create a classic PAT with `repo` scope: https://github.com/settings/tokens
2. Ensure the repository exists (empty or existing `ferrix` — bootstrap renames it).
3. Run:

```bash
GH_TOKEN=<your-token> bash scripts/github/run-all.sh
```

That single command:

1. **bootstrap.sh** — installs `gh` if missing, authenticates, verifies/renames the
   repository to `Roy-Wanyoike/wanyrix`, points `origin` at it, pushes `main`.
2. **create-issues.sh** — files one GitHub issue per audit record in
   `docs/audits/issues/*.md` from each record's embedded ready-to-run
   `gh issue create` payload. Idempotent: a record→issue map
   (`docs/audits/issues/CREATED_ISSUES.md`) plus a live duplicate-title check
   prevent double filing.
3. **create-prs.sh** — pushes the prepared `pr/*` fix branches and opens PRs
   whose bodies contain `Closes #N`, so merging the PR auto-closes the issue.

## Preview without credentials

```bash
DRY_RUN=true bash scripts/github/create-issues.sh   # lists what would be filed
DRY_RUN=true bash scripts/github/create-prs.sh      # lists what would be opened
```

## Prepared fix branches (this round)

| Branch | Fixes | Linked issue |
| --- | --- | --- |
| `pr/final-1-investor-overview` | `docs/INVESTOR_OVERVIEW.md` (gate #56 FAIL→PASS) | FINAL-1 |
| `pr/final-2-registry-index` | ENG-T3A-1 row in the registry (AUDIT-I10 chain half) | FINAL-2 |

Branches are cut from the pre-fix commit and contain only their issue's file
changes, so each PR diff is exactly its fix. Note: `main` already contains both
fixes (integrated locally). If you push `main` first, GitHub will show the PRs as
already-containing-the-content; in that case merge them as audit-trail closures or
delete the branches — the issue map + registry remain the source of truth. If you
push branches first and merge the PRs, `main` on GitHub fast-forwards cleanly.

## File map

- `lib.sh` — shared helpers (payload extraction, idempotency map, lookup)
- `bootstrap.sh` — install/auth/rename/push
- `create-issues.sh` — file all records as issues (idempotent)
- `create-prs.sh` — push branches, open `Closes #N` PRs
- `run-all.sh` — the full pipeline
