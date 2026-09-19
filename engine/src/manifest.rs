//! Cargo manifest model (serde over the `toml` crate).
//!
//! Cargo manifests are open-world: fields may be strings, inline tables
//! (`version = { workspace = true }`), arrays, or inherited from
//! `[workspace.package]`. The untagged [`MetaValue`] keeps parsing total:
//! an unexpected shape degrades to a measured "absent/inherited" state
//! instead of a crash or a fabricated default. Unknown keys are ignored.

use std::collections::BTreeMap;

use serde::Deserialize;

/// A manifest field value: text, or the structured (often inheritance)
/// form such as `{ workspace = true }`.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum MetaValue {
    Text(String),
    Structured(toml::Table),
}

impl MetaValue {
    pub fn text(&self) -> Option<&str> {
        match self {
            MetaValue::Text(s) => Some(s),
            _ => None,
        }
    }

    /// True when the value is the inheritance marker `{ workspace = true }`.
    pub fn is_inherited(&self) -> bool {
        match self {
            MetaValue::Structured(t) => t
                .get("workspace")
                .and_then(toml::Value::as_bool)
                .unwrap_or(false),
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Package {
    pub name: Option<String>,
    pub version: Option<MetaValue>,
    pub license: Option<MetaValue>,
    #[serde(rename = "license-file")]
    pub license_file: Option<MetaValue>,
    pub description: Option<MetaValue>,
    /// `package.workspace = "../.."` — pointer to the workspace root manifest.
    pub workspace: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct WorkspacePackage {
    pub version: Option<MetaValue>,
    pub license: Option<MetaValue>,
    pub description: Option<MetaValue>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct WorkspaceTable {
    pub members: Option<Vec<String>>,
    pub package: Option<WorkspacePackage>,
    /// `[workspace.dependencies]` — shared dependency definitions that
    /// members inherit via `foo = { workspace = true }`.
    #[serde(default)]
    pub dependencies: BTreeMap<String, DepSpec>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LibTable {
    /// `crate-type` may be a string or an array of strings.
    #[serde(rename = "crate-type", default)]
    pub crate_type: Option<toml::Value>,
}

impl LibTable {
    pub fn is_proc_macro(&self) -> bool {
        match &self.crate_type {
            Some(toml::Value::String(s)) => s == "proc-macro",
            Some(toml::Value::Array(items)) => items
                .iter()
                .filter_map(toml::Value::as_str)
                .any(|s| s == "proc-macro"),
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct BinTable {
    #[serde(default)]
    pub name: Option<String>,
}

/// One dependency entry — either a bare version string or a detail table.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum DepSpec {
    Simple(String),
    Detailed(DepDetail),
}

#[derive(Debug, Clone, Deserialize)]
pub struct DepDetail {
    pub version: Option<MetaValue>,
    pub path: Option<String>,
    pub git: Option<String>,
    /// Dependency rename: the real crate name when the table key differs.
    pub package: Option<String>,
    #[serde(default)]
    pub optional: Option<bool>,
    #[serde(default)]
    pub workspace: Option<bool>,
}

impl DepSpec {
    /// The dependency's real crate name (table key, unless renamed).
    pub fn dep_name<'a>(key: &'a str, spec: &'a DepSpec) -> &'a str {
        match spec {
            DepSpec::Simple(_) => key,
            DepSpec::Detailed(d) => d.package.as_deref().unwrap_or(key),
        }
    }

    /// Version constraint text when present (for evidence strings).
    pub fn version_text(&self) -> Option<String> {
        match self {
            DepSpec::Simple(s) => Some(s.clone()),
            DepSpec::Detailed(d) => d
                .version
                .as_ref()
                .and_then(MetaValue::text)
                .map(str::to_owned),
        }
    }
}

/// A parsed `Cargo.toml`.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct Manifest {
    pub package: Option<Package>,
    pub workspace: Option<WorkspaceTable>,
    #[serde(default)]
    pub dependencies: BTreeMap<String, DepSpec>,
    #[serde(rename = "dev-dependencies", default)]
    pub dev_dependencies: BTreeMap<String, DepSpec>,
    #[serde(rename = "build-dependencies", default)]
    pub build_dependencies: BTreeMap<String, DepSpec>,
    pub lib: Option<LibTable>,
    #[serde(default)]
    pub bin: Option<Vec<BinTable>>,
}

impl Manifest {
    pub fn is_package(&self) -> bool {
        self.package.is_some()
    }

    pub fn package_name(&self) -> Option<&str> {
        self.package.as_ref().and_then(|p| p.name.as_deref())
    }

    pub fn has_workspace_table(&self) -> bool {
        self.workspace.is_some()
    }

    pub fn is_virtual_workspace(&self) -> bool {
        self.package.is_none() && self.workspace.is_some()
    }

    /// Dependency-name → sections map for the duplicate-declaration rule.
    pub fn dep_sections(&self) -> [(&'static str, &BTreeMap<String, DepSpec>); 3] {
        [
            ("dependencies", &self.dependencies),
            ("dev-dependencies", &self.dev_dependencies),
            ("build-dependencies", &self.build_dependencies),
        ]
    }
}

/// One scanned manifest record: what it was, where, and how parsing went.
/// Parse failures are retained (never dropped) so the analysis pass can
/// report them as findings — honesty over convenience.
#[derive(Debug, Clone)]
pub struct ManifestRecord {
    /// `[package] name` when the manifest declares a package, else `None`
    /// (virtual workspace manifests, parse failures).
    pub crate_name: Option<String>,
    /// Manifest path relative to the scan root, forward slashes.
    pub rel: String,
    pub result: Result<Manifest, String>,
    /// Measured: does the manifest carry a `[workspace]` table?
    pub declares_workspace: bool,
}

impl ManifestRecord {
    pub fn manifest(&self) -> Option<&Manifest> {
        self.result.as_ref().ok()
    }
}
