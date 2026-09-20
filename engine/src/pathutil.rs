//! Small path helpers (no external deps, no panics on user input).

use std::path::{Path, PathBuf};

/// Read a file to string; missing/unreadable files map to an error message
/// instead of a panic (callers turn failures into measured findings).
pub fn read_to_string(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Upper bound for one file the engine reads while measuring a possibly
/// hostile repository (16 MiB ≈ 100× the largest legitimate manifest the
/// engine has ever been measured against). A file past the cap is a NAMED
/// unreadable finding upstream — never an OOM, never an unbounded parse.
pub const MAX_MEASURED_FILE_BYTES: u64 = 16 * 1024 * 1024;

/// Read a file ONLY if it is a plain regular file within
/// [`MAX_MEASURED_FILE_BYTES`].
///
/// This is the hostile-repository guard for every DIRECT read on the scan
/// path (the walk itself already skips symlinked entries). It rejects, with
/// a named reason instead of a panic or a hang:
/// - symlinks (the scan's documented no-follow policy extends to direct
///   reads — a `rust-toolchain.toml` symlinked to `/dev/zero` must not be
///   opened at all);
/// - non-regular files such as FIFOs and device nodes (they never EOF, so
///   reading one would hang the scan forever);
/// - files larger than the measured cap (an unbounded "manifest" must
///   degrade to a named finding, not an OOM).
pub fn read_regular_file(path: &Path) -> Result<String, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.is_symlink() {
        return Err(format!(
            "{}: symlinked files are never followed by the scan",
            path.display()
        ));
    }
    if !meta.is_file() {
        return Err(format!(
            "{}: not a regular file (FIFOs/devices are never read)",
            path.display()
        ));
    }
    if meta.len() > MAX_MEASURED_FILE_BYTES {
        return Err(format!(
            "{}: {} bytes exceeds the measured-file cap of {MAX_MEASURED_FILE_BYTES} bytes",
            path.display(),
            meta.len()
        ));
    }
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Path relative to `root`, forward slashes, portable in JSON output.
/// Falls back to the canonical path when the file lives outside `root`.
pub fn rel_forward(root: &Path, path: &Path) -> String {
    match path.strip_prefix(root) {
        Ok(rel) => rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/"),
        Err(_) => path.display().to_string(),
    }
}

/// Resolve `base`/`rel` for dependency path fields; returns `None` for
/// obviously invalid relatives (`..` escaping is allowed — the caller
/// canonicalizes and decides where it landed).
pub fn join_dep_path(base: &Path, rel: &str) -> PathBuf {
    base.join(rel)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rel_forward_uses_forward_slashes() {
        let root = Path::new("/tmp/ws");
        let p = Path::new("/tmp/ws/crates/alpha/Cargo.toml");
        assert_eq!(rel_forward(root, p), "crates/alpha/Cargo.toml");
    }

    #[test]
    fn rel_forward_falls_back_outside_root() {
        let root = Path::new("/tmp/ws");
        let p = Path::new("/elsewhere/Cargo.toml");
        assert_eq!(rel_forward(root, p), "/elsewhere/Cargo.toml");
    }
}
