//! rustc JSON diagnostics ingestion with default-on redaction (engine
//! phase-2, GitHub issue #58 tranche 2).
//!
//! `cargo build --message-format=json` (and `rustc --error-format=json`)
//! stream JSON diagnostics that contain VERBATIM SOURCE: every span carries
//! the source line it points at (`spans[].text`), every diagnostic carries a
//! fully-rendered copy of itself (`rendered`), and suggested replacements
//! contain source text too. Ingesting such a stream into a report that
//! leaves the machine unredacted would leak the workspace's source — so
//! redaction here is DEFAULT-ON and can never be fully disabled:
//!
//! - `rendered` is dropped unconditionally (contains the annotated snippet);
//! - `spans[].text` (source lines + highlight ranges) is dropped
//!   unconditionally;
//! - `suggested_replacement`/`suggestion` values are dropped unconditionally
//!   (they are source text);
//! - `file_name` is reduced to its basename by default (`--keep-paths`
//!   opts back in to full paths, but never to snippets);
//! - every retained string is scrubbed against a fixed secret-shape list
//!   (GitHub/AWS/Slack/OpenAI tokens, JWTs, bearer headers, private-key
//!   headers, `api_key = …`-style assignments); matches become
//!   `[redacted:…]` and are counted in `redaction.secretsScrubbed`.
//!
//! Honesty contract: counts (`errors`, `warnings`, `byCode`, `byFile`, …)
//! are MEASURED from the ingested stream. Lines that are not diagnostics
//! (e.g. cargo `compiler-artifact` notifications) and lines that fail to
//! parse are counted honestly (`otherLines`, `malformedLines`) — never
//! dropped silently, never parsed into something they are not.

use serde::Serialize;
use serde_json::Value;

use crate::model::EngineError;

pub const TELEMETRY_SCHEMA: &str = "wanyrix.telemetry/v1";
pub const REDACTION_POLICY: &str = "wanyrix.telemetry-redaction/v1";

pub const MEASUREMENT_NOTE: &str = "measured — counts are computed from the ingested rustc/cargo JSON stream exactly as it was read; redaction is applied before anything is emitted, and the redaction counts report what was actually removed (Gate 21).";

/// Redaction options. `keep_paths` is the ONLY switch and it only widens
/// file names to full paths — source snippets are never retained.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct IngestOptions {
    /// Keep full span file paths instead of reducing them to basenames.
    pub keep_paths: bool,
    /// Emit aggregates only (omit the per-diagnostic `diagnostics` array).
    pub summary_only: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryInput {
    /// Where the stream was read from (path, or `"<stdin>"`).
    pub source: String,
    /// Non-empty lines processed.
    pub lines_read: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySummary {
    /// Lines that were recognized diagnostics (wrapped or raw).
    pub diagnostic_lines: usize,
    /// Valid JSON lines that are not diagnostics (cargo artifact/event
    /// notifications, forward-compatible unknown reasons).
    pub other_lines: usize,
    /// Lines that failed to parse as JSON at all.
    pub malformed_lines: usize,
    pub errors: usize,
    pub warnings: usize,
    pub notes: usize,
    pub help: usize,
    /// Internal-compiler-error diagnostics (`level` contains "internal
    /// compiler error"); also counted in `errors`.
    pub ice: usize,
    /// Diagnostics with any other `level` (e.g. `failure-note`,
    /// `cancelled`) — counted, never reclassified.
    pub other_levels: usize,
    pub distinct_codes: usize,
    /// Diagnostics carrying no rustc error code (`code: null`).
    pub no_code: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodeCount {
    pub code: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileCount {
    pub file: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Redaction {
    pub applied: bool,
    pub policy: &'static str,
    /// true unless `--keep-paths` was passed.
    pub paths_reduced: bool,
    /// Fields removed from every diagnostic before emission.
    pub fields_stripped: &'static [&'static str],
    /// Number of secret-shaped substrings actually replaced.
    pub secrets_scrubbed: usize,
}

/// `wanyrix.telemetry/v1` — field order is the emitted order; `generatedAt`
/// is LAST (the only non-deterministic key), matching every engine envelope.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryReport {
    pub schema: &'static str,
    pub meta: TelemetryInput,
    pub summary: TelemetrySummary,
    pub by_code: Vec<CodeCount>,
    pub by_file: Vec<FileCount>,
    /// `None` under `--summary-only`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<Vec<Value>>,
    pub redaction: Redaction,
    pub measurement: &'static str,
    /// LAST key — the only non-deterministic field.
    pub generated_at: String,
}

/// Ingest a full rustc/cargo JSON diagnostics stream (one JSON object per
/// line) and build the redacted report.
pub fn ingest_text(text: &str, source: &str, opts: &IngestOptions) -> TelemetryReport {
    let mut summary = TelemetrySummary {
        diagnostic_lines: 0,
        other_lines: 0,
        malformed_lines: 0,
        errors: 0,
        warnings: 0,
        notes: 0,
        help: 0,
        ice: 0,
        other_levels: 0,
        distinct_codes: 0,
        no_code: 0,
    };
    let mut by_code: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    let mut by_file: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    let mut diagnostics: Vec<Value> = Vec::new();
    let mut secrets_scrubbed = 0usize;

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        let parsed: Result<Value, _> = serde_json::from_str(line);
        let value = match parsed {
            Ok(v) => v,
            Err(_) => {
                summary.malformed_lines += 1;
                continue;
            }
        };
        let Some(diag) = extract_diagnostic(&value) else {
            summary.other_lines += 1;
            continue;
        };
        summary.diagnostic_lines += 1;
        let (redacted, scrubbed) = redact_diagnostic(diag, opts);
        secrets_scrubbed += scrubbed;

        let level = redacted
            .get("level")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        if level.contains("internal compiler error") {
            summary.ice += 1;
            summary.errors += 1;
        } else if level.starts_with("error") {
            summary.errors += 1;
        } else if level.starts_with("warning") {
            summary.warnings += 1;
        } else if level.starts_with("note") {
            summary.notes += 1;
        } else if level.starts_with("help") {
            summary.help += 1;
        } else {
            summary.other_levels += 1;
        }
        match redacted.get("code").and_then(Value::as_str) {
            Some(code) => {
                *by_code.entry(code.to_owned()).or_insert(0) += 1;
            }
            None => summary.no_code += 1,
        }
        // Count every span's (already redacted) file name.
        if let Some(spans) = redacted.get("spans").and_then(Value::as_array) {
            for span in spans {
                if let Some(file) = span.get("file").and_then(Value::as_str) {
                    *by_file.entry(file.to_owned()).or_insert(0) += 1;
                }
            }
        }
        if !opts.summary_only {
            diagnostics.push(redacted);
        }
    }

    summary.distinct_codes = by_code.len();
    TelemetryReport {
        schema: TELEMETRY_SCHEMA,
        meta: TelemetryInput {
            source: source.to_owned(),
            lines_read: summary.diagnostic_lines + summary.other_lines + summary.malformed_lines,
        },
        summary,
        by_code: by_code
            .into_iter()
            .map(|(code, count)| CodeCount { code, count })
            .collect(),
        by_file: by_file
            .into_iter()
            .map(|(file, count)| FileCount { file, count })
            .collect(),
        diagnostics: if opts.summary_only { None } else { Some(diagnostics) },
        redaction: Redaction {
            applied: true,
            policy: REDACTION_POLICY,
            paths_reduced: !opts.keep_paths,
            fields_stripped: &["rendered", "spans[].text", "suggested_replacement", "suggestion"],
            secrets_scrubbed,
        },
        measurement: MEASUREMENT_NOTE,
        generated_at: crate::timestamp::iso8601_now(),
    }
}

/// Extract the diagnostic object from a stream line: cargo wraps
/// diagnostics as `{"reason":"compiler-message","message":{…}}`; raw rustc
/// emits `{"$message_type":"diagnostic",…}`; a bare object carrying
/// `level` + `message` + a diagnostic-only field is treated as a diagnostic
/// too (forward-compatible). Everything else is "other".
fn extract_diagnostic(value: &Value) -> Option<&Value> {
    let obj = value.as_object()?;
    if obj.get("reason").and_then(Value::as_str) == Some("compiler-message") {
        let msg = obj.get("message")?;
        return if is_diagnostic(msg) { Some(msg) } else { None };
    }
    if obj.get("$message_type").and_then(Value::as_str) == Some("diagnostic") {
        return Some(value);
    }
    if is_diagnostic(value) {
        return Some(value);
    }
    None
}

fn is_diagnostic(v: &Value) -> bool {
    let obj = match v.as_object() {
        Some(o) => o,
        None => return false,
    };
    obj.contains_key("level") && obj.contains_key("message") && (obj.contains_key("spans") || obj.contains_key("rendered"))
}

/// Redact one diagnostic (recursively for `children`), returning the output
/// object plus the number of secret-shaped substrings scrubbed.
fn redact_diagnostic(diag: &Value, opts: &IngestOptions) -> (Value, usize) {
    let mut scrubbed = 0usize;
    let mut out = serde_json::Map::new();
    let level = diag.get("level").cloned().unwrap_or(Value::Null);
    if let Some(s) = level.as_str() {
        let (s, n) = scrub_secrets(s);
        scrubbed += n;
        out.insert("level".into(), Value::String(s));
    } else {
        out.insert("level".into(), level);
    }
    let code_out = match diag.get("code") {
        Some(Value::Object(code)) => code.get("code").cloned().unwrap_or(Value::Null),
        _ => Value::Null,
    };
    out.insert("code".into(), code_out);
    if let Some(msg) = diag.get("message").and_then(Value::as_str) {
        let (m, n) = scrub_secrets(msg);
        scrubbed += n;
        out.insert("message".into(), Value::String(m));
    } else {
        out.insert("message".into(), Value::Null);
    }
    // spans: locations kept; text (source lines), rendered fragments and
    // suggested replacements (source text) dropped unconditionally.
    let mut spans_out: Vec<Value> = Vec::new();
    if let Some(spans) = diag.get("spans").and_then(Value::as_array) {
        for span in spans {
            let mut s = serde_json::Map::new();
            let file = span.get("file_name").and_then(Value::as_str).unwrap_or_default();
            let redacted_file = if opts.keep_paths {
                file.to_owned()
            } else {
                file.rsplit(['/', '\\']).next().unwrap_or(file).to_owned()
            };
            s.insert("file".into(), Value::String(redacted_file));
            for (src_key, out_key) in [
                ("line_start", "lineStart"),
                ("line_end", "lineEnd"),
                ("column_start", "columnStart"),
                ("column_end", "columnEnd"),
            ] {
                s.insert(out_key.into(), span.get(src_key).cloned().unwrap_or(Value::Null));
            }
            s.insert("isPrimary".into(), span.get("is_primary").cloned().unwrap_or(Value::Null));
            match span.get("label").and_then(Value::as_str) {
                Some(label) if !label.is_empty() => {
                    let (l, n) = scrub_secrets(label);
                    scrubbed += n;
                    s.insert("label".into(), Value::String(l));
                }
                _ => {
                    s.insert("label".into(), Value::Null);
                }
            }
            spans_out.push(Value::Object(s));
        }
    }
    out.insert("spans".into(), Value::Array(spans_out));
    let mut children_out: Vec<Value> = Vec::new();
    if let Some(children) = diag.get("children").and_then(Value::as_array) {
        for child in children {
            let (c, n) = redact_diagnostic(child, opts);
            scrubbed += n;
            children_out.push(c);
        }
    }
    out.insert("children".into(), Value::Array(children_out));
    (Value::Object(out), scrubbed)
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Replace every secret-shaped substring with a labeled `[redacted:…]`.
/// Fixed shape list, no regex dependency; sequential passes, longest
/// prefixes first, so `github_pat_…` is never half-eaten by a shorter rule.
pub fn scrub_secrets(s: &str) -> (String, usize) {
    let mut out = s.to_owned();
    let mut count = 0usize;

    // ---- BEGIN … PRIVATE KEY----- header (whole header) ------------------
    {
        let lower = out.to_ascii_lowercase();
        if let Some(start) = lower.find("-----begin") {
            if let Some(rel) = lower[start..].find("private key") {
                if let Some(end_rel) = lower[start + rel..].find("key-----") {
                    let end = start + rel + end_rel + "key-----".len();
                    if out.is_char_boundary(start) && out.is_char_boundary(end) {
                        out.replace_range(start..end, "[redacted:private-key]");
                        count += 1;
                    }
                }
            }
        }
    }

    // ---- explicit token shapes ------------------------------------------
    for (prefix, min, max, repl) in [
        ("github_pat_", 20usize, 64usize, "[redacted:github-pat]"),
        ("ghp_", 20, 60, "[redacted:github-token]"),
        ("ghu_", 20, 60, "[redacted:github-token]"),
        ("ghs_", 20, 60, "[redacted:github-token]"),
        ("ghr_", 20, 60, "[redacted:github-token]"),
        ("AKIA", 16, 16, "[redacted:aws-key]"),
        ("xoxb-", 10, 80, "[redacted:slack-token]"),
        ("xoxp-", 10, 80, "[redacted:slack-token]"),
        ("xoxa-", 10, 80, "[redacted:slack-token]"),
        ("xoxs-", 10, 80, "[redacted:slack-token]"),
        ("xoxr-", 10, 80, "[redacted:slack-token]"),
        ("sk-ant-", 20, 120, "[redacted:api-key]"),
        ("sk-", 20, 120, "[redacted:api-key]"),
    ] {
        let (s2, n) = pass_replace(&out, prefix, min, max, repl);
        out = s2;
        count += n;
    }

    // ---- JWT: three dot-separated base64url segments --------------------
    {
        let (s2, n) = pass_jwt(&out);
        out = s2;
        count += n;
    }

    // ---- bearer headers --------------------------------------------------
    {
        let (s2, n) = pass_bearer(&out);
        out = s2;
        count += n;
    }

    // ---- keyword = value assignments ------------------------------------
    {
        let (s2, n) = pass_keyword_assignments(&out);
        out = s2;
        count += n;
    }

    (out, count)
}

/// One explicit-prefix pass: find case-sensitive `prefix` at a word
/// boundary, consume `[min,max]` token characters after it, replace the
/// whole span with `repl`.
fn pass_replace(s: &str, prefix: &str, min: usize, max: usize, repl: &str) -> (String, usize) {
    let mut out = String::with_capacity(s.len());
    let mut count = 0usize;
    let mut copy_from = 0usize;
    let mut search_from = 0usize;
    while let Some(rel) = s[search_from..].find(prefix) {
        let start = search_from + rel;
        let boundary_ok = start == 0 || !s[..start].chars().next_back().is_some_and(is_word_char);
        let mut consumed = None;
        if boundary_ok {
            let rest = &s[start + prefix.len()..];
            let mut n = 0usize;
            for c in rest.chars() {
                if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                    n += c.len_utf8();
                    if n > max {
                        break;
                    }
                } else {
                    break;
                }
            }
            if n >= min && n <= max {
                consumed = Some(n);
            }
        }
        match consumed {
            Some(n) => {
                out.push_str(&s[copy_from..start]);
                out.push_str(repl);
                count += 1;
                copy_from = start + prefix.len() + n;
                search_from = copy_from;
            }
            None => {
                search_from = start + prefix.len();
            }
        }
    }
    out.push_str(&s[copy_from..]);
    (out, count)
}

fn pass_jwt(s: &str) -> (String, usize) {
    let mut out = String::with_capacity(s.len());
    let mut count = 0usize;
    let mut copy_from = 0usize;
    let mut search_from = 0usize;
    while let Some(rel) = s[search_from..].find("eyJ") {
        let start = search_from + rel;
        let boundary_ok = start == 0 || !s[..start].chars().next_back().is_some_and(is_word_char);
        let mut match_end = None;
        if boundary_ok {
            let rest = &s[start..];
            let seg_len = |t: &str| -> Option<usize> {
                let n = t
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                    .map(char::len_utf8)
                    .sum::<usize>();
                (n >= 8).then_some(n)
            };
            // header: "eyJ" + seg '.' payload seg '.' signature seg
            if let Some(h) = seg_len(&rest[3..]) {
                if rest[3 + h..].starts_with('.') {
                    let payload_start = 3 + h + 1;
                    if let Some(p) = seg_len(&rest[payload_start..]) {
                        if rest[payload_start + p..].starts_with('.') {
                            let sig_start = payload_start + p + 1;
                            if let Some(g) = seg_len(&rest[sig_start..]) {
                                match_end = Some(sig_start + g);
                            }
                        }
                    }
                }
            }
        }
        if let Some(end) = match_end {
            out.push_str(&s[copy_from..start]);
            out.push_str("[redacted:jwt]");
            count += 1;
            copy_from = start + end;
            search_from = copy_from;
        } else {
            search_from = start + 3;
        }
    }
    out.push_str(&s[copy_from..]);
    (out, count)
}

fn pass_bearer(s: &str) -> (String, usize) {
    let mut out = String::with_capacity(s.len());
    let mut count = 0usize;
    let lower = s.to_ascii_lowercase();
    let mut copy_from = 0usize;
    let mut search_from = 0usize;
    while let Some(rel) = lower[search_from..].find("bearer") {
        let start = search_from + rel;
        let after = start + "bearer".len();
        // require the word boundary after "bearer"
        let sep_len = s[after..].chars().next().map(|c| if c == ' ' || c == '\t' || c == ':' { c.len_utf8() } else { 0 }).unwrap_or(0);
        if sep_len == 0 {
            search_from = after;
            continue;
        }
        let value_start = after + sep_len;
        let n: usize = s[value_start..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '~' | '+' | '/' | '=' | '-'))
            .map(char::len_utf8)
            .sum();
        if n >= 16 {
            out.push_str(&s[copy_from..start]);
            out.push_str("Bearer [redacted]");
            count += 1;
            copy_from = value_start + n;
            search_from = copy_from;
        } else {
            search_from = after;
        }
    }
    out.push_str(&s[copy_from..]);
    (out, count)
}

fn pass_keyword_assignments(s: &str) -> (String, usize) {
    let mut out = String::with_capacity(s.len());
    let mut count = 0usize;
    let lower = s.to_ascii_lowercase();
    const KEYWORDS: [&str; 5] = ["api_key", "apikey", "secret", "token", "password"];
    let mut copy_from = 0usize;
    let mut i = 0usize;
    while i < lower.len() {
        let mut matched = None;
        for kw in KEYWORDS {
            if lower[i..].starts_with(kw) {
                // Credential FIELD names are underscore/hyphen-joined
                // (auth_token, client_secret) — so only an alphanumeric
                // prefix disqualifies the keyword, not `_`/`-`.
                let boundary_before = i == 0 || !lower[..i].chars().next_back().is_some_and(|c| c.is_alphanumeric());
                if !boundary_before {
                    continue;
                }
                if let Some(value_start) = keyword_value_start(&lower[i + kw.len()..]) {
                    matched = Some((kw.len(), i + kw.len() + value_start));
                    break;
                }
            }
        }
        match matched {
            Some((kw_len, value_start)) => {
                // Guard against re-redacting an earlier `[redacted:…]`.
                let already = s[value_start..].starts_with("[redacted");
                out.push_str(&s[copy_from..i + kw_len]);
                if already {
                    out.push_str(&s[i + kw_len..value_start]);
                } else {
                    out.push_str(&s[i + kw_len..value_start]);
                    out.push_str("[redacted]");
                    count += 1;
                }
                copy_from = value_start;
                // skip past the value in both strings
                let skip = s[copy_from..]
                    .chars()
                    .take_while(|c| c.is_ascii_graphic() && *c != '"' && *c != '\'' && *c != ',' && *c != ';')
                    .map(char::len_utf8)
                    .sum::<usize>();
                out.push_str(&s[copy_from..copy_from + skip]);
                copy_from += skip;
                i = copy_from;
            }
            None => {
                i += 1;
            }
        }
    }
    out.push_str(&s[copy_from..]);
    (out, count)
}

/// From the text right after a keyword, find the byte offset where a
/// `key = value` / `key: value` VALUE begins; None when the shape is not an
/// assignment (e.g. prose like "token `let`").
fn keyword_value_start(after_kw: &str) -> Option<usize> {
    let bytes = after_kw.as_bytes();
    let mut i = 0usize;
    let mut seen_sep = false;
    while i < bytes.len() {
        match bytes[i] {
            b'"' | b'\'' | b' ' | b'\t' | b'`' => i += 1,
            b':' | b'=' => {
                seen_sep = true;
                i += 1;
                break;
            }
            _ => return None,
        }
    }
    if !seen_sep {
        return None;
    }
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }
    if i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'') {
        i += 1;
    }
    // value must be a run of ≥8 visible, non-quote chars
    let mut n = 0usize;
    for c in after_kw[i..].chars() {
        if c.is_ascii_graphic() && c != '"' && c != '\'' {
            n += 1;
        } else {
            break;
        }
    }
    if n >= 8 {
        Some(i)
    } else {
        None
    }
}

/// CLI glue for `wanyrix telemetry ingest`: read the stream (file or
/// stdin), build the redacted report, write it to `--out` or stdout.
pub fn ingest_run(
    input: &str,
    out: Option<&std::path::Path>,
    opts: &IngestOptions,
) -> Result<String, EngineError> {
    let text = if input == "-" {
        use std::io::Read;
        let mut buf = String::new();
        std::io::stdin()
            .read_to_string(&mut buf)
            .map_err(|e| EngineError::Telemetry(format!("cannot read stream from stdin: {e}")))?;
        buf
    } else {
        std::fs::read_to_string(input).map_err(|e| {
            EngineError::Telemetry(format!("cannot read telemetry input {}: {e}", input))
        })?
    };
    let source_label = if input == "-" {
        "<stdin>".to_owned()
    } else {
        input.to_owned()
    };
    let report = ingest_text(&text, &source_label, opts);
    let serialized = serde_json::to_string_pretty(&report)
        .map_err(|e| EngineError::Json(format!("telemetry report serialization failed: {e}")))?;
    match out {
        Some(path) => {
            if let Some(parent) = path.parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent).map_err(|e| {
                        EngineError::Telemetry(format!(
                            "cannot create output directory {}: {e}",
                            parent.display()
                        ))
                    })?;
                }
            }
            std::fs::write(path, serialized).map_err(|e| {
                EngineError::Telemetry(format!("cannot write telemetry report {}: {e}", path.display()))
            })?;
            Ok(format!(
                "wanyrix telemetry ingest — {} non-empty line(s) from {}\n  diagnostics: {} (other lines: {}, malformed: {})\n  errors: {} · warnings: {} · distinct codes: {}\n  redaction: policy {} applied — source snippets dropped, secrets scrubbed: {}\n  report: {}\n",
                report.meta.lines_read,
                report.meta.source,
                report.summary.diagnostic_lines,
                report.summary.other_lines,
                report.summary.malformed_lines,
                report.summary.errors,
                report.summary.warnings,
                report.summary.distinct_codes,
                REDACTION_POLICY,
                report.redaction.secrets_scrubbed,
                path.display(),
            ))
        }
        None => Ok(serialized),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GHP: &str = "ghp_0123456789abcdefABCDEF0123456789abcd"; // ghp_ + 36
    const AKIA: &str = "AKIAIOSFODNN7EXAMPLE"; // AKIA + 16
    const JWT: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

    fn wrapped(message: &str) -> String {
        // Built with serde_json so embedded quotes in the message can never
        // corrupt the fixture itself.
        serde_json::json!({
            "reason": "compiler-message",
            "message": {
                "level": "error",
                "message": message,
                "code": {"code": "E0382"},
                "rendered": "RENDERED-SNIPPET let x = secretvalue123;",
                "spans": [{
                    "file_name": "/home/z/proj/src/main.rs",
                    "line_start": 5, "line_end": 5,
                    "column_start": 9, "column_end": 20,
                    "is_primary": true,
                    "text": [{"text": "let x = secretvalue123;", "highlight_start": 5, "highlight_end": 9}],
                    "suggested_replacement": "let x = safevalue123;"
                }],
                "children": [{"level": "help", "message": "child note", "rendered": null}]
            }
        })
        .to_string()
    }

    #[test]
    fn wrapper_raw_and_non_diagnostic_lines_are_classified_honestly() {
        let raw = r#"{"$message_type":"diagnostic","level":"warning","message":"unused import","spans":[],"children":[]}"#;
        let artifact = r#"{"reason":"compiler-artifact","target":{"name":"x"},"fresh":true}"#;
        let stream = format!("{}\n{}\n{}\nnot json\n\n", wrapped("boom"), raw, artifact);
        let report = ingest_text(&stream, "test", &IngestOptions::default());
        assert_eq!(report.meta.lines_read, 4, "blank lines are not counted");
        assert_eq!(report.summary.diagnostic_lines, 2);
        assert_eq!(report.summary.other_lines, 1);
        assert_eq!(report.summary.malformed_lines, 1);
        assert_eq!(report.summary.errors, 1);
        assert_eq!(report.summary.warnings, 1);
        assert_eq!(report.summary.distinct_codes, 1);
        assert_eq!(report.by_code[0].code, "E0382");
        assert_eq!(report.by_code[0].count, 1);
        assert_eq!(report.by_file[0].file, "main.rs");
        assert_eq!(report.by_file[0].count, 1);
    }

    #[test]
    fn redaction_drops_source_snippets_unconditionally() {
        let report = ingest_text(&wrapped("boom"), "test", &IngestOptions::default());
        let diag = &report.diagnostics.as_ref().unwrap()[0];
        let out = serde_json::to_string(diag).unwrap();
        assert!(!out.contains("RENDERED-SNIPPET"), "rendered carries the annotated snippet");
        assert!(!out.contains("secretvalue123"), "span text is the source line itself");
        assert!(!out.contains("safevalue123"), "suggested_replacement is source text");
        assert!(!out.contains("/home/z/proj"), "paths are reduced to basenames by default");
        assert!(report.redaction.paths_reduced);
        let span = &diag["spans"][0];
        assert_eq!(span["file"], "main.rs");
        assert!(span.get("text").is_none(), "spans[].text must be dropped");
        assert_eq!(span["lineStart"], 5);
        assert_eq!(span["isPrimary"], true);
        let child = &diag["children"][0];
        assert_eq!(child["message"], "child note");
        assert!(child.get("rendered").is_none());
    }

    #[test]
    fn keep_paths_widens_file_names_but_never_snippets() {
        let report = ingest_text(&wrapped("boom"), "test", &IngestOptions { keep_paths: true, ..Default::default() });
        let diag = &report.diagnostics.as_ref().unwrap()[0];
        let out = serde_json::to_string(diag).unwrap();
        assert!(out.contains("/home/z/proj/src/main.rs"));
        assert!(!out.contains("secretvalue123"), "--keep-paths can never restore snippets");
        assert!(!report.redaction.paths_reduced);
    }

    #[test]
    fn summary_only_omits_the_diagnostics_array() {
        let report = ingest_text(&wrapped("boom"), "test", &IngestOptions { summary_only: true, ..Default::default() });
        assert!(report.diagnostics.is_none());
        assert_eq!(report.summary.diagnostic_lines, 1, "counts are still measured");
        assert_eq!(report.by_code[0].code, "E0382");
    }

    #[test]
    fn every_secret_shape_is_scrubbed_and_counted() {
        let shapes = [
            GHP.to_owned(),
            "github_pat_11ABCDEFGH0123456789_abcdEFG".to_owned(),
            format!("aws id {AKIA} in prose"),
            "xoxb-123456789-abcdefghij".to_owned(),
            "sk-abcdefghijklmnopqrstuvwxyz".to_owned(),
            "sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456".to_owned(),
            format!("auth: Bearer {JWT}").to_lowercase(), // case-insensitive header
            format!("token {JWT}"),
            "-----BEGIN RSA PRIVATE KEY-----".to_owned(),
            "password=hunter2hunter2".to_owned(),
            "api_key = \"supersecretvalue123\"".to_owned(),
        ];
        for shape in shapes {
            let stream = wrapped(&format!("leak {shape}"));
            let report = ingest_text(&stream, "test", &IngestOptions::default());
            let out = serde_json::to_string(&report).unwrap();
            assert!(!out.contains(&shape), "shape must be scrubbed: {shape}");
            let diag = &report.diagnostics.as_ref().unwrap()[0];
            let msg = diag["message"].as_str().unwrap();
            assert!(msg.contains("[redacted"), "scrubbed form is labeled: {msg}");
            assert!(report.redaction.secrets_scrubbed >= 1, "count reflects reality for {shape}");
        }
    }

    #[test]
    fn prose_that_merely_mentions_keywords_is_not_redacted() {
        let cases = [
            "expected token `let`, found `fn`",
            "the secret to fast builds is measuring them",
            "task-12345678901234567890 is not a token",
            "unbearably slow",
        ];
        for case in cases {
            let (out, count) = scrub_secrets(case);
            assert_eq!(out, case, "false positive: {case}");
            assert_eq!(count, 0);
        }
    }

    #[test]
    fn scrub_secrets_is_exact_for_each_shape() {
        let (out, count) = scrub_secrets(&format!("id={GHP} id={AKIA} j={JWT}"));
        assert_eq!(count, 3);
        assert_eq!(out, "id=[redacted:github-token] id=[redacted:aws-key] j=[redacted:jwt]");
        let (out, count) = scrub_secrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789");
        assert_eq!(count, 1);
        assert_eq!(out, "Authorization: Bearer [redacted]");
        let (out, count) = scrub_secrets("-----BEGIN OPENSSH PRIVATE KEY-----b3BlbnNzaC1rZXktdjEAAAAA");
        assert_eq!(count, 1);
        assert_eq!(out, "[redacted:private-key]b3BlbnNzaC1rZXktdjEAAAAA");
    }

    #[test]
    fn aggregates_are_sorted_and_consistent_with_the_diagnostics() {
        let stream = format!(
            "{}\n{}\n{}\n",
            wrapped("one"),
            wrapped("two"),
            r#"{"reason":"compiler-message","message":{"level":"warning","message":"warn","code":{"code":"E0308"},"spans":[],"children":[]}}"#
        );
        let report = ingest_text(&stream, "test", &IngestOptions::default());
        assert!(report.by_code.windows(2).all(|w| w[0].code < w[1].code), "BTreeMap order ⇒ sorted codes");
        assert!(report.by_file.windows(2).all(|w| w[0].file <= w[1].file));
        let code_total: usize = report.by_code.iter().map(|c| c.count).sum();
        assert_eq!(report.summary.diagnostic_lines - report.summary.no_code, code_total);
        assert_eq!(report.summary.errors, 2);
        assert_eq!(report.summary.warnings, 1);
        assert_eq!(report.summary.distinct_codes, 2);
    }

    #[test]
    fn determinism_identical_input_identical_report_except_generated_at() {
        let stream = format!("{}\n{}\n", wrapped("boom"), "malformed line");
        let a = serde_json::to_string(&ingest_text(&stream, "in", &IngestOptions::default())).unwrap();
        let b = serde_json::to_string(&ingest_text(&stream, "in", &IngestOptions::default())).unwrap();
        let strip = |s: &str| s.split(r#","generatedAt":"#).next().unwrap().to_owned();
        assert_eq!(strip(&a), strip(&b), "only generatedAt may differ");
        assert!(a.ends_with("\"}"), "generatedAt is the last member");
    }

    #[test]
    fn empty_stream_is_an_all_zero_measured_report() {
        let report = ingest_text("", "empty", &IngestOptions::default());
        assert_eq!(report.meta.lines_read, 0);
        assert_eq!(report.summary.diagnostic_lines, 0);
        assert_eq!(report.summary.malformed_lines, 0);
        assert_eq!(report.diagnostics.as_ref().unwrap().len(), 0);
        assert_eq!(report.redaction.secrets_scrubbed, 0);
    }

    #[test]
    fn schema_and_policy_strings_are_versioned() {
        assert_eq!(TELEMETRY_SCHEMA, "wanyrix.telemetry/v1");
        assert_eq!(REDACTION_POLICY, "wanyrix.telemetry-redaction/v1");
        let report = ingest_text(&wrapped("x"), "t", &IngestOptions::default());
        assert_eq!(report.schema, TELEMETRY_SCHEMA);
        assert_eq!(report.redaction.policy, REDACTION_POLICY);
        assert!(report.redaction.applied, "redaction is default-on, not optional");
    }

    #[test]
    fn ice_level_is_counted_as_error_and_ice() {
        let stream = r#"{"$message_type":"diagnostic","level":"error: internal compiler error","message":"unexpected panic","spans":[],"children":[]}"#;
        let report = ingest_text(stream, "t", &IngestOptions::default());
        assert_eq!(report.summary.errors, 1);
        assert_eq!(report.summary.ice, 1);
        assert_eq!(report.summary.no_code, 1);
    }

    #[test]
    fn other_levels_are_counted_never_reclassified() {
        let stream = r#"{"$message_type":"diagnostic","level":"failure-note","message":"note","spans":[],"children":[]}"#;
        let report = ingest_text(stream, "t", &IngestOptions::default());
        assert_eq!(report.summary.other_levels, 1);
        assert_eq!(report.summary.errors, 0);
        assert_eq!(report.summary.warnings, 0);
    }
}
