# GitHub Actions Required (human, authenticated)

The audit completed all local work. The following steps **cannot** be executed from the
sandbox (no credentials; GitHub API 404 for both repo names). Execute in order:

```bash
# 1. Authenticate once
gh auth login            # or export GH_TOKEN=<fine-grained PAT>

# 2. Push the audit + migration work (main is many commits ahead of origin/main)
cd /home/z/my-project
git push origin main

# 3. Rename the repository Ferrix → Wanyrix (old URLs auto-redirect afterwards)
gh repo rename wanyrix -R Roy-Wanyoike/ferrix --yes

# 4. Point the local remote at the canonical name
git remote set-url origin https://github.com/Roy-Wanyoike/wanyrix.git
git ls-remote origin     # verify

# 5. Re-check for duplicate issues, then file the audit registry
gh issue list -R Roy-Wanyoike/wanyrix --state all --limit 200
# each docs/audits/issues/AUDIT-I*.md ends with a ready-to-run `gh issue create` payload

# 6. Enable GitHub Actions so scripts/check-branding.sh (+ future CI, AUDIT-I4) run on PRs
```

## Why rename
- Product identity is now canonically **Wanyrix** (code, CLI strings, docs, persist
  keys, report flavors all migrated — see `docs/migrations/FERRIX_TO_WANYRIX.md`).
- README links and board traceability already point at `Roy-Wanyoike/wanyrix` URLs;
  until the rename those links 404.
- One product, one identity, one canonical name.

## Do NOT
- Do not push with force flags before reviewing history.
- Do not keep `ferrix.git` while claiming Wanyrix identity in the product — that is the
  exact "two names, one product" ambiguity the audit was asked to end.
