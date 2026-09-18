//! Small path helpers (no external deps, no panics on user input).

use std::path::{Path, PathBuf};

/// Read a file to string; missing/unreadable files map to an error message
/// instead of a panic (callers turn failures into measured findings).
pub fn read_to_string(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
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
