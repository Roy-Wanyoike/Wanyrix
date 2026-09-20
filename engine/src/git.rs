//! Git intelligence: measured repository facts for the scanned workspace
//! (wanyrix.git/v1).
//!
//! Completes the master chain link `Cargo/rustc/Git → W-EIR`: until this
//! module the engine walked manifests and ran cargo but measured NOTHING
//! from version control (`.git` is deliberately skipped by the scanner).
//!
//! Measurement policy (zero new dependencies, same policy as `ai.rs`):
//! every fact comes from the `git` CLI invoked over `std::process::Command`
//! with a direct argv (no shell interpolation — a repository is untrusted
//! input). Redaction is structural, not a filter step: paths and commit
//! subjects are the ONLY free-form strings this surface can emit — never
//! diffs, never file contents, never author names or emails.
//!
//! Honesty contract: absent git (not a repository, unborn HEAD, missing
//! binary) is a NAMED error with a remediation hint — never a silent
//! default, never fabricated facts. `generatedAt` is the last envelope
//! field. Output is deterministic modulo `generatedAt`.

use std::collections::BTreeSet;
use std::path::Path;
use std::process::Command;

use serde::Serialize;

use crate::model::{EngineError, WorkspaceScan};
use crate::timestamp::iso8601_now;

/// Envelope schema identifier for `wanyrix git --json`.
pub const GIT_SCHEMA: &str = "wanyrix.git/v1";

/// Hard cap on path lists. The COUNT is always the exact measured total;
/// only the echoed list is bounded (honesty rule: truncation is labeled).
const PATH_CAP: usize = 500;

/// One recent commit: short sha, first-line subject, commit timestamp.
/// No author fields by design (privacy redaction).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFact {
    /// Abbreviated commit sha (first 12 hex chars).
    pub sha: String,
    /// First line of the commit message, truncated to 200 chars.
    pub subject: String,
    /// Author timestamp in `YYYY-MM-DDTHH:MM:SSZ` form.
    pub committed_at: String,
}

/// Changed files mapped onto one scanned crate root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrateChange {
    /// Crate package name (graph node id).
    pub crate_name: String,
    /// How many of the measured changed files fall under this crate root.
    pub changed_files: usize,
}

/// Measured git facts (wanyrix.git/v1). Field order is the wire contract;
/// `generated_at` stays LAST.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitReport {
    pub schema: String,
    /// Absolute scan root the facts were measured for (may be a subdirectory
    /// of the repository — git commands run with this as cwd).
    pub root: String,
    /// Current branch name, or `HEAD (detached at <short-sha>)`.
    pub branch: String,
    /// Full 40-hex HEAD commit sha.
    pub head: String,
    /// Measured: does the working tree (including untracked files) differ
    /// from HEAD?
    pub dirty: bool,
    /// Working-tree paths that differ from HEAD (modified/added/deleted/
    /// renamed — renames contribute BOTH old and new paths). Sorted,
    /// deduped, capped at [`PATH_CAP`].
    pub changed_files: Vec<String>,
    /// True when `changed_files` was truncated (the count below is still
    /// the exact measured total).
    pub changed_files_truncated: bool,
    /// Exact number of distinct changed paths (measured, never capped).
    pub changed_files_count: usize,
    /// Untracked (`??`) paths, sorted, capped at [`PATH_CAP`].
    pub untracked_files: Vec<String>,
    pub untracked_truncated: bool,
    /// Changed files mapped onto scanned crate roots (crates with zero
    /// changed files are omitted). Sorted by crate name.
    pub changed_crates: Vec<CrateChange>,
    /// Total commits reachable from HEAD (`git rev-list --count HEAD`).
    pub commit_count: u64,
    /// Up to 10 most recent commits, newest first.
    pub recent_commits: Vec<CommitFact>,
    /// LAST field (honesty rule: timestamps last).
    pub generated_at: String,
}

/// Run a git command in `cwd` and return stdout on success. Named errors
/// for every failure mode: missing binary (with install hint), non-zero
/// exit (with stderr snippet), invalid UTF-8 output.
fn git(cwd: &Path, args: &[&str]) -> Result<String, EngineError> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                EngineError::Git(
                    "git executable not found (install git to measure repository facts)"
                        .to_string(),
                )
            } else {
                EngineError::Git(format!("failed to invoke git: {e}"))
            }
        })?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stderr = stderr.trim();
        let stderr = if stderr.len() > 200 {
            &stderr[..200]
        } else {
            stderr
        };
        return Err(EngineError::Git(format!(
            "git {} failed: {stderr}",
            args.first().unwrap_or(&"")
        )));
    }
    String::from_utf8(out.stdout)
        .map_err(|e| EngineError::Git(format!("git output is not valid UTF-8: {e}")))
}

/// One entry of `git status --porcelain=v1 -z`: status code pair plus the
/// path(s). Renames/copies carry `new` and `old` (two NUL-terminated fields).
#[derive(Debug, Clone, PartialEq, Eq)]
struct PorcelainEntry {
    code: String,
    paths: Vec<String>,
}

/// Parse `git status --porcelain=v1 -z` output: NUL-separated records;
/// rename/copy entries (X or Y in {R, C}) are followed by a second
/// NUL-terminated field holding the original path.
fn parse_porcelain_z(raw: &str) -> Vec<PorcelainEntry> {
    let mut entries = Vec::new();
    let mut fields = raw.split('\0').peekable();
    while let Some(field) = fields.next() {
        if field.is_empty() {
            continue;
        }
        // A record starts with exactly two status chars + one space.
        if field.len() < 4 {
            continue;
        }
        let code = field[..2].to_string();
        let path = field[3..].to_string();
        let mut paths = vec![path];
        if code.contains('R') || code.contains('C') {
            if let Some(old) = fields.next() {
                if !old.is_empty() {
                    paths.push(old.to_string());
                }
            }
        }
        entries.push(PorcelainEntry { code, paths });
    }
    entries
}

/// Measured git facts for the workspace `scan` (its root is the cwd for
/// every git invocation).
pub fn git_facts(scan: &WorkspaceScan) -> Result<GitReport, EngineError> {
    let root = scan.root.as_path();

    // Validate: is this inside a work tree at all? (Named refusal — the
    // honesty contract forbids fabricating "not a repository" facts.)
    let inside = match git(root, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(v) => v,
        Err(EngineError::Git(detail)) if detail.contains("not a git repository") => {
            return Err(EngineError::Git(format!(
                "no git repository found at or above {}",
                root.display()
            )));
        }
        Err(e) => return Err(e),
    };
    if inside.trim() != "true" {
        return Err(EngineError::Git(format!(
            "no git repository found at or above {}",
            root.display()
        )));
    }

    // HEAD must resolve: an unborn branch (fresh `git init`, zero commits)
    // cannot answer "what changed vs HEAD" — named error, not fake facts.
    let head = git(root, &["rev-parse", "HEAD"])?.trim().to_string();

    // Branch: `--abbrev-ref HEAD` returns the literal "HEAD" when detached.
    let abbrev = git(root, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .trim()
        .to_string();
    let short = &head[..12.min(head.len())];
    let branch = if abbrev == "HEAD" {
        format!("HEAD (detached at {short})")
    } else {
        abbrev
    };

    // Working-tree state via porcelain v1 (NUL-delimited: safe for any
    // filename a hostile repository can contain, newlines included).
    let status_raw = git(root, &["status", "--porcelain=v1", "-z"])?;
    let entries = parse_porcelain_z(&status_raw);
    let dirty = !entries.is_empty();

    let mut changed: BTreeSet<String> = BTreeSet::new();
    let mut untracked: BTreeSet<String> = BTreeSet::new();
    for e in &entries {
        for p in &e.paths {
            changed.insert(p.clone());
        }
        if e.code == "??" {
            // Untracked entries carry exactly one path.
            if let Some(p) = e.paths.first() {
                untracked.insert(p.clone());
            }
        }
    }
    let changed_count = changed.len();
    let changed_files: Vec<String> = changed.into_iter().take(PATH_CAP).collect();
    let changed_files_truncated = changed_files.len() < changed_count;
    let untracked_count = untracked.len();
    let untracked_files: Vec<String> = untracked.into_iter().take(PATH_CAP).collect();
    let untracked_truncated = untracked_files.len() < untracked_count;

    // Map changed files onto scanned crate roots (crate_root is a relative
    // forward-slash path; a file belongs to the crate when it IS the root
    // or lives under it).
    let mut crate_changes = Vec::new();
    for c in &scan.crates {
        let prefix = format!("{}/", c.crate_root);
        let n = changed_files_count_all(&entries)
            .into_iter()
            .filter(|f| *f == c.crate_root || f.starts_with(&prefix))
            .count();
        if n > 0 {
            crate_changes.push(CrateChange {
                crate_name: c.name.clone(),
                changed_files: n,
            });
        }
    }
    // scan.crates is already sorted by name; keep that order.

    let commit_count: u64 = git(root, &["rev-list", "--count", "HEAD"])?
        .trim()
        .parse()
        .map_err(|_| EngineError::Git("git rev-list --count returned a non-integer".to_string()))?;

    let log_raw = git(
        root,
        &[
            "log",
            "-10",
            "--date=iso-strict",
            "--pretty=format:%H%x1f%s%x1f%aI",
        ],
    )?;
    let mut recent_commits = Vec::new();
    for line in log_raw.lines().filter(|l| !l.trim().is_empty()) {
        let mut parts = line.split('\u{1f}');
        let (sha, subject, date) = match (parts.next(), parts.next(), parts.next()) {
            (Some(s), Some(sub), Some(d)) => (s, sub, d),
            // Malformed records are named, never silently dropped.
            _ => {
                return Err(EngineError::Git(format!(
                    "malformed git log record: {line:.80}"
                )))
            }
        };
        if sha.len() < 12 {
            return Err(EngineError::Git(format!(
                "git log returned a sha shorter than 12 hex chars: {sha}"
            )));
        }
        // Truncate on char boundaries (subjects are attacker-controlled).
        let mut subject = subject.to_string();
        if subject.chars().count() > 200 {
            subject = subject.chars().take(200).collect();
        }
        recent_commits.push(CommitFact {
            sha: sha[..12].to_string(),
            subject,
            committed_at: date.to_string(),
        });
    }

    Ok(GitReport {
        schema: GIT_SCHEMA.to_string(),
        root: root.display().to_string(),
        branch,
        head,
        dirty,
        changed_files,
        changed_files_truncated,
        changed_files_count: changed_count,
        untracked_files,
        untracked_truncated,
        changed_crates: crate_changes,
        commit_count,
        recent_commits,
        generated_at: iso8601_now(),
    })
}

/// Distinct changed paths across all entries (used for crate mapping; the
/// echo list may be capped, the mapping must count every path).
fn changed_files_count_all(entries: &[PorcelainEntry]) -> Vec<String> {
    let mut set: BTreeSet<String> = BTreeSet::new();
    for e in entries {
        for p in &e.paths {
            set.insert(p.clone());
        }
    }
    set.into_iter().collect()
}

/// Human-readable summary (the non-`--json` flavor). Deterministic.
pub fn git_human(r: &GitReport) -> String {
    let mut out = String::new();
    out.push_str(&format!("wanyrix git — {} ({})\n", r.branch, GIT_SCHEMA));
    out.push_str(&format!("root: {}\n", r.root));
    out.push_str(&format!("head: {} ({} commits)\n", r.head, r.commit_count));
    out.push_str(&format!(
        "working tree: {}\n",
        if r.dirty {
            format!("dirty — {} changed file(s)", r.changed_files_count)
        } else {
            "clean (no changes vs HEAD)".to_string()
        }
    ));
    if !r.changed_crates.is_empty() {
        out.push_str("changed crates:\n");
        for c in &r.changed_crates {
            out.push_str(&format!(
                "  {} — {} file(s)\n",
                c.crate_name, c.changed_files
            ));
        }
    }
    if !r.recent_commits.is_empty() {
        out.push_str("recent commits (newest first):\n");
        for c in &r.recent_commits {
            out.push_str(&format!("  {} {} {}\n", c.sha, c.committed_at, c.subject));
        }
    }
    out.push_str(
        "redaction: paths and subjects only — never diffs, contents, or author identities\n",
    );
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scan::scan_workspace;
    use std::path::PathBuf;

    fn fixture(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn run_git(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "wanyrix-test")
            .env("GIT_AUTHOR_EMAIL", "wanyrix-test@example.invalid")
            .env("GIT_COMMITTER_NAME", "wanyrix-test")
            .env("GIT_COMMITTER_EMAIL", "wanyrix-test@example.invalid")
            .output()
            .expect("git must be available for git.rs integration tests");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).to_string()
    }

    /// A real repository built in a tempdir: one commit, then a dirty file,
    /// then an untracked file. The engine's OWN fixture tree is committed.
    fn repo_with_changes(tag: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("wanyrix-git-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        run_git(&dir, &["init", "-q", "-b", "main"]);
        // Commit the diamond fixture tree as the repo content.
        let src = fixture("diamond-ws");
        copy_tree(&src, &dir);
        run_git(&dir, &["add", "."]);
        run_git(&dir, &["commit", "-q", "-m", "initial: diamond fixture"]);
        // Dirty a tracked file + add an untracked one.
        let lib = dir.join("alpha/src/lib.rs");
        std::fs::write(&lib, "pub fn base() {}\npub fn dirty() {}\n").unwrap();
        std::fs::write(dir.join("UNTRACKED.txt"), "untracked\n").unwrap();
        (dir, src)
    }

    fn copy_tree(src: &Path, dst: &Path) {
        std::fs::create_dir_all(dst).unwrap();
        for entry in std::fs::read_dir(src).unwrap() {
            let entry = entry.unwrap();
            let to = dst.join(entry.file_name());
            if entry.file_type().unwrap().is_dir() {
                copy_tree(&entry.path(), &to);
            } else {
                std::fs::copy(entry.path(), &to).unwrap();
            }
        }
    }

    #[test]
    fn porcelain_z_parses_rename_into_both_paths() {
        let raw = "M  src/a.rs\0?? new.txt\0R  new-name.rs\0old-name.rs\0";
        let entries = parse_porcelain_z(raw);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].code, "M ");
        assert_eq!(entries[0].paths, vec!["src/a.rs".to_string()]);
        assert_eq!(entries[1].code, "??");
        // Rename: first field is the NEW path, second the ORIGINAL.
        assert_eq!(entries[2].code, "R ");
        assert_eq!(
            entries[2].paths,
            vec!["new-name.rs".to_string(), "old-name.rs".to_string()]
        );
    }

    #[test]
    fn porcelain_z_ignores_empty_trailing_field() {
        let entries = parse_porcelain_z("M  a.rs\0");
        assert_eq!(entries.len(), 1);
    }

    #[test]
    fn real_repo_reports_branch_head_dirty_and_crates() {
        let (dir, _src) = repo_with_changes("real");
        let scan = scan_workspace(&dir).unwrap();
        let r = git_facts(&scan).unwrap();

        assert_eq!(r.schema, "wanyrix.git/v1");
        assert_eq!(r.branch, "main");
        assert_eq!(r.head.len(), 40);
        assert!(r.dirty);
        // alpha/src/lib.rs modified + UNTRACKED.txt untracked.
        assert!(r.changed_files.contains(&"alpha/src/lib.rs".to_string()));
        assert!(r.changed_files.contains(&"UNTRACKED.txt".to_string()));
        assert_eq!(r.changed_files_count, 2);
        assert!(!r.changed_files_truncated);
        assert_eq!(r.untracked_files, vec!["UNTRACKED.txt".to_string()]);
        // The only crate with changed files is alpha (1 file).
        assert_eq!(r.changed_crates.len(), 1);
        assert_eq!(r.changed_crates[0].crate_name, "alpha");
        assert_eq!(r.changed_crates[0].changed_files, 1);
        assert_eq!(r.commit_count, 1);
        assert_eq!(r.recent_commits.len(), 1);
        assert_eq!(r.recent_commits[0].subject, "initial: diamond fixture");
        assert!(r.recent_commits[0].committed_at.ends_with('Z'));
        // Envelope order: generatedAt is LAST.
        let json = serde_json::to_string(&r).unwrap();
        let key = "\"generatedAt\":";
        let idx = json.rfind(key).expect("generatedAt present");
        let rest = &json[idx + key.len()..];
        assert!(
            rest.starts_with('"') && rest.ends_with("\"}"),
            "generatedAt must be the last field, got: {rest}"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn not_a_repo_is_a_named_error() {
        let dir = std::env::temp_dir().join(format!("wanyrix-git-norepo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Minimal manifest so the scan succeeds; the git facts must refuse.
        std::fs::write(
            dir.join("Cargo.toml"),
            "[package]\nname = \"norepo\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        let scan = scan_workspace(&dir).unwrap();
        let err = git_facts(&scan).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("no git repository found at or above"), "{msg}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unborn_head_is_a_named_error_not_fake_facts() {
        let dir = std::env::temp_dir().join(format!("wanyrix-git-unborn-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        run_git(&dir, &["init", "-q", "-b", "main"]);
        std::fs::write(
            dir.join("Cargo.toml"),
            "[package]\nname = \"unborn\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        let scan = scan_workspace(&dir).unwrap();
        let err = git_facts(&scan).unwrap_err();
        assert!(err.to_string().contains("git rev-parse failed"), "{}", err);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn redaction_no_author_identity_in_output() {
        let (dir, _src) = repo_with_changes("redact");
        let scan = scan_workspace(&dir).unwrap();
        let r = git_facts(&scan).unwrap();
        let json = serde_json::to_string(&r).unwrap();
        for banned in ["wanyrix-test", "example.invalid", "author", "Author"] {
            assert!(!json.contains(banned), "redaction leak: {banned} in {json}");
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn human_flavor_is_deterministic_and_labeled() {
        let (dir, _src) = repo_with_changes("human");
        let scan = scan_workspace(&dir).unwrap();
        let r = git_facts(&scan).unwrap();
        let h1 = git_human(&r);
        let h2 = git_human(&r);
        assert_eq!(h1, h2);
        assert!(h1.contains("wanyrix git — main"));
        assert!(h1.contains("dirty — 2 changed file(s)"));
        assert!(h1.contains("redaction: paths and subjects only"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
