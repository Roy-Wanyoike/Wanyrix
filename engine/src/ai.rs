//! Local-AI explanation surface — `wanyrix.ai/v1` (commercial queue #66, item 8).
//!
//! `wanyrix ai` asks a LOCAL model server (Ollama-class `POST /api/generate`)
//! a question about this workspace, grounded ONLY on measured evidence from a
//! real scan — the same `scan_workspace` + `analyze` pass every other surface
//! uses. The honesty/privacy contract of this module:
//!
//! - **Digest-only transmission**: the ONLY thing ever put on the wire is the
//!   evidence digest — finding ids/severities/titles and severity counts. No
//!   source code, no file contents, no finding descriptions, no file paths,
//!   no recommendation text ever leaves the machine.
//! - **Local + user-invoked**: the request goes to a loopback/local server
//!   the user pointed at (CLI arg → `$WANYRIX_AI_ENDPOINT` → the Ollama
//!   default). Transmission happens because the user invoked `wanyrix ai`,
//!   and the report's `note` says exactly that — never a silent phone-home.
//! - **Inference, labeled**: model output is stored verbatim as `response`.
//!   It is never a measurement, never verification, never engine output; the
//!   prompt demands FACT / INFERENCE / RECOMMENDATION / UNCERTAINTY labeling.
//! - **Named errors**: unreachable endpoint, read/write timeout, HTTP ≥ 400
//!   (with a body snippet), malformed JSON, or a reply without the
//!   `response` field — every failure carries its transport detail verbatim,
//!   nothing is swallowed or retried.
//!
//! Transport: a minimal HTTP/1.1 client over [`std::net::TcpStream`] — no new
//! dependencies (the engine's dependency policy stays minimal). POST +
//! `Content-Length` + `Connection: close`, plus chunked-body decoding since
//! Ollama-class servers may answer `Transfer-Encoding: chunked`. TLS is NOT
//! spoken, and the client is HONEST about it: an `https://` endpoint is
//! REFUSED up front with a named error (issue #89, A1-F7) instead of being
//! silently downgraded to plain TCP — an operator who asks for https wants
//! TLS, and pretending plain HTTP on port 443 is https would be a lie. The
//! honest fit for a local model server is plain HTTP on the loopback or LAN;
//! `http://` and bare `host:port` forms are accepted.

use std::io::{Read, Write as _};
use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use crate::analysis::{analyze, Finding};
use crate::cli::serialize_json;
use crate::model::{EngineError, WorkspaceScan};
use crate::scan::scan_workspace;
use crate::timestamp::iso8601_now;

/// Schema of the `wanyrix ai` report envelope.
pub const AI_SCHEMA: &str = "wanyrix.ai/v1";
/// Default local model server address (Ollama's).
pub const DEFAULT_ENDPOINT: &str = "127.0.0.1:11434";
/// Default model name requested from the local server.
pub const DEFAULT_MODEL: &str = "llama3.2";
/// The fixed Ollama-class target the client POSTs to.
pub const GENERATE_TARGET: &str = "/api/generate";

/// Honesty note carried verbatim in every report (and the human flavor).
pub const AI_NOTE: &str = "Model output is inference over the measured evidence digest above — never a measurement and never verification. No source code was transmitted; only the evidence digest. Transmission happened because you invoked `wanyrix ai`.";

/// Digest cap: at most this many findings travel, ordered like doctor's
/// output (severity → id), so giant workspaces bound the payload.
const MAX_DIGEST_FINDINGS: usize = 12;

/// One digest line: id + severity + title and NOTHING else (the privacy
/// rule — descriptions, evidence values and paths stay on the machine).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiDigestEntry {
    pub id: String,
    pub severity: String,
    pub title: String,
}

/// The measured evidence a question is grounded on. Every field is measured
/// from the real scan; nothing is estimated or invented.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEvidence {
    pub crates: usize,
    pub critical: usize,
    pub warning: usize,
    pub info: usize,
    pub findings_used: usize,
    pub digest: Vec<AiDigestEntry>,
}

/// `wanyrix.ai/v1` — the local-AI report. Field order matters: `generatedAt`
/// is declared LAST (the honesty contract keeps timestamps last in every
/// envelope).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiReport {
    pub schema: String,
    pub workspace: String,
    /// The resolved host:port the request was actually sent to.
    pub endpoint: String,
    pub model: String,
    /// The question, echoed verbatim.
    pub question: String,
    pub evidence: AiEvidence,
    /// The model's reply, verbatim — inference, never a measurement.
    pub response: String,
    pub note: String,
    /// LAST key — the only non-deterministic field.
    pub generated_at: String,
}

const PROMPT_HEAD: &str = "\
You are the Wanyrix local analysis assistant. You are given MEASURED evidence
from a deterministic static analysis of a Rust workspace. Rules:
- Treat the evidence as FACT. Anything beyond it is INFERENCE and must be
  labeled as such.
- Never invent files, crates, dependencies, measurements, or numbers that are
  not in the evidence.
- Structure your answer with the labels FACT / INFERENCE / RECOMMENDATION /
  UNCERTAINTY where applicable.
- Be concise and concrete.

MEASURED EVIDENCE (JSON):
";

const PROMPT_QUESTION_HEAD: &str = "\n\nQUESTION:\n";

/// Build the grounding prompt: honesty framing + the measured evidence
/// digest + the user's question, verbatim.
pub fn build_prompt(question: &str, evidence_json: &str) -> String {
    let mut prompt = String::from(PROMPT_HEAD);
    prompt.push_str(evidence_json);
    prompt.push_str(PROMPT_QUESTION_HEAD);
    prompt.push_str(question);
    prompt.push('\n');
    prompt
}

/// Build the evidence digest from a scan + its doctor findings. The digest
/// carries id/severity/title only — no descriptions, no evidence values,
/// no file paths (enforced by [`AiDigestEntry`]'s shape and by tests).
fn build_evidence(scan: &WorkspaceScan, findings: &[Finding]) -> AiEvidence {
    let digest: Vec<AiDigestEntry> = findings
        .iter()
        .take(MAX_DIGEST_FINDINGS)
        .map(|f| AiDigestEntry {
            id: f.id.clone(),
            severity: f.severity.to_owned(),
            title: f.title.clone(),
        })
        .collect();
    AiEvidence {
        crates: scan.crates.len(),
        critical: findings.iter().filter(|f| f.severity == "critical").count(),
        warning: findings.iter().filter(|f| f.severity == "warning").count(),
        info: findings.iter().filter(|f| f.severity == "info").count(),
        findings_used: digest.len(),
        digest,
    }
}

/// Resolve endpoint: CLI arg → `$WANYRIX_AI_ENDPOINT` → the Ollama default.
/// Resolution happens in `ai_explain`; this parses one address.
///
/// Accepts `host:port`, bare `host` (default port 11434), and `http://`
/// prefixed forms. An `https://` endpoint is REFUSED with a named error:
/// the built-in client speaks plain HTTP only (TLS is not implemented), and
/// silently stripping the scheme would dishonor an operator who explicitly
/// asked for TLS (issue #89, A1-F7). Garbage (empty host, whitespace, a
/// path, a non-numeric port) is a NAMED error, never a fallback guess.
pub fn resolve_endpoint(raw: &str) -> Result<(String, u16), EngineError> {
    let malformed = || {
        EngineError::Ai(format!(
            "cannot parse AI endpoint {raw:?} — expected host:port or http://host:port (e.g. {DEFAULT_ENDPOINT})"
        ))
    };
    if raw.starts_with("https://") {
        return Err(EngineError::Ai(format!(
            "AI endpoint {raw:?} uses https:// — the built-in client speaks plain HTTP only (no TLS support; local model servers do not need it). Pass an http:// or bare host:port endpoint instead."
        )));
    }
    let rest = raw.strip_prefix("http://").unwrap_or(raw);
    let (host, port) = match rest.rsplit_once(':') {
        Some((h, p)) => (h, p),
        None => (rest, ""),
    };
    if host.is_empty() || host.contains([' ', '\t', '\n', '\r']) || host.contains('/') {
        return Err(malformed());
    }
    let port = if port.is_empty() {
        11434
    } else {
        port.parse::<u16>().map_err(|_| malformed())?
    };
    Ok((host.to_owned(), port))
}

/// `wanyrix ai` — scan, digest the measured evidence, ask the local model.
pub fn ai_explain(
    root: &Path,
    question: &str,
    endpoint: Option<String>,
    model: Option<String>,
    timeout: Duration,
) -> Result<AiReport, EngineError> {
    // MEASURED evidence only: the same real scan + doctor pass as doctor.
    let scan = scan_workspace(root)?;
    let findings = analyze(&scan);
    let evidence = build_evidence(&scan, &findings);

    let endpoint_raw = endpoint
        .or_else(|| std::env::var("WANYRIX_AI_ENDPOINT").ok())
        .unwrap_or_else(|| DEFAULT_ENDPOINT.to_owned());
    let (host, port) = resolve_endpoint(&endpoint_raw)?;
    let endpoint_resolved = format!("{host}:{port}");

    let model = model
        .or_else(|| std::env::var("WANYRIX_AI_MODEL").ok())
        .unwrap_or_else(|| DEFAULT_MODEL.to_owned());

    let evidence_json = serialize_json(&evidence, false)?;
    let prompt = build_prompt(question, &evidence_json);
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
    })
    .to_string();

    let (status, reply) = post_json(&host, port, GENERATE_TARGET, &body, timeout)?;

    if status >= 400 {
        let snippet: String = reply.chars().take(300).collect();
        return Err(EngineError::Ai(format!(
            "local model server returned HTTP {status}: {snippet}"
        )));
    }

    let value: serde_json::Value = serde_json::from_str(&reply).map_err(|e| {
        EngineError::Ai(format!(
            "local model server returned malformed JSON ({e}) — expected an Ollama-compatible /api/generate reply"
        ))
    })?;
    let response = value
        .get("response")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| {
            EngineError::Ai(
                "local model server reply has no `response` field — not an Ollama-compatible /api/generate response"
                    .to_owned(),
            )
        })?
        .to_owned();

    Ok(AiReport {
        schema: AI_SCHEMA.to_owned(),
        workspace: scan.workspace_name,
        endpoint: endpoint_resolved,
        model,
        question: question.to_owned(),
        evidence,
        response,
        note: AI_NOTE.to_owned(),
        generated_at: iso8601_now(),
    })
}

/// Minimal HTTP/1.1 POST over TCP: one request, read to EOF, split headers,
/// decode a chunked body when announced. Returns (status code, body).
pub fn post_json(
    host: &str,
    port: u16,
    target: &str,
    body: &str,
    timeout: Duration,
) -> Result<(u16, String), EngineError> {
    let mut stream = std::net::TcpStream::connect((host, port)).map_err(|e| {
        EngineError::Ai(format!(
            "local AI endpoint {host}:{port} is unreachable ({e}) — start a local model server (e.g. `ollama serve`) or pass --endpoint"
        ))
    })?;
    stream.set_read_timeout(Some(timeout)).map_err(|e| {
        EngineError::Ai(format!(
            "cannot set read timeout on the local AI connection: {e}"
        ))
    })?;
    stream.set_write_timeout(Some(timeout)).map_err(|e| {
        EngineError::Ai(format!(
            "cannot set write timeout on the local AI connection: {e}"
        ))
    })?;

    let request = format!(
        "POST {target} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).map_err(|e| {
        EngineError::Ai(format!(
            "cannot send the request to local AI endpoint {host}:{port}: {e}"
        ))
    })?;
    stream.flush().map_err(|e| {
        EngineError::Ai(format!(
            "cannot flush the request to local AI endpoint {host}:{port}: {e}"
        ))
    })?;

    let mut raw = Vec::new();
    if let Err(e) = stream.read_to_end(&mut raw) {
        if matches!(
            e.kind(),
            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
        ) {
            return Err(EngineError::Ai(format!(
                "local AI endpoint {host}:{port} did not respond within {}s",
                timeout.as_secs()
            )));
        }
        return Err(EngineError::Ai(format!(
            "cannot read the response from local AI endpoint {host}:{port}: {e}"
        )));
    }

    let header_end = find_sub(&raw, b"\r\n\r\n").ok_or_else(|| {
        EngineError::Ai(format!(
            "local AI endpoint {host}:{port} returned no HTTP header block"
        ))
    })?;
    let head = String::from_utf8_lossy(&raw[..header_end]).into_owned();
    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| {
            EngineError::Ai(format!(
                "local AI endpoint {host}:{port} returned an unparseable HTTP status line: {status_line:?}"
            ))
        })?;
    let chunked = lines
        .filter_map(|line| line.split_once(':'))
        .any(|(key, value)| {
            key.trim().eq_ignore_ascii_case("transfer-encoding")
                && value.to_ascii_lowercase().contains("chunked")
        });

    let body_bytes = &raw[header_end + 4..];
    let body = if chunked {
        String::from_utf8_lossy(&decode_chunked(body_bytes, host, port)?).into_owned()
    } else {
        String::from_utf8_lossy(body_bytes).into_owned()
    };
    Ok((status, body))
}

/// First occurrence of `needle` in `haystack` (byte-exact window search).
fn find_sub(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Split `buf` at the first CRLF: (before, after).
fn split_at_crlf(buf: &[u8]) -> Option<(&[u8], &[u8])> {
    let pos = find_sub(buf, b"\r\n")?;
    Some((&buf[..pos], &buf[pos + 2..]))
}

/// Decode a chunked Transfer-Encoding body: hex size line, data, trailing
/// CRLF, `0`-size terminator. Byte-exact — chunk framing is bytes, not
/// chars, so a chunk boundary splitting a UTF-8 sequence is harmless here.
fn decode_chunked(raw: &[u8], host: &str, port: u16) -> Result<Vec<u8>, EngineError> {
    let mut out = Vec::new();
    let mut rest = raw;
    loop {
        let Some((size_line, after)) = split_at_crlf(rest) else {
            return Err(EngineError::Ai(format!(
                "local AI endpoint {host}:{port} returned a truncated chunked response (no chunk-size line)"
            )));
        };
        let size_text = std::str::from_utf8(size_line).map_err(|_| {
            EngineError::Ai(format!(
                "local AI endpoint {host}:{port} returned a non-ASCII chunk-size line"
            ))
        })?;
        //extensions like `1a;name=...` are tolerated — the hex size leads
        let size_text = size_text.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_text, 16).map_err(|_| {
            EngineError::Ai(format!(
                "local AI endpoint {host}:{port} returned a malformed chunk size {size_text:?}"
            ))
        })?;
        if size == 0 {
            return Ok(out);
        }
        if after.len() < size {
            return Err(EngineError::Ai(format!(
                "local AI endpoint {host}:{port} returned a truncated chunk ({size} bytes announced, {} available)",
                after.len()
            )));
        }
        out.extend_from_slice(&after[..size]);
        rest = match split_at_crlf(&after[size..]) {
            Some((_, after_crlf)) => after_crlf,
            None => {
                return Err(EngineError::Ai(format!(
                    "local AI endpoint {host}:{port} returned a truncated chunked response (missing chunk terminator)"
                )))
            }
        };
    }
}

/// `wanyrix ai` — human summary (deterministic; response verbatim).
pub fn ai_human(r: &AiReport) -> String {
    let mut out = String::new();
    out.push_str(&format!("Wanyrix local AI — {AI_SCHEMA}\n"));
    out.push_str(&format!(
        "workspace: {} (crates: {})\n",
        r.workspace, r.evidence.crates
    ));
    out.push_str(&format!(
        "evidence: {} critical · {} warning · {} info (digest: {} findings)\n",
        r.evidence.critical, r.evidence.warning, r.evidence.info, r.evidence.findings_used
    ));
    out.push_str(&format!("endpoint: {} · model: {}\n", r.endpoint, r.model));
    out.push_str(&format!("note: {}\n", r.note));
    out.push('\n');
    out.push_str(&r.response);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{SocketAddr, TcpListener};
    use std::sync::mpsc::{channel, Receiver};
    use std::thread::JoinHandle;

    fn tmpdir(label: &str) -> std::path::PathBuf {
        let base = std::env::temp_dir();
        let p = base.join(format!("wanyrix-ai-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    /// Minimal one-crate workspace (mirrors the `analysis` tests' hand-rolled
    /// fixture): a virtual root manifest + one package that intentionally
    /// lacks license/description so doctor has measured findings to digest,
    /// plus a source file whose unique marker must NEVER appear in any
    /// transmission (the privacy gate).
    fn write_workspace(root: &Path) {
        let crate_dir = root.join("solo");
        std::fs::create_dir_all(crate_dir.join("src")).unwrap();
        std::fs::write(
            root.join("Cargo.toml"),
            "[workspace]\nmembers = [\"solo\"]\n",
        )
        .unwrap();
        std::fs::write(
            crate_dir.join("Cargo.toml"),
            "[package]\nname = \"solo\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        std::fs::write(
            crate_dir.join("src").join("lib.rs"),
            "pub fn ai_source_marker_must_never_travel() -> u32 { 4104 }\n",
        )
        .unwrap();
    }

    /// Spawn a one-shot mock Ollama server: accept ONE connection, read the
    /// request until headers end + the announced Content-Length, hand the
    /// captured request to the returned receiver, reply with `reply`, close.
    fn spawn_mock_reply(reply: String) -> (SocketAddr, Receiver<String>, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = channel();
        let handle = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let n = conn.read(&mut chunk).unwrap_or(0);
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
                if let Some(pos) = find_sub(&buf, b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&buf[..pos]).to_ascii_lowercase();
                    let len = head
                        .lines()
                        .find_map(|l| l.strip_prefix("content-length:"))
                        .and_then(|v| v.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if buf.len() >= pos + 4 + len {
                        break;
                    }
                }
            }
            let _ = tx.send(String::from_utf8_lossy(&buf).into_owned());
            let _ = conn.write_all(reply.as_bytes());
            let _ = conn.flush();
            // conn dropped → closed → the client's read_to_end returns
        });
        (addr, rx, handle)
    }

    /// A well-formed JSON reply with Content-Length framing.
    fn spawn_mock(
        status_line: &'static str,
        body: &'static str,
    ) -> (SocketAddr, Receiver<String>, JoinHandle<()>) {
        let reply = format!(
            "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        spawn_mock_reply(reply)
    }

    #[test]
    fn ai_explain_grounds_on_measured_digest_and_transmits_only_the_digest() {
        let ws = tmpdir("e2e");
        write_workspace(&ws);
        let (addr, rx, handle) = spawn_mock(
            "HTTP/1.1 200 OK",
            "{\"model\":\"m\",\"response\":\"REPLY-VERBATIM-CANNED\",\"done\":true}",
        );

        let r = ai_explain(
            &ws,
            "What matters most?",
            Some(addr.to_string()),
            Some("test-model".to_owned()),
            Duration::from_secs(10),
        )
        .unwrap();

        assert_eq!(r.schema, AI_SCHEMA);
        assert_eq!(r.response, "REPLY-VERBATIM-CANNED");
        assert!(r.evidence.crates >= 1, "evidence counts the real scan");
        assert!(
            r.evidence.findings_used >= 1,
            "digest carries real findings"
        );
        assert_eq!(r.evidence.critical, 0);
        assert_eq!(r.evidence.warning, r.evidence.findings_used);
        assert_eq!(r.model, "test-model");
        assert_eq!(r.endpoint, addr.to_string());
        assert_eq!(r.question, "What matters most?");
        assert_eq!(r.note, AI_NOTE);
        assert!(r.generated_at.ends_with('Z'), "ISO-8601 UTC timestamp");

        // What the mock actually received: honesty framing + digest +
        // question — and NEVER the source code, paths or descriptions.
        let request = rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(request.contains("POST /api/generate"));
        assert!(request.contains("What matters most?"), "question travels");
        assert!(request.contains("MEASURED EVIDENCE (JSON)"));
        assert!(
            request.contains("Never invent files, crates, dependencies"),
            "honesty framing travels"
        );
        assert!(
            request.contains("FER-ENG-001-solo"),
            "digest ids travel by design"
        );
        assert!(
            !request.contains("ai_source_marker_must_never_travel"),
            "source code must never travel"
        );
        assert!(
            !request.contains("Cargo.toml"),
            "file paths must never travel"
        );
        assert!(
            !request.contains("src/lib.rs"),
            "file paths must never travel"
        );
        assert!(
            !request.contains("[package]"),
            "manifest contents must never travel"
        );
        handle.join().unwrap();
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn generated_at_is_the_last_serialized_field() {
        let r = AiReport {
            schema: AI_SCHEMA.to_owned(),
            workspace: "ws".to_owned(),
            endpoint: "127.0.0.1:11434".to_owned(),
            model: DEFAULT_MODEL.to_owned(),
            question: "q?".to_owned(),
            evidence: AiEvidence {
                crates: 1,
                critical: 0,
                warning: 1,
                info: 0,
                findings_used: 1,
                digest: vec![AiDigestEntry {
                    id: "FER-ENG-001-solo".to_owned(),
                    severity: "warning".to_owned(),
                    title: "t".to_owned(),
                }],
            },
            response: "FACT: …".to_owned(),
            note: AI_NOTE.to_owned(),
            generated_at: "2026-01-01T00:00:00Z".to_owned(),
        };
        let s = serialize_json(&r, false).unwrap();
        let tail = &s[s.len().saturating_sub(60)..];
        assert!(
            tail.contains("\"generatedAt\":\""),
            "timestamp must trail the envelope: {s}"
        );
        assert!(s.starts_with("{\"schema\":\"wanyrix.ai/v1\",\"workspace\":\"ws\""));
        assert!(s.ends_with('}'));
    }

    #[test]
    fn unreachable_endpoint_is_a_named_error() {
        let ws = tmpdir("unreachable");
        write_workspace(&ws);
        let err = ai_explain(
            &ws,
            "q?",
            Some("127.0.0.1:1".to_owned()),
            None,
            Duration::from_secs(2),
        )
        .unwrap_err();
        match err {
            EngineError::Ai(msg) => {
                assert!(
                    msg.contains("unreachable"),
                    "named transport detail, got: {msg}"
                );
                assert!(msg.contains("127.0.0.1:1"), "endpoint named, got: {msg}");
            }
            other => panic!("expected EngineError::Ai, got: {other:?}"),
        }
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn http_error_status_names_the_code_and_body() {
        let ws = tmpdir("http500");
        write_workspace(&ws);
        let (addr, _rx, handle) = spawn_mock(
            "HTTP/1.1 500 Internal Server Error",
            "{\"error\":\"model x not found\"}",
        );
        let err = ai_explain(
            &ws,
            "q?",
            Some(addr.to_string()),
            None,
            Duration::from_secs(10),
        )
        .unwrap_err();
        match err {
            EngineError::Ai(msg) => {
                assert!(msg.contains("500"), "status named, got: {msg}");
                assert!(
                    msg.contains("model x not found"),
                    "body snippet kept, got: {msg}"
                );
            }
            other => panic!("expected EngineError::Ai, got: {other:?}"),
        }
        handle.join().unwrap();
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn malformed_json_reply_is_a_named_error() {
        let ws = tmpdir("malformed");
        write_workspace(&ws);
        let (addr, _rx, handle) = spawn_mock("HTTP/1.1 200 OK", "not json");
        let err = ai_explain(
            &ws,
            "q?",
            Some(addr.to_string()),
            None,
            Duration::from_secs(10),
        )
        .unwrap_err();
        match err {
            EngineError::Ai(msg) => assert!(msg.contains("malformed"), "got: {msg}"),
            other => panic!("expected EngineError::Ai, got: {other:?}"),
        }
        handle.join().unwrap();
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn reply_without_response_field_is_a_named_error() {
        let ws = tmpdir("noresponse");
        write_workspace(&ws);
        let (addr, _rx, handle) = spawn_mock("HTTP/1.1 200 OK", "{\"done\":true}");
        let err = ai_explain(
            &ws,
            "q?",
            Some(addr.to_string()),
            None,
            Duration::from_secs(10),
        )
        .unwrap_err();
        match err {
            EngineError::Ai(msg) => {
                assert!(msg.contains("`response`"), "got: {msg}");
                assert!(msg.contains("Ollama-compatible"), "got: {msg}");
            }
            other => panic!("expected EngineError::Ai, got: {other:?}"),
        }
        handle.join().unwrap();
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn chunked_transfer_encoding_is_decoded() {
        let ws = tmpdir("chunked");
        write_workspace(&ws);
        let inner = "{\"response\":\"chunked ok\",\"done\":true}";
        let mut reply = String::from(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
        );
        reply.push_str(&format!("{:x}\r\n{}\r\n", inner.len(), inner));
        reply.push_str("0\r\n\r\n");
        let (addr, _rx, handle) = spawn_mock_reply(reply);
        let r = ai_explain(
            &ws,
            "q?",
            Some(addr.to_string()),
            None,
            Duration::from_secs(10),
        )
        .unwrap();
        assert_eq!(r.response, "chunked ok");
        handle.join().unwrap();
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn resolve_endpoint_accepts_prefixed_bare_and_default_port_forms() {
        assert_eq!(
            resolve_endpoint("http://127.0.0.1:11434").unwrap(),
            ("127.0.0.1".to_owned(), 11434)
        );
        assert_eq!(
            resolve_endpoint("localhost:9999").unwrap(),
            ("localhost".to_owned(), 9999)
        );
        assert_eq!(
            resolve_endpoint("127.0.0.1").unwrap(),
            ("127.0.0.1".to_owned(), 11434),
            "no colon ⇒ Ollama default port"
        );
        assert_eq!(
            resolve_endpoint(DEFAULT_ENDPOINT).unwrap(),
            ("127.0.0.1".to_owned(), 11434)
        );
        // The https honesty refusal (issue #89, A1-F7): the scheme is never
        // silently stripped — an operator asking for TLS gets a named error.
        for https in [
            "https://example.com:8443",
            "https://127.0.0.1:11434",
            "https://ollama.local",
        ] {
            let err = resolve_endpoint(https).unwrap_err().to_string();
            assert!(
                err.contains("https") && err.contains("plain HTTP"),
                "{https}: refusal must name the scheme and the plain-HTTP truth, got: {err}"
            );
            assert!(
                err.contains("TLS"),
                "{https}: refusal must name TLS, got: {err}"
            );
        }
        for bad in [
            "",
            "host with spaces:1",
            "http://host/path",
            "127.0.0.1:notaport",
            ":8080",
        ] {
            assert!(resolve_endpoint(bad).is_err(), "must reject {bad:?}");
        }
    }
    #[test]
    fn evidence_digest_carries_only_id_severity_title() {
        let ws = tmpdir("privacy");
        write_workspace(&ws);
        let scan = scan_workspace(&ws).unwrap();
        let findings = analyze(&scan);
        let evidence = build_evidence(&scan, &findings);
        assert_eq!(evidence.crates, 1);
        assert_eq!(evidence.findings_used, findings.len());
        for entry in &evidence.digest {
            let v = serde_json::to_value(entry).unwrap();
            let keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
            assert_eq!(
                keys,
                vec!["id", "severity", "title"],
                "digest key set is closed"
            );
        }
        let full = serde_json::to_string(&evidence).unwrap();
        assert!(
            !full.contains("ai_source_marker_must_never_travel"),
            "no source code"
        );
        assert!(!full.contains("Cargo.toml"), "no file paths");
        assert!(!full.contains("src/lib.rs"), "no file paths");
        assert!(
            !full.contains("Publishing to crates.io is blocked"),
            "no finding description/recommendation prose"
        );
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn digest_is_capped_at_twelve_entries_in_doctor_order() {
        let ws = tmpdir("cap");
        crate::synth::synth(&ws, 8, 42).unwrap();
        let scan = scan_workspace(&ws).unwrap();
        let findings = analyze(&scan);
        assert!(
            findings.len() > MAX_DIGEST_FINDINGS,
            "fixture must exceed the cap to test it: {}",
            findings.len()
        );
        let evidence = build_evidence(&scan, &findings);
        assert_eq!(evidence.findings_used, MAX_DIGEST_FINDINGS);
        assert_eq!(evidence.digest.len(), MAX_DIGEST_FINDINGS);
        // digest order follows doctor's deterministic order (severity → id)
        assert_eq!(evidence.digest[0].id, findings[0].id);
        assert_eq!(evidence.digest[11].id, findings[11].id);
        std::fs::remove_dir_all(&ws).unwrap();
    }

    #[test]
    fn prompt_carries_framing_evidence_and_question_in_order() {
        let prompt = build_prompt("Why so slow?", "{\"crates\":3}");
        assert!(prompt.starts_with("You are the Wanyrix local analysis assistant."));
        assert!(prompt.contains("MEASURED EVIDENCE (JSON):\n{\"crates\":3}"));
        assert!(prompt.ends_with("\n\nQUESTION:\nWhy so slow?\n"));
    }
}
