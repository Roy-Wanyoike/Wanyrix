//! Issue #94 E3 — privacy guardrail pin: the ENTITLEMENT ACTIVATION PATH
//! performs ZERO network I/O.
//!
//! Activation is signature-only, offline, by design: "only entitlements may
//! touch the cloud — never data" (docs/COMMERCIAL.md). This test scans the
//! whole `src/entitlement.rs` module — the file that contains the complete
//! activate → verify → cache → gate path — for ANY network API identifier.
//! If a `--fetch` revalidation mode ever lands, it must live OUTSIDE this
//! module (or this pin must be consciously reworked and documented), and
//! its outbound payload must be EXACTLY
//! `{license_key_hash, engine_version, timestamp}` — nothing else ever
//! leaves the machine.
//!
//! The banned literals live HERE (not in the scanned source) so the scan
//! cannot trivially match its own fixture list.
//!
//! Scan mechanics (both chosen so the pin survives honest prose):
//! - The network scan compares WHOLE identifier tokens, not raw substrings —
//!   the module legitimately talks about premium "surface"s (and
//!   `SURFACE_REGISTRY`), and a substring scan for `surf` would forever
//!   match its own vocabulary while matching nothing that matters.
//! - The doc-promise scan normalizes whitespace, so a rustfmt reflow or a
//!   manual comment wrap can never break the promise check.

use wanyrix_engine as _; // the crate must keep compiling for this pin to mean anything

const MODULE_SRC: &str = include_str!("../src/entitlement.rs");

const BANNED_NETWORK_IDENTIFIERS: &[&str] = &[
    // std socket APIs
    "TcpStream",
    "TcpListener",
    "UdpSocket",
    "ToSocketAddrs",
    "std::net",
    // third-party HTTP/transport clients
    "reqwest",
    "ureq",
    "hyper",
    "curl",
    "openssl",
    "attohttpc",
    "surf",
    "isahc",
];

/// Split the source into identifier-ish tokens (rust path/identifier
/// characters). A banned crate would appear as `use surf;` / `surf::get` /
/// `extern crate curl` — always as a whole token, never glued into a word.
fn identifier_tokens(src: &str) -> impl Iterator<Item = &str> {
    src.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == ':'))
        .filter(|t| !t.is_empty())
}

#[test]
fn entitlement_module_references_no_network_api() {
    for identifier in BANNED_NETWORK_IDENTIFIERS {
        assert!(
            !identifier_tokens(MODULE_SRC).any(|token| token == *identifier),
            "engine/src/entitlement.rs must not reference the network API '{identifier}' — \
             activation/verification is offline-only (issue #94 E3). If a --fetch mode lands, \
             document it, keep its outbound payload to exactly \
             {{license_key_hash, engine_version, timestamp}} and move it out of this module."
        );
    }
}

#[test]
fn entitlement_docs_still_promise_offline_verification() {
    // The operator-facing honesty notes must keep saying what the code does.
    // Comment markers are stripped and whitespace normalized first: comments
    // may wrap, promises may not.
    let prose = MODULE_SRC.replace("///", " ");
    let prose: String = prose.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(
        prose.contains("zero network I/O"),
        "the verification note must keep promising zero network I/O"
    );
    assert!(
        prose.contains("LOCAL wall clock"),
        "the clock note must keep naming the local-wall-clock honesty rule"
    );
    assert!(
        prose.contains("SWAPPED AT RELEASE SIGNING"),
        "the embedded dev key must stay labeled as swapped at release signing"
    );
}
