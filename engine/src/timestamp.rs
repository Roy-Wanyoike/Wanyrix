//! Minimal UTC ISO-8601 timestamp formatting from `SystemTime`.
//!
//! Engine v1 avoids a date-time dependency: the conversion below is the
//! standard civil-from-days algorithm (Howard Hinnant / chrono), which is
//! exact for the full `u64` seconds-since-epoch range we need. No network,
//! no locale, no panics: a pre-epoch clock degrades to the epoch value
//! rather than aborting a scan (documented, honest fallback).

use std::time::{SystemTime, UNIX_EPOCH};

/// Current UTC time as `YYYY-MM-DDTHH:MM:SSZ` (RFC 3339 / ISO-8601).
pub fn iso8601_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        // A clock before 1970 is treated as the epoch rather than panicking
        // mid-scan; the emitted timestamp remains a valid ISO-8601 instant.
        .unwrap_or_default()
        .as_secs();
    iso8601_from_unix(secs)
}

/// Format seconds-since-Unix-epoch as `YYYY-MM-DDTHH:MM:SSZ`.
pub fn iso8601_from_unix(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = (secs % 86_400) as u32;
    let (y, m, d) = civil_from_days(days);
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// Days since 1970-01-01 → (year, month, day). Hinnant's algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch() {
        assert_eq!(iso8601_from_unix(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn known_instants() {
        assert_eq!(iso8601_from_unix(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(iso8601_from_unix(1_709_164_800), "2024-02-29T00:00:00Z");
        assert_eq!(iso8601_from_unix(1_700_000_000), "2023-11-14T22:13:20Z");
        assert_eq!(iso8601_from_unix(4_102_444_800), "2100-01-01T00:00:00Z");
        assert_eq!(iso8601_from_unix(1_789_738_136), "2026-09-18T13:28:56Z");
    }

    #[test]
    fn end_of_day_rollover() {
        assert_eq!(iso8601_from_unix(86_399), "1970-01-01T23:59:59Z");
        assert_eq!(iso8601_from_unix(86_400), "1970-01-02T00:00:00Z");
    }
}
