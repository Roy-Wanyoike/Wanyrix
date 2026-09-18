# AUDIT-I5 — GitHub unreachable from sandbox: rename, push, issue filing blocked

**Type:** INTEGRATION_FAILURE · **Severity:** P1 · **Status:** Open — requires a human with GitHub access
**Labels:** `github`, `devops`, `blocked`, `audit-2026-09-18`

## 1. Problem
The user instruction "update github repo" cannot be completed from this environment:
no `gh` CLI, no stored credentials, GitHub API 404 for both repo names, and `git push`
cannot authenticate. The local `main` branch is **ahead of origin by 9+ commits** at
baseline, now more after the audit — including the entire identity migration.

## 2. Evidence
- `git push --dry-run` → `fatal: could not read Username for 'https://github.com'`.
- `curl -H "User-Agent: …" api.github.com/repos/Roy-Wanyoike/{ferrix,wanyrix}` → both `404 Not Found`.
- `git rev-list --count origin/main..HEAD` → 9 at baseline.
- `git remote -v` → `origin https://github.com/Roy-Wanyoike/ferrix.git`.

## 3. Current behavior
All audit work sits as local commits, invisible on GitHub.

## 4. Expected behavior
GitHub repo named `wanyrix` (or an explicit decision to keep `ferrix`), remote updated,
all commits pushed, audit issues filed (registry is ready), CI running the brand gate.

## 5. Root cause
Sandbox has no GitHub credentials by design; repo privacy/rename state unverifiable.

## 6. Implementation requirements (human checklist)
1. Verify the repo exists and decide the canonical name (prefer **rename to `wanyrix`**: GitHub auto-redirects old URLs).
2. Push: `git push origin main` (or `git push --force-with-lease` only after history review).
3. Rename: GitHub → Settings → General → Repository name → `wanyrix`.
4. Update local remote: `git remote set-url origin https://github.com/Roy-Wanyoike/wanyrix.git`.
5. File the issues in `docs/audits/issues/` using each file's ready-to-run `gh issue create` payload (re-check for duplicates first).
6. Enable Actions so `scripts/check-branding.sh` + future CI (AUDIT-I4) execute on PRs.

## 7. Acceptance criteria
- [ ] `git ls-remote origin` succeeds against `Roy-Wanyoike/wanyrix`.
- [ ] `origin/main` contains the audit commit.
- [ ] Audit issues visible on GitHub with registry IDs referenced.
- [ ] README/REPO_URL references no longer 404.

## 8. Tests required
N/A (ops).

## 9. Security considerations
Use a fine-grained PAT or `gh auth login`; never commit credentials.

## 10. Performance considerations
N/A.

## 11. Dependencies
Blocks: AUDIT-I2 DoD (CI), AUDIT-I4 CI execution, AUDIT-I10 (linkage).

## 12. Definition of Done
Repo reachable as `wanyrix`, pushed, issues filed, CI enabled.

## Ready-to-run filing
```bash
gh issue create -R Roy-Wanyoike/wanyrix \
  -t "ops: GitHub-side rename + push checklist (audit AUDIT-2026-09-18)" \
  -b "See docs/audits/issues/AUDIT-I5.md" -l "devops"
```
