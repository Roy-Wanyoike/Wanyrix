//! Local-first subscription & entitlement layer (issue #94).
//!
//! A team may PAY for Wanyrix and use it locally. Only entitlements may
//! touch the cloud — never data — and this slice does not touch the cloud
//! at all: activation and verification are 100% OFFLINE (signature-only,
//! zero sockets opened; pinned by a source-level test below). The cloud
//! boundary of this feature is exactly one thing: a signed token file that
//! an operator receives out-of-band and activates locally.
//!
//! # Pieces
//!
//! - [`SignedToken`] — `wanyrix.entitlement.token/v1`: an ed25519-signed
//!   JSON token with plan/team/seats and DAY-COUNT expiry semantics
//!   (`issuedAtDay` + `expiryDay`, days since the Unix epoch — no timezone
//!   math, no fractional days, matching the repo's [`crate::timestamp`]
//!   time-honesty pattern).
//! - `wanyrix license keygen|issue` — maintainer tooling that mints
//!   keypairs and signs tokens. Private keys are NEVER committed to the
//!   repository; tests sign with ephemeral keypairs derived in-process from
//!   fixed 32-byte seeds.
//! - `wanyrix activate --key <path-or-literal>` — verifies the signature
//!   OFFLINE against the embedded release public key (dev key for now,
//!   swapped at release signing) and caches the token verbatim under
//!   `.wanyrix/entitlement.json` (the engine's own state-dir convention).
//! - `wanyrix entitlement [--json]` — the cached state as a
//!   `wanyrix.entitlement/v1` envelope (or an honest `not-activated`
//!   envelope when no license exists — the free tier is a real state, not
//!   an error).
//! - [`gate`] — the premium-surface gate + [`SURFACE_REGISTRY`] mapping
//!   surface → required plan. Honesty contract (docs/COMMERCIAL.md rule
//!   #1): core measured surfaces (doctor/graph/health/…) are NEVER gated —
//!   a no-license user keeps 100% of local functionality. `gate` returns
//!   success for any surface absent from the registry; premium surfaces
//!   MUST be registered there.
//!
//! # Honesty contract (this module)
//!
//! 1. Activation/verification performs ZERO network I/O. If a `--fetch`
//!    revalidation mode ever lands, its outbound payload must be EXACTLY
//!    `{license_key_hash, engine_version, timestamp}` (issue #94) — nothing
//!    else ever leaves the machine.
//! 2. Expired tokens refuse premium surfaces BY NAME; within the 30-day
//!    revalidation grace window premium surfaces keep working and the
//!    entitlement envelope carries a visible `grace` status.
//! 3. A tampered token/cache is a named signature refusal — never a silent
//!    pass, never a crash.
//! 4. No license is a normal state (`not-activated` envelope), never an
//!    error and never a crippled mode.
//! 5. Expiry/grace math reads the LOCAL wall clock (UTC day counts) and
//!    says so (`clockNote`); no server time is consulted.
//!
//! # Refusal shapes
//!
//! - Missing/deleted cache, or a plan below the required tier →
//!   [`EngineError::SubscriptionRequired`] (names the surface + plan).
//! - Expired beyond grace, tampered signature, corrupt cache →
//!   [`EngineError::Entitlement`] with the precise reason spelled out.
//!
//! # Dependency note (the tree's one deliberate deviation)
//!
//! `ed25519-dalek` (default features OFF) is the only non-hand-rolled
//! crypto in the engine. Hand-rolling ed25519 would trade real security
//! for tree size; the sha256 in [`crate::export`] stays hand-rolled
//! because a hash is auditable, signatures are not. Keygen randomness is
//! 32 bytes read from /dev/urandom via `std::fs` — no `rand` dependency.

use std::io::Read as _;
use std::path::{Path, PathBuf};

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::model::EngineError;
use crate::timestamp::iso8601_from_unix;

/// The entitlement READ envelope (`wanyrix entitlement --json`).
pub const ENTITLEMENT_SCHEMA: &str = "wanyrix.entitlement/v1";
/// The signed token artifact (`wanyrix license issue`).
pub const TOKEN_SCHEMA: &str = "wanyrix.entitlement.token/v1";
/// The on-disk cache written by `wanyrix activate` (token verbatim + receipt).
pub const CACHE_SCHEMA: &str = "wanyrix.entitlement.cache/v1";
/// Keygen report envelope (maintainer tooling).
pub const KEYGEN_SCHEMA: &str = "wanyrix.license-keygen/v1";
/// Token format version (bumped when the field set or algorithm changes).
pub const TOKEN_VERSION: u32 = 1;
/// Days a past-expiry entitlement still works, with a visible grace label.
pub const REVALIDATION_GRACE_DAYS: u64 = 30;
/// The engine's state dir name (same convention as store/exports/state.json).
pub const DIR_NAME: &str = ".wanyrix";
/// Cached activation file inside the state dir.
pub const CACHE_FILE: &str = "entitlement.json";
/// Embedded release public key (ed25519, hex). DEV key for now — SWAPPED AT RELEASE SIGNING
/// (docs/COMMERCIAL.md). Tokens are verified against this key (or the operator
/// override below) and never anything else.
pub const RELEASE_PUBLIC_KEY_HEX: &str = "PENDING_RELEASE_KEY";
/// Environment override for the verification key — hex ed25519 public key.
/// Documented use: Enterprise on-prem entitlement servers (roadmap #66)
/// verify against their own server key, and tests pin the CLI flow with
/// ephemeral keys. Absent env → the embedded release key is authoritative.
pub const PUBKEY_OVERRIDE_ENV: &str = "WANYRIX_ACTIVATION_PUBKEY";
/// Environment holding the maintainer DEV signing key for the sandbox web
/// issuer (`POST /api/wanyrix/license/issue`). Read by the WEB route, never
/// by the engine — documented here because the two halves only meet when
/// the dev key's public half is the embedded key above.
pub const SIGNING_KEY_ENV: &str = "WANYRIX_SIGNING_KEY";

/// Tier-gated surface → required plan. The single mapping docs/COMMERCIAL.md
/// documents. Core measured surfaces are deliberately ABSENT: they are never
/// gated (COMMERCIAL.md rule #1). `sync.push`/`sync.pull` land with the sync
/// branch (issue #92); the gate mechanism is proven here with that fixture
/// mapping so the sync branch can call `gate("sync.push", …)` day one.
pub const SURFACE_REGISTRY: &[(&str, Plan)] =
    &[("sync.push", Plan::Team), ("sync.pull", Plan::Team)];

/* --------------------------------------------------------------- plan ----- */

/// Subscription tier. Ordering is the price ladder: [`Plan::rank`] decides
/// whether an activated entitlement covers a required tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Plan {
    Free,
    Team,
    Enterprise,
}

impl Plan {
    pub fn as_str(self) -> &'static str {
        match self {
            Plan::Free => "free",
            Plan::Team => "team",
            Plan::Enterprise => "enterprise",
        }
    }

    /// Strict ladder rank (Free < Team < Enterprise).
    pub fn rank(self) -> u8 {
        match self {
            Plan::Free => 0,
            Plan::Team => 1,
            Plan::Enterprise => 2,
        }
    }

    /// Parse a plan name (token field / CLI `--plan`). Unknown names are
    /// rejected — never coerced to Free.
    pub fn parse(s: &str) -> Result<Plan, String> {
        match s {
            "free" => Ok(Plan::Free),
            "team" => Ok(Plan::Team),
            "enterprise" => Ok(Plan::Enterprise),
            other => Err(format!(
                "unknown plan '{other}' (want free | team | enterprise)"
            )),
        }
    }
}

/// Required plan for a premium surface, if it is gated at all.
/// Absent = core surface = never gated (COMMERCIAL.md rule #1).
pub fn required_plan(surface: &str) -> Option<Plan> {
    SURFACE_REGISTRY
        .iter()
        .find(|(name, _)| *name == surface)
        .map(|(_, plan)| *plan)
}

/* ---------------------------------------------------------------- hex ----- */

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Strict hex decode — even length, hex digits only, exact length checks
/// left to the callers (named errors, never silent truncation).
fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    let b = s.as_bytes();
    if b.is_empty() {
        return Err("empty hex string".to_owned());
    }
    if !b.len().is_multiple_of(2) {
        return Err(format!("odd-length hex string ({})", b.len()));
    }
    let nib = |c: u8| -> Result<u8, String> {
        match c {
            b'0'..=b'9' => Ok(c - b'0'),
            b'a'..=b'f' => Ok(c - b'a' + 10),
            b'A'..=b'F' => Ok(c - b'A' + 10),
            _ => Err(format!("non-hex byte in key/signature material: {c:#04x}")),
        }
    };
    let mut out = Vec::with_capacity(b.len() / 2);
    for pair in b.chunks(2) {
        out.push(nib(pair[0])? << 4 | nib(pair[1])?);
    }
    Ok(out)
}

/* ------------------------------------------------------------ entropy ----- */

/// Fill `buf` from /dev/urandom via std::fs (the issue's explicit keygen
/// randomness contract — no `rand` dependency). A missing or unreadable
/// entropy source is a named refusal: keys are never derived from a weak
/// or made-up source.
fn urandom_fill(buf: &mut [u8]) -> Result<(), EngineError> {
    let mut f = std::fs::File::open("/dev/urandom").map_err(|e| {
        EngineError::Entitlement(format!(
            "cannot open the OS entropy source (/dev/urandom): {e} — refusing to derive key material from anything weaker"
        ))
    })?;
    f.read_exact(buf)
        .map_err(|e| EngineError::Entitlement(format!("short read from /dev/urandom: {e}")))?;
    Ok(())
}

/* -------------------------------------------------------------- token ----- */

/// The unsigned payload inside a signed token. The signature covers EXACTLY
/// this struct's serialization (compact JSON, fixed field order) — anything
/// else in the file is not covered and therefore not trusted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenPayload {
    pub schema: String,
    pub version: u32,
    /// team | enterprise. `free` is never issued: the free tier needs no
    /// license (COMMERCIAL.md rule #1) and a free-looking token would be a
    /// dishonest artifact.
    pub plan: String,
    /// Team identifier chosen at issuance (display-only; no server joins it).
    pub team: String,
    /// Purchased seat count. Offline verification cannot count other
    /// machines — seat usage is reported honestly as "1 (this machine)".
    pub seats: u32,
    /// Issuance day (days since the Unix epoch).
    pub issued_at_day: u64,
    /// First INVALID day (issued_at_day + purchased days).
    pub expiry_day: u64,
    /// 16 random bytes, hex — mint-run identifier (defensive uniqueness).
    pub nonce: String,
}

/// A signed token as it travels (file or literal JSON string).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SignedToken {
    pub schema: String,
    pub version: u32,
    pub plan: String,
    pub team: String,
    pub seats: u32,
    pub issued_at_day: u64,
    pub expiry_day: u64,
    pub nonce: String,
    /// ed25519 signature over the payload serialization (128 hex chars).
    pub signature: String,
}

impl SignedToken {
    fn payload(&self) -> TokenPayload {
        TokenPayload {
            schema: self.schema.clone(),
            version: self.version,
            plan: self.plan.clone(),
            team: self.team.clone(),
            seats: self.seats,
            issued_at_day: self.issued_at_day,
            expiry_day: self.expiry_day,
            nonce: self.nonce.clone(),
        }
    }

    /// Bytes covered by the signature (the canonical payload serialization).
    fn signed_bytes(&self) -> Result<Vec<u8>, EngineError> {
        serde_json::to_vec(&self.payload())
            .map_err(|e| EngineError::Json(format!("token payload serialization: {e}")))
    }

    /// Structural + cryptographic verification against `pubkey`.
    /// Schema/version/plan-shape checks are named refusals; a signature
    /// failure is a TAMPER refusal — never a silent pass.
    pub fn verify(&self, pubkey: &VerifyingKey) -> Result<(), EngineError> {
        if self.schema != TOKEN_SCHEMA {
            return Err(EngineError::Entitlement(format!(
                "token is not a {TOKEN_SCHEMA} artifact (got schema '{}') — refusing activation",
                self.schema
            )));
        }
        if self.version != TOKEN_VERSION {
            return Err(EngineError::Entitlement(format!(
                "token version {} is not supported by this engine (want {})",
                self.version, TOKEN_VERSION
            )));
        }
        if let Err(e) = Plan::parse(&self.plan) {
            return Err(EngineError::Entitlement(format!(
                "token carries an invalid plan field: {e}"
            )));
        }
        if self.team.is_empty() || self.team.len() > 128 {
            return Err(EngineError::Entitlement(
                "token carries an empty or oversized team field".into(),
            ));
        }
        let sig_bytes = hex_decode(&self.signature).map_err(|e| {
            EngineError::Entitlement(format!("token signature field is malformed: {e}"))
        })?;
        let sig = Signature::from_slice(&sig_bytes)
            .map_err(|e| EngineError::Entitlement(format!("token signature is malformed: {e}")))?;
        let msg = self.signed_bytes()?;
        pubkey
            .verify(&msg, &sig)
            .map_err(|e| {
                EngineError::Entitlement(format!(
                    "signature verification failed — the token is not authentic or was tampered with ({e})"
                ))
            })
    }
}

/* ------------------------------------------------------------- state ------ */

/// Derived token state at a wall-clock day. Pure math — unit-tested at the
/// boundaries; the CLI paths only supply `today_day()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntitlementState {
    /// Valid until `expiry_day` (exclusive). `days_until_revalidation` is
    /// the honest headline: when it hits 0 the operator should revalidate.
    Active { days_until_revalidation: u64 },
    /// Past expiry but within [`REVALIDATION_GRACE_DAYS`]: premium surfaces
    /// keep working and MUST surface the grace label.
    Grace { grace_days_remaining: u64 },
    /// Beyond grace — premium surfaces refuse BY NAME.
    Expired,
}

/// Day-granularity expiry/grace math. `expiry_day` is the first INVALID day.
pub fn entitlement_state(now_day: u64, expiry_day: u64) -> EntitlementState {
    if now_day < expiry_day {
        EntitlementState::Active {
            days_until_revalidation: expiry_day - now_day,
        }
    } else if now_day < expiry_day + REVALIDATION_GRACE_DAYS {
        EntitlementState::Grace {
            grace_days_remaining: expiry_day + REVALIDATION_GRACE_DAYS - now_day,
        }
    } else {
        EntitlementState::Expired
    }
}

/// Current UTC day (days since the Unix epoch) from the local wall clock.
/// A pre-epoch clock degrades to day 0 (tokens read as expired) rather than
/// panicking — the same documented fallback as [`crate::timestamp`].
pub fn today_day() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 86_400
}

/* -------------------------------------------------------------- keygen ---- */

/// What `wanyrix license keygen` wrote (and where).
#[derive(Debug)]
pub struct KeygenOutcome {
    pub private_key_path: PathBuf,
    pub public_key_path: PathBuf,
    pub public_key_hex: String,
}

const PRIV_FILE: &str = "wanyrix-license-priv.hex";
const PUB_FILE: &str = "wanyrix-license-pub.hex";

/// Generate an ed25519 signing keypair under `out_dir`. Existing key files
/// are NEVER overwritten (a silent clobber could invalidate issued tokens
/// or, worse, quietly rotate a key someone trusts) — that is a named
/// refusal. Private key file mode is 0600 on unix.
pub fn keygen(out_dir: &Path) -> Result<KeygenOutcome, EngineError> {
    let priv_path = out_dir.join(PRIV_FILE);
    let pub_path = out_dir.join(PUB_FILE);
    for p in [&priv_path, &pub_path] {
        if p.exists() {
            return Err(EngineError::Entitlement(format!(
                "refusing to overwrite an existing key file: {} — move it aside first (keys are never silently replaced)",
                p.display()
            )));
        }
    }
    std::fs::create_dir_all(out_dir).map_err(|e| {
        EngineError::Entitlement(format!(
            "cannot create key output dir {}: {e}",
            out_dir.display()
        ))
    })?;

    let mut seed = [0u8; 32];
    urandom_fill(&mut seed)?;
    let signing = SigningKey::from_bytes(&seed);
    let pub_hex = hex_encode(&signing.verifying_key().to_bytes());

    write_private_new(&priv_path, hex_encode(&seed).as_bytes())?;
    write_public_new(&pub_path, pub_hex.as_bytes())?;

    Ok(KeygenOutcome {
        private_key_path: priv_path,
        public_key_path: pub_path,
        public_key_hex: pub_hex,
    })
}

/// Create-once write with mode 0600 on unix (private key material).
fn write_private_new(path: &Path, contents: &[u8]) -> Result<(), EngineError> {
    use std::io::Write;
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .map_err(|e| {
                EngineError::Entitlement(format!(
                    "cannot create private key file {}: {e}",
                    path.display()
                ))
            })?;
        f.write_all(contents).map_err(|e| {
            EngineError::Entitlement(format!(
                "cannot write private key file {}: {e}",
                path.display()
            ))
        })?;
    }
    #[cfg(not(unix))]
    {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|e| {
                EngineError::Entitlement(format!(
                    "cannot create private key file {}: {e}",
                    path.display()
                ))
            })?;
        f.write_all(contents).map_err(|e| {
            EngineError::Entitlement(format!(
                "cannot write private key file {}: {e}",
                path.display()
            ))
        })?;
    }
    Ok(())
}

fn write_public_new(path: &Path, contents: &[u8]) -> Result<(), EngineError> {
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| {
            EngineError::Entitlement(format!(
                "cannot create public key file {}: {e}",
                path.display()
            ))
        })?;
    f.write_all(contents)
        .map_err(|e| EngineError::Entitlement(format!("cannot write public key file: {e}")))?;
    Ok(())
}

/* --------------------------------------------------------------- issue ---- */

/// What `wanyrix license issue` mints.
#[derive(Debug, Clone)]
pub struct IssueRequest {
    pub plan: Plan,
    pub team: String,
    /// Validity in days (1..=36500; the honesty of "expiry/issued-at via day
    /// counts" means days are the only unit a token carries).
    pub days: u32,
    pub seats: u32,
}

/// Sign and mint a token with an explicit issuance day (the general signer;
/// [`issue`] is the CLI wrapper that stamps the current day). Exposed so
/// tests can mint honestly-expired/backdated tokens without a time machine.
pub fn issue_signed(
    req: &IssueRequest,
    signing_key_hex: &str,
    issued_at_day: u64,
) -> Result<SignedToken, EngineError> {
    if req.plan == Plan::Free {
        return Err(EngineError::Entitlement(
            "plan 'free' is never issued — the free tier needs no license (docs/COMMERCIAL.md rule #1)".into(),
        ));
    }
    if req.days == 0 || req.days > 36_500 {
        return Err(EngineError::Entitlement(format!(
            "--days must be within 1..=36500 (got {})",
            req.days
        )));
    }
    if req.seats == 0 || req.seats > 100_000 {
        return Err(EngineError::Entitlement(format!(
            "--seats must be within 1..=100000 (got {})",
            req.seats
        )));
    }
    if req.team.is_empty() || req.team.len() > 128 {
        return Err(EngineError::Entitlement(
            "--team must be a non-empty identifier of at most 128 characters".into(),
        ));
    }

    let seed_vec = hex_decode(signing_key_hex.trim())
        .map_err(|e| EngineError::Entitlement(format!("signing key is malformed hex: {e}")))?;
    let seed: [u8; 32] = seed_vec.try_into().map_err(|v: Vec<u8>| {
        EngineError::Entitlement(format!(
            "signing key must be exactly 32 bytes (64 hex chars), got {} bytes",
            v.len()
        ))
    })?;
    let signing = SigningKey::from_bytes(&seed);

    let mut nonce_bytes = [0u8; 16];
    urandom_fill(&mut nonce_bytes)?;

    let payload = TokenPayload {
        schema: TOKEN_SCHEMA.to_owned(),
        version: TOKEN_VERSION,
        plan: req.plan.as_str().to_owned(),
        team: req.team.clone(),
        seats: req.seats,
        issued_at_day,
        expiry_day: issued_at_day + u64::from(req.days),
        nonce: hex_encode(&nonce_bytes),
    };
    let msg = serde_json::to_vec(&payload)
        .map_err(|e| EngineError::Json(format!("token payload serialization: {e}")))?;
    let signature = signing.sign(&msg);

    Ok(SignedToken {
        schema: payload.schema,
        version: payload.version,
        plan: payload.plan,
        team: payload.team,
        seats: payload.seats,
        issued_at_day: payload.issued_at_day,
        expiry_day: payload.expiry_day,
        nonce: payload.nonce,
        signature: hex_encode(&signature.to_bytes()),
    })
}

/// CLI issuance: stamps the CURRENT day as issuance day.
pub fn issue(req: &IssueRequest, signing_key_hex: &str) -> Result<SignedToken, EngineError> {
    issue_signed(req, signing_key_hex, today_day())
}

/* ----------------------------------------------------------- authority ---- */

/// Parse a hex ed25519 verifying key (32 bytes = 64 hex chars) — the
/// operator-facing form of a public half (`wanyrix-license-pub.hex`,
/// `WANYRIX_ACTIVATION_PUBKEY`). Parsed strictly; an unusable key is a
/// named refusal — verification never "fails open".
pub fn verifying_key_from_hex(hex: &str) -> Result<VerifyingKey, EngineError> {
    let bytes = hex_decode(hex.trim()).map_err(|e| {
        EngineError::Entitlement(format!(
            "verification public key ({PUBKEY_OVERRIDE_ENV} or embedded) is malformed hex: {e}"
        ))
    })?;
    let arr: [u8; 32] = bytes.try_into().map_err(|v: Vec<u8>| {
        EngineError::Entitlement(format!(
            "verification public key must be 32 bytes (64 hex chars), got {} bytes",
            v.len()
        ))
    })?;
    VerifyingKey::from_bytes(&arr)
        .map_err(|e| EngineError::Entitlement(format!("verification public key is invalid: {e}")))
}

/// The ed25519 key activation/verification trusts: the
/// `WANYRIX_ACTIVATION_PUBKEY` override when set (on-prem entitlement
/// servers, tests), else the embedded release key (dev key until release
/// signing).
pub fn authority() -> Result<VerifyingKey, EngineError> {
    let hex_str = match std::env::var(PUBKEY_OVERRIDE_ENV) {
        Ok(v) if !v.trim().is_empty() => v,
        _ => RELEASE_PUBLIC_KEY_HEX.to_owned(),
    };
    verifying_key_from_hex(&hex_str)
}

/* --------------------------------------------------------------- cache ---- */

/// `<dir>/.wanyrix/entitlement.json` — the activation cache. `dir` is the
/// workspace/root the operator launched from (`.` for plain CLI use).
pub fn cache_path(dir: &Path) -> PathBuf {
    dir.join(DIR_NAME).join(CACHE_FILE)
}

/// On-disk cache: the SIGNED token verbatim (never a derived-only copy, so
/// every read can re-verify the signature) plus an activation receipt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheFile {
    schema: String,
    /// Wall-clock activation stamp — declared last inside the receipt, the
    /// only non-derived field (same honesty rule as state.json).
    activated_at: String,
    token: SignedToken,
}

/// Atomically persist the cache (temp sibling + rename; product.rs pattern).
fn atomic_write(path: &Path, contents: &str) -> Result<(), EngineError> {
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents)
        .map_err(|e| EngineError::Entitlement(format!("cannot write {}: {e}", tmp.display())))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        EngineError::Entitlement(format!(
            "cannot finalize {} -> {}: {e}",
            tmp.display(),
            path.display()
        ))
    })?;
    Ok(())
}

/* ------------------------------------------------------------ activate ---- */

/// What `wanyrix activate` reports.
#[derive(Debug)]
pub struct ActivationOutcome {
    pub token: SignedToken,
    pub state: EntitlementState,
    pub cache: PathBuf,
}

/// Resolve the `--key` argument: an existing file path is read verbatim;
/// anything else is treated as the literal token JSON (the issue's
/// path-or-literal contract). Missing files that LOOK like paths still
/// fall through to literal parsing and fail there with a named error.
fn resolve_key_material(key_arg: &str) -> Result<String, EngineError> {
    let candidate = Path::new(key_arg);
    if candidate.exists() {
        return std::fs::read_to_string(candidate).map_err(|e| {
            EngineError::Entitlement(format!(
                "cannot read token file {}: {e}",
                candidate.display()
            ))
        });
    }
    Ok(key_arg.to_owned())
}

/// Verify a token OFFLINE and cache it under `<dir>/.wanyrix/entitlement.json`.
///
/// Refusals (all named, all before anything is written):
/// - malformed token JSON, wrong schema/version/plan shape;
/// - signature failure (tamper / wrong key chain);
/// - expired beyond the revalidation grace window.
///
/// Re-activation replaces the cache (a renewal) — it never merges.
pub fn activate(key_arg: &str, dir: &Path, now_day: u64) -> Result<ActivationOutcome, EngineError> {
    activate_with(key_arg, dir, now_day, &authority()?)
}

/// [`activate`] with an explicit verification key (unit-test seam; the CLI
/// path resolves the env-override-or-embedded authority).
pub fn activate_with(
    key_arg: &str,
    dir: &Path,
    now_day: u64,
    pubkey: &VerifyingKey,
) -> Result<ActivationOutcome, EngineError> {
    let material = resolve_key_material(key_arg)?;
    let token: SignedToken = serde_json::from_str(material.trim()).map_err(|e| {
        EngineError::Entitlement(format!(
            "the --key argument is neither a readable token file nor valid token JSON: {e}"
        ))
    })?;
    token.verify(pubkey)?;

    let state = entitlement_state(now_day, token.expiry_day);
    if state == EntitlementState::Expired {
        return Err(EngineError::Entitlement(format!(
            "token expired on {} (day {}) — the {}-day revalidation grace has ended; renew the entitlement to activate",
            iso8601_from_unix(token.expiry_day.saturating_mul(86_400)),
            token.expiry_day,
            REVALIDATION_GRACE_DAYS
        )));
    }

    let cache = cache_path(dir);
    if let Some(parent) = cache.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            EngineError::Entitlement(format!("cannot create the {} state dir: {e}", DIR_NAME))
        })?;
    }
    let receipt = CacheFile {
        schema: CACHE_SCHEMA.to_owned(),
        activated_at: crate::timestamp::iso8601_now(),
        token: token.clone(),
    };
    let text = serde_json::to_string(&receipt)
        .map_err(|e| EngineError::Json(format!("cache serialization: {e}")))?;
    atomic_write(&cache, &text)?;

    Ok(ActivationOutcome {
        token,
        state,
        cache,
    })
}

/* -------------------------------------------------------------- status ---- */

/// One tier-gated surface in the entitlement envelope.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceGate {
    pub surface: &'static str,
    pub required_plan: &'static str,
}

/// The `wanyrix entitlement` envelope (`wanyrix.entitlement/v1`).
/// With no license this is an honest `not-activated` envelope — the free
/// tier is a supported state, never an error.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitlementReport {
    pub schema: &'static str,
    /// active | grace | not-activated
    pub status: &'static str,
    /// The entitled plan; `free` when nothing is activated.
    pub plan: &'static str,
    pub team: Option<String>,
    pub seats_total: Option<u32>,
    /// Measured on THIS machine only (offline verification cannot count
    /// other machines — `seatsNote` says so rather than inventing a number).
    pub seats_in_use: Option<u32>,
    pub seats_note: &'static str,
    pub issued_at_day: Option<u64>,
    pub expiry_day: Option<u64>,
    /// `expiry_day` rendered as UTC ISO-8601 (day-start semantics).
    pub expiry: Option<String>,
    /// Days until the token hits `expiry_day` (0 once grace begins).
    pub days_until_revalidation: Option<u64>,
    /// Present in grace only: days of grace that remain.
    pub grace_days_remaining: Option<u64>,
    pub revalidation_grace_days: u64,
    pub tier_gated_surfaces: Vec<SurfaceGate>,
    pub verification: &'static str,
    pub clock_note: &'static str,
    /// Present when not activated: the honest remediation note.
    pub note: Option<&'static str>,
    /// LAST key — the only non-deterministic field (wall clock, honestly).
    pub generated_at: String,
}

/// Read + re-verify the cached entitlement and derive the envelope.
/// The signature is re-checked on EVERY read: a cache tampered after
/// activation is a named refusal, never a silent pass.
///
/// Key resolution is LAZY: with no cache the honest `not-activated`
/// envelope is returned without touching any key material, so the free
/// tier reports truthfully even on dev builds whose embedded release key
/// is still the `PENDING_RELEASE_KEY` placeholder (the free tier is never
/// gated — COMMERCIAL.md rule #1 — and its reporting must not depend on
/// release signing having happened).
pub fn read_status(dir: &Path, now_day: u64) -> Result<EntitlementReport, EngineError> {
    if !cache_path(dir).exists() {
        return Ok(not_activated_report());
    }
    read_status_with(dir, now_day, &authority()?)
}

/// [`read_status`] with an explicit verification key (unit-test seam).
pub fn read_status_with(
    dir: &Path,
    now_day: u64,
    pubkey: &VerifyingKey,
) -> Result<EntitlementReport, EngineError> {
    let cache = cache_path(dir);
    if !cache.exists() {
        return Ok(not_activated_report());
    }
    let text = std::fs::read_to_string(&cache).map_err(|e| {
        EngineError::Entitlement(format!(
            "cached entitlement {} is unreadable: {e} — delete it or re-activate",
            cache.display()
        ))
    })?;
    let receipt: CacheFile = serde_json::from_str(text.trim()).map_err(|e| {
        EngineError::Entitlement(format!(
            "cached entitlement {} is corrupt: {e} — delete it or re-activate",
            cache.display()
        ))
    })?;
    if receipt.schema != CACHE_SCHEMA {
        return Err(EngineError::Entitlement(format!(
            "cached entitlement {} is not a {CACHE_SCHEMA} receipt — delete it or re-activate",
            cache.display()
        )));
    }
    // Re-verify the signature of the CACHED token on every read (tamper pin).
    receipt.token.verify(pubkey)?;

    let token = receipt.token;
    let plan = Plan::parse(&token.plan).map_err(|e| {
        EngineError::Entitlement(format!("cached entitlement carries an invalid plan: {e}"))
    })?;
    let state = entitlement_state(now_day, token.expiry_day);
    let (status, days_until, grace_left) = match state {
        EntitlementState::Active {
            days_until_revalidation,
        } => ("active", Some(days_until_revalidation), None),
        EntitlementState::Grace {
            grace_days_remaining,
        } => ("grace", Some(0), Some(grace_days_remaining)),
        EntitlementState::Expired => ("expired", None, None),
    };

    Ok(EntitlementReport {
        schema: ENTITLEMENT_SCHEMA,
        status,
        plan: plan.as_str(),
        team: Some(token.team),
        seats_total: Some(token.seats),
        seats_in_use: Some(1),
        seats_note: SEATS_NOTE,
        issued_at_day: Some(token.issued_at_day),
        expiry_day: Some(token.expiry_day),
        expiry: Some(iso8601_from_unix(token.expiry_day.saturating_mul(86_400))),
        days_until_revalidation: days_until,
        grace_days_remaining: grace_left,
        revalidation_grace_days: REVALIDATION_GRACE_DAYS,
        tier_gated_surfaces: registry_gates(),
        verification: VERIFICATION_NOTE,
        clock_note: CLOCK_NOTE,
        note: None,
        generated_at: crate::timestamp::iso8601_now(),
    })
}

/// The honest no-license envelope (free tier).
fn not_activated_report() -> EntitlementReport {
    EntitlementReport {
        schema: ENTITLEMENT_SCHEMA,
        status: "not-activated",
        plan: Plan::Free.as_str(),
        team: None,
        seats_total: None,
        seats_in_use: None,
        seats_note: SEATS_NOTE,
        issued_at_day: None,
        expiry_day: None,
        expiry: None,
        days_until_revalidation: None,
        grace_days_remaining: None,
        revalidation_grace_days: REVALIDATION_GRACE_DAYS,
        tier_gated_surfaces: registry_gates(),
        verification: VERIFICATION_NOTE,
        clock_note: CLOCK_NOTE,
        note: Some(
            "no license activated — core local surfaces are NEVER gated (docs/COMMERCIAL.md rule #1); \
             activate with: wanyrix activate --key <token-file-or-json>",
        ),
        generated_at: crate::timestamp::iso8601_now(),
    }
}

const SEATS_NOTE: &str =
    "seats_in_use is measured on this machine only (1); offline verification cannot count other machines";
const VERIFICATION_NOTE: &str =
    "offline ed25519 — the token signature is verified locally against the embedded release key (or WANYRIX_ACTIVATION_PUBKEY) and re-verified on every read; zero network I/O";
const CLOCK_NOTE: &str =
    "expiry/grace math reads the LOCAL wall clock as UTC day counts — an offset clock shifts the judgment and no server time is consulted";

fn registry_gates() -> Vec<SurfaceGate> {
    SURFACE_REGISTRY
        .iter()
        .map(|(surface, plan)| SurfaceGate {
            surface,
            required_plan: plan.as_str(),
        })
        .collect()
}

/* ---------------------------------------------------------------- gate ---- */

/// A granted premium-surface pass. `grace` is true when the grant came from
/// a past-expiry token inside the revalidation window — callers MUST surface
/// a visible grace label alongside the granted output.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GateGrant {
    pub grace: bool,
    pub plan: Plan,
}

/// The premium-surface gate.
///
/// - Surfaces absent from [`SURFACE_REGISTRY`] (every core measured surface)
///   are granted unconditionally — the honesty contract of COMMERCIAL.md
///   rule #1, pinned by tests.
/// - Registered surfaces require an activated, signature-verified token of
///   sufficient tier:
///   - no/deleted cache or tier too low →
///     [`EngineError::SubscriptionRequired`] naming the surface + plan;
///   - expired beyond grace → [`EngineError::Entitlement`] naming the
///     expiry date;
///   - tampered/corrupt cache → [`EngineError::Entitlement`] naming the
///     signature failure;
///   - in grace → granted with `grant.grace == true`.
pub fn gate(surface: &str, dir: &Path, now_day: u64) -> Result<GateGrant, EngineError> {
    match required_plan(surface) {
        // Core surface: never gated — and decided WITHOUT any key material,
        // so a dev build's pending embedded key can never break core use.
        None => Ok(GateGrant {
            grace: false,
            plan: Plan::Free,
        }),
        // Premium surface with no cache at all: the named refusal needs no
        // cryptography either.
        Some(required) if !cache_path(dir).exists() => Err(EngineError::SubscriptionRequired {
            surface: surface.to_owned(),
            plan_required: required.as_str().to_owned(),
        }),
        // Premium surface with a cached token: real verification, so the
        // authority (override env or embedded key) is resolved here.
        Some(_) => gate_with(surface, dir, now_day, &authority()?),
    }
}

/// [`gate`] with an explicit verification key (unit-test seam).
pub fn gate_with(
    surface: &str,
    dir: &Path,
    now_day: u64,
    pubkey: &VerifyingKey,
) -> Result<GateGrant, EngineError> {
    let Some(required) = required_plan(surface) else {
        // Core surface (or anything not yet premium): never gated.
        return Ok(GateGrant {
            grace: false,
            plan: Plan::Free,
        });
    };

    let cache = cache_path(dir);
    if !cache.exists() {
        return Err(EngineError::SubscriptionRequired {
            surface: surface.to_owned(),
            plan_required: required.as_str().to_owned(),
        });
    }
    let text = std::fs::read_to_string(&cache).map_err(|e| {
        EngineError::Entitlement(format!(
            "cached entitlement {} is unreadable: {e} — surface '{surface}' refused",
            cache.display()
        ))
    })?;
    let receipt: CacheFile = serde_json::from_str(text.trim()).map_err(|e| {
        EngineError::Entitlement(format!(
            "cached entitlement is corrupt ({e}) — surface '{surface}' refused; re-activate a genuine token"
        ))
    })?;
    receipt.token.verify(pubkey).map_err(|e| match e {
        EngineError::Entitlement(msg) => {
            EngineError::Entitlement(format!("{msg} — surface '{surface}' refused"))
        }
        other => other,
    })?;

    let entitled = Plan::parse(&receipt.token.plan).map_err(|e| {
        EngineError::Entitlement(format!(
            "cached entitlement carries an invalid plan ({e}) — surface '{surface}' refused"
        ))
    })?;

    match entitlement_state(now_day, receipt.token.expiry_day) {
        EntitlementState::Active { .. } if entitled.rank() >= required.rank() => Ok(GateGrant {
            grace: false,
            plan: entitled,
        }),
        EntitlementState::Grace {
            grace_days_remaining: _,
        } if entitled.rank() >= required.rank() => Ok(GateGrant {
            grace: true,
            plan: entitled,
        }),
        EntitlementState::Expired => Err(EngineError::Entitlement(format!(
            "entitlement expired on {} — the {}-day revalidation grace has ended; surface '{surface}' refused; renew to restore premium surfaces",
            iso8601_from_unix(receipt.token.expiry_day.saturating_mul(86_400)),
            REVALIDATION_GRACE_DAYS
        ))),
        _ => Err(EngineError::SubscriptionRequired {
            surface: surface.to_owned(),
            plan_required: required.as_str().to_owned(),
        }),
    }
}

/* ------------------------------------------------------------ run fns ---- */

/// `wanyrix activate --key <path-or-literal> [--json] [--pretty]`.
pub fn activate_run(key: &str, json: bool, pretty: bool) -> Result<String, EngineError> {
    let outcome = activate(key, Path::new("."), today_day())?;
    if json {
        let report = read_status(Path::new("."), today_day())?;
        return crate::cli::serialize_json(&report, pretty);
    }
    Ok(activation_human(&outcome))
}

fn activation_human(outcome: &ActivationOutcome) -> String {
    let token = &outcome.token;
    let plan = Plan::parse(&token.plan)
        .map(|p| p.as_str().to_owned())
        .unwrap_or_else(|_| token.plan.clone());
    let mut out = format!(
        "wanyrix activate — entitlement activated (offline signature verification)\n  plan: {plan}\n  team: {}\n  seats: {} ({})\n  issued: day {} · expires: {} (day {})\n  cache: {}\n  verification: {VERIFICATION_NOTE}\n",
        token.team,
        token.seats,
        SEATS_NOTE,
        token.issued_at_day,
        iso8601_from_unix(token.expiry_day.saturating_mul(86_400)),
        token.expiry_day,
        outcome.cache.display(),
    );
    match outcome.state {
        EntitlementState::Active {
            days_until_revalidation,
        } => out.push_str(&format!(
            "  status: active — {days_until_revalidation} day(s) until revalidation\n"
        )),
        EntitlementState::Grace {
            grace_days_remaining,
        } => out.push_str(&format!(
            "  status: GRACE — expiry has passed; {grace_days_remaining} day(s) of the {}-day revalidation grace remain (premium surfaces run with a visible grace label)\n",
            REVALIDATION_GRACE_DAYS
        )),
        EntitlementState::Expired => out.push_str(
            "  status: expired — this activation should have been refused (report this as a bug)\n",
        ),
    }
    out
}

/// `wanyrix entitlement [--json] [--pretty]`.
pub fn entitlement_run(json: bool, pretty: bool) -> Result<String, EngineError> {
    let report = read_status(Path::new("."), today_day())?;
    if json {
        return crate::cli::serialize_json(&report, pretty);
    }
    Ok(entitlement_human(&report))
}

fn entitlement_human(report: &EntitlementReport) -> String {
    let gates = report
        .tier_gated_surfaces
        .iter()
        .map(|g| format!("{} ({})", g.surface, g.required_plan))
        .collect::<Vec<_>>()
        .join(", ");
    let gates = if gates.is_empty() {
        "none registered".to_owned()
    } else {
        gates
    };
    match report.status {
        "not-activated" => format!(
            "wanyrix entitlement — no license activated (status: not-activated)\n  plan: free — core local surfaces are NEVER gated (docs/COMMERCIAL.md rule #1)\n  tier-gated surfaces: {gates}\n  note: {}\n  verification: {VERIFICATION_NOTE}\n",
            report.note.unwrap_or_default(),
        ),
        _ => {
            let mut out = format!(
                "wanyrix entitlement — {} ({})\n  plan: {}\n  team: {}\n  seats: {:?} total · {} in use ({})\n  expiry: {} (day {})\n  revalidation grace: {} day(s)\n  tier-gated surfaces: {gates}\n  verification: {VERIFICATION_NOTE}\n  clock: {CLOCK_NOTE}\n",
                report.status,
                if report.status == "grace" { "premium surfaces run with a visible grace label" } else { "all entitled surfaces available" },
                report.plan,
                report.team.clone().unwrap_or_default(),
                report.seats_total,
                report.seats_in_use.unwrap_or(0),
                SEATS_NOTE,
                report.expiry.clone().unwrap_or_default(),
                report.expiry_day.unwrap_or(0),
                report.revalidation_grace_days,
            );
            if let Some(left) = report.grace_days_remaining {
                out.push_str(&format!("  grace: {left} day(s) remaining\n"));
            }
            out
        }
    }
}

/// `wanyrix license keygen|issue` — maintainer tooling.
pub fn license_run(cmd: LicenseCmd) -> Result<String, EngineError> {
    match cmd {
        LicenseCmd::Keygen { out } => {
            let outcome = keygen(&out)?;
            Ok(format!(
                "wanyrix license keygen — new ed25519 signing keypair\n  private key: {} (mode 0600 on unix — NEVER commit, never share)\n  public key:  {}\n  public key hex: {}\n  note: activation trusts the EMBEDDED release key — a keypair is authoritative only once its public half is embedded (dev) or distributed to the on-prem verifier (WANYRIX_ACTIVATION_PUBKEY)\n",
                outcome.private_key_path.display(),
                outcome.public_key_path.display(),
                outcome.public_key_hex,
            ))
        }
        LicenseCmd::Issue {
            plan,
            team,
            days,
            seats,
            key,
            out,
            json,
        } => {
            let plan = Plan::parse(&plan).map_err(EngineError::Entitlement)?;
            let req = IssueRequest {
                plan,
                team: team.clone(),
                days,
                seats,
            };
            let material = resolve_key_material(&key)?;
            let token = issue(&req, material.trim())?;
            if let Some(out_path) = out.as_deref() {
                std::fs::write(out_path, format!("{}\n", token_json(&token)?)).map_err(|e| {
                    EngineError::Entitlement(format!(
                        "cannot write token file {}: {e}",
                        out_path.display()
                    ))
                })?;
            }
            if json {
                // Machine flavor: EXACTLY the signed token JSON (single line)
                // — the artifact itself, no wrapper (the web sandbox issuer
                // parses stdout verbatim).
                return token_json(&token);
            }
            let mut text = format!(
                "wanyrix license issue — signed entitlement token ({TOKEN_SCHEMA})\n  plan: {} · team: {} · seats: {}\n  issued: day {} · expires: {} (day {})\n  nonce: {}\n",
                token.plan,
                token.team,
                token.seats,
                token.issued_at_day,
                iso8601_from_unix(token.expiry_day.saturating_mul(86_400)),
                token.expiry_day,
                token.nonce,
            );
            match out.as_deref() {
                Some(p) => text.push_str(&format!("  token written to: {}\n", p.display())),
                None => text.push_str(
                    "  token: stdout only — pipe to a file to distribute (never commit private keys or tokens you keep secret)\n",
                ),
            }
            text.push_str(&format!(
                "-----BEGIN WANYRIX TOKEN-----\n{}\n-----END WANYRIX TOKEN-----\n",
                token_json(&token)?
            ));
            Ok(text)
        }
    }
}

fn token_json(token: &SignedToken) -> Result<String, EngineError> {
    serde_json::to_string(token).map_err(|e| EngineError::Json(format!("token serialization: {e}")))
}

/// CLI subcommands for `wanyrix license` (maintainer tooling; defined here
/// so the module owns its whole surface — clap derive, issue #94).
#[derive(clap::Subcommand, Debug)]
pub enum LicenseCmd {
    /// Generate an ed25519 signing keypair (private key mode 0600 on unix;
    /// existing files are never overwritten).
    Keygen {
        /// Output directory (created).
        #[arg(long)]
        out: PathBuf,
    },
    /// Mint a signed entitlement token (`wanyrix.entitlement.token/v1`).
    Issue {
        /// team | enterprise (free is never issued — it needs no license).
        #[arg(long)]
        plan: String,
        /// Team identifier carried in the token (display-only).
        #[arg(long)]
        team: String,
        /// Validity in days (1..=36500).
        #[arg(long)]
        days: u32,
        /// Seat count carried in the token (1..=100000; default 5).
        #[arg(long, default_value_t = 5)]
        seats: u32,
        /// Signing private key: hex file path, or the literal hex seed.
        #[arg(long)]
        key: String,
        /// Also write the token JSON to this file.
        #[arg(long)]
        out: Option<PathBuf>,
        /// Print EXACTLY the token JSON on stdout (no wrapper, no prose).
        #[arg(long)]
        json: bool,
    },
}

/* -------------------------------------------------------------- tests ----- */

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::EngineError;

    /// Fixed 32-byte seeds — ephemeral keypairs derived in-process, the
    /// issue's mandated test pattern (NO private keys in the repository).
    const SEED_A: [u8; 32] = [7u8; 32];
    const SEED_B: [u8; 32] = [11u8; 32];

    fn signer(seed: &[u8; 32]) -> SigningKey {
        SigningKey::from_bytes(seed)
    }

    fn hex_seed(seed: &[u8; 32]) -> String {
        hex_encode(seed)
    }

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!(
            "wanyrix-ent-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn issue_at(seed: &str, plan: Plan, days: u32, issued: u64, dir: &Path) -> SignedToken {
        let req = IssueRequest {
            plan,
            team: "acme".into(),
            days,
            seats: 5,
        };
        let token = issue_signed(&req, seed, issued).unwrap();
        if let Some(parent) = cache_path(dir).parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let receipt = CacheFile {
            schema: CACHE_SCHEMA.to_owned(),
            activated_at: "1970-01-01T00:00:00Z".into(),
            token: token.clone(),
        };
        atomic_write(&cache_path(dir), &serde_json::to_string(&receipt).unwrap()).unwrap();
        token
    }

    /* -- hex + entropy ------------------------------------------------- */

    #[test]
    fn hex_round_trips_and_rejects_garbage() {
        assert_eq!(hex_encode(&[0x00, 0xff, 0x10]), "00ff10");
        assert_eq!(hex_decode("00ff10").unwrap(), vec![0x00, 0xff, 0x10]);
        assert_eq!(hex_decode("00FF10").unwrap(), vec![0x00, 0xff, 0x10]);
        for bad in ["", "0", "0f0", "zz", "0g"] {
            assert!(hex_decode(bad).is_err(), "must reject {bad:?}");
        }
    }

    #[test]
    fn urandom_returns_distinct_bytes() {
        let mut a = [0u8; 32];
        let mut b = [0u8; 32];
        urandom_fill(&mut a).unwrap();
        urandom_fill(&mut b).unwrap();
        assert_ne!(a, b, "two 32-byte draws from /dev/urandom never collide");
    }

    /* -- signature verify: valid / tampered / wrong key ----------------- */

    #[test]
    fn token_verify_accepts_an_authentic_token() {
        let token = issue_signed(
            &IssueRequest {
                plan: Plan::Team,
                team: "acme".into(),
                days: 14,
                seats: 5,
            },
            &hex_seed(&SEED_A),
            20_000,
        )
        .unwrap();
        assert_eq!(token.schema, TOKEN_SCHEMA);
        assert_eq!(token.version, TOKEN_VERSION);
        assert_eq!(token.expiry_day, 20_014);
        assert_eq!(token.nonce.len(), 32, "16 random bytes as hex");
        assert_eq!(token.signature.len(), 128, "ed25519 sig as hex");
        token
            .verify(&signer(&SEED_A).verifying_key())
            .expect("authentic token verifies");
    }

    #[test]
    fn token_verify_rejects_tampering_field_by_field() {
        let base = issue_signed(
            &IssueRequest {
                plan: Plan::Team,
                team: "acme".into(),
                days: 14,
                seats: 5,
            },
            &hex_seed(&SEED_A),
            20_000,
        )
        .unwrap();
        let tamper = |mutate: &dyn Fn(&mut SignedToken)| {
            let mut t = base.clone();
            mutate(&mut t);
            let err = t.verify(&signer(&SEED_A).verifying_key()).unwrap_err();
            assert!(
                matches!(err, EngineError::Entitlement(ref m) if m.contains("signature verification failed") || m.contains("not authentic")),
                "tamper must be a NAMED signature refusal, got: {err:?}"
            );
        };
        tamper(&|t| t.plan = "enterprise".into());
        tamper(&|t| t.team = "evil".into());
        tamper(&|t| t.seats = 9_999);
        tamper(&|t| t.expiry_day = u64::MAX);
        tamper(&|t| t.issued_at_day = 0);
        tamper(&|t| t.nonce = "0".repeat(32));
        tamper(&|t| t.signature = "0".repeat(128));
    }

    #[test]
    fn token_verify_rejects_wrong_key_chain_and_shape() {
        let token = issue_signed(
            &IssueRequest {
                plan: Plan::Team,
                team: "acme".into(),
                days: 14,
                seats: 5,
            },
            &hex_seed(&SEED_A),
            20_000,
        )
        .unwrap();
        // Signed by SEED_A, verified against SEED_B: named refusal.
        let err = token.verify(&signer(&SEED_B).verifying_key()).unwrap_err();
        assert!(matches!(err, EngineError::Entitlement(_)), "{err:?}");

        let mut wrong_schema = token.clone();
        wrong_schema.schema = "wanyrix.doctor/v1".into();
        assert!(wrong_schema
            .verify(&signer(&SEED_A).verifying_key())
            .is_err());

        let mut bad_version = token.clone();
        bad_version.version = 99;
        assert!(bad_version
            .verify(&signer(&SEED_A).verifying_key())
            .is_err());

        let mut bad_plan = token.clone();
        bad_plan.plan = "unlimited".into();
        assert!(bad_plan.verify(&signer(&SEED_A).verifying_key()).is_err());
    }

    /* -- grace / expiry math (pure, boundary-pinned) -------------------- */

    #[test]
    fn grace_window_math_is_exact_at_the_boundaries() {
        let expiry = 21_000;
        // Active: every day strictly before expiry_day.
        assert_eq!(
            entitlement_state(expiry - 1, expiry),
            EntitlementState::Active {
                days_until_revalidation: 1
            }
        );
        assert_eq!(
            entitlement_state(expiry - 365, expiry),
            EntitlementState::Active {
                days_until_revalidation: 365
            }
        );
        // Grace: expiry_day itself is the FIRST grace day.
        assert_eq!(
            entitlement_state(expiry, expiry),
            EntitlementState::Grace {
                grace_days_remaining: REVALIDATION_GRACE_DAYS
            }
        );
        assert_eq!(
            entitlement_state(expiry + REVALIDATION_GRACE_DAYS - 1, expiry),
            EntitlementState::Grace {
                grace_days_remaining: 1
            }
        );
        // Expired: the day the grace window closes.
        assert_eq!(
            entitlement_state(expiry + REVALIDATION_GRACE_DAYS, expiry),
            EntitlementState::Expired
        );
        assert_eq!(
            entitlement_state(expiry + 10_000, expiry),
            EntitlementState::Expired
        );
    }

    /* -- activate: happy path, grace, expiry, tamper -------------------- */

    #[test]
    fn activate_caches_and_reports_the_state() {
        let dir = tmpdir("activate-ok");
        let vk = signer(&SEED_A).verifying_key();
        let token = issue_signed(
            &IssueRequest {
                plan: Plan::Team,
                team: "acme".into(),
                days: 30,
                seats: 5,
            },
            &hex_seed(&SEED_A),
            today_day(),
        )
        .unwrap();
        assert!(token.verify(&vk).is_ok());

        let out = activate_with(
            &serde_json::to_string(&token).unwrap(),
            &dir,
            today_day(),
            &vk,
        )
        .unwrap();
        assert_eq!(
            out.state,
            EntitlementState::Active {
                days_until_revalidation: 30
            }
        );
        assert!(cache_path(&dir).exists(), "activation caches the token");
    }

    #[test]
    fn activate_accepts_a_token_file_and_replaces_the_cache_on_renewal() {
        let dir = tmpdir("activate-file");
        let first = issue_signed(
            &IssueRequest {
                plan: Plan::Team,
                team: "acme".into(),
                days: 10,
                seats: 1,
            },
            &hex_seed(&SEED_A),
            today_day(),
        )
        .unwrap();
        let vk = signer(&SEED_A).verifying_key();
        let file = dir.join("token.json");
        std::fs::write(&file, serde_json::to_string(&first).unwrap()).unwrap();
        // File-path form (the path-or-literal contract).
        let out = activate_with(file.to_str().unwrap(), &dir, today_day(), &vk).unwrap();
        assert_eq!(out.token.seats, 1);

        // Renewal with a different token replaces (never merges).
        let second = issue_signed(
            &IssueRequest {
                plan: Plan::Enterprise,
                team: "acme".into(),
                days: 365,
                seats: 50,
            },
            &hex_seed(&SEED_A),
            today_day(),
        )
        .unwrap();
        let out = activate_with(
            &serde_json::to_string(&second).unwrap(),
            &dir,
            today_day(),
            &vk,
        )
        .unwrap();
        assert_eq!(out.token.plan, "enterprise");
        let cached = std::fs::read_to_string(cache_path(&dir)).unwrap();
        assert!(cached.contains("enterprise"), "cache reflects the renewal");
    }

    #[test]
    fn activate_refuses_an_expired_token_by_name_and_caches_nothing() {
        let dir = tmpdir("activate-expired");
        let vk = signer(&SEED_A).verifying_key();
        let token = issue_signed(
            &IssueRequest {
                plan: Plan::Team,
                team: "acme".into(),
                days: 14,
                seats: 5,
            },
            &hex_seed(&SEED_A),
            today_day() - 100, // long past expiry + grace
        )
        .unwrap();
        let err = activate_with(
            &serde_json::to_string(&token).unwrap(),
            &dir,
            today_day(),
            &vk,
        )
        .unwrap_err();
        match err {
            EngineError::Entitlement(m) => {
                assert!(m.contains("expired"), "must name the expiry: {m}");
                assert!(m.contains("grace"), "must name the grace window: {m}");
            }
            other => panic!("want Entitlement, got {other:?}"),
        }
        assert!(
            !cache_path(&dir).exists(),
            "refused tokens are never cached"
        );
    }

    #[test]
    fn activate_refuses_tampered_tokens_by_name() {
        let dir = tmpdir("activate-tampered");
        let vk = signer(&SEED_A).verifying_key();
        let mut token = issue_signed(
            &IssueRequest {
                plan: Plan::Team,
                team: "acme".into(),
                days: 14,
                seats: 5,
            },
            &hex_seed(&SEED_A),
            today_day(),
        )
        .unwrap();
        token.seats = 100; // forge more seats, keep the signature
        let err = activate_with(
            &serde_json::to_string(&token).unwrap(),
            &dir,
            today_day(),
            &vk,
        )
        .unwrap_err();
        assert!(
            matches!(err, EngineError::Entitlement(ref m) if m.contains("signature verification failed")),
            "tamper refusal must name the signature failure: {err:?}"
        );
        assert!(!cache_path(&dir).exists());
    }

    /* -- read_status: envelope + tamper-after-activation ---------------- */

    #[test]
    fn read_status_reports_active_and_reverifies_the_signature() {
        let dir = tmpdir("status-active");
        let token = issue_at(&hex_seed(&SEED_A), Plan::Team, 30, today_day(), &dir);
        // Tamper the CACHE after activation — read_status must refuse by name.
        let path = cache_path(&dir);
        let mut receipt: CacheFile =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        receipt.token.seats = 500;
        std::fs::write(&path, serde_json::to_string(&receipt).unwrap()).unwrap();
        let err =
            read_status_with(&dir, today_day(), &signer(&SEED_A).verifying_key()).unwrap_err();
        assert!(
            matches!(err, EngineError::Entitlement(ref m) if m.contains("signature verification failed")),
            "post-activation tamper is a named signature refusal: {err:?}"
        );
        let _ = token;
    }

    #[test]
    fn read_status_reports_grace_with_remaining_days() {
        let dir = tmpdir("status-grace");
        // Expired 5 days ago with a 30-day grace: still works, labeled grace.
        issue_at(&hex_seed(&SEED_A), Plan::Team, 10, today_day() - 15, &dir);
        let report = read_status_with(&dir, today_day(), &signer(&SEED_A).verifying_key()).unwrap();
        assert_eq!(report.status, "grace");
        assert_eq!(
            report.grace_days_remaining,
            Some(REVALIDATION_GRACE_DAYS - 5)
        );
        assert_eq!(report.days_until_revalidation, Some(0));
        assert_eq!(report.plan, "team");
        assert_eq!(report.seats_in_use, Some(1), "measured: this machine");
    }

    #[test]
    fn read_status_without_a_license_is_an_honest_not_activated_envelope() {
        let dir = tmpdir("status-none");
        let report = read_status_with(&dir, today_day(), &signer(&SEED_A).verifying_key()).unwrap();
        assert_eq!(report.status, "not-activated");
        assert_eq!(report.plan, "free");
        assert!(report.expiry.is_none());
        assert_eq!(report.tier_gated_surfaces.len(), SURFACE_REGISTRY.len());
        assert!(report.note.unwrap().contains("NEVER gated"));
    }

    /* -- gate: registry, refusals, free-tier pin ------------------------ */

    #[test]
    fn gate_never_blocks_core_or_unregistered_surfaces() {
        let dir = tmpdir("gate-free");
        let vk = signer(&SEED_A).verifying_key();
        // NO license at all: every core measured surface must pass.
        for surface in [
            "doctor",
            "graph",
            "health",
            "analyze",
            "export",
            "anything.unregistered",
        ] {
            let grant = gate_with(surface, &dir, today_day(), &vk).unwrap();
            assert!(!grant.grace);
            assert_eq!(grant.plan, Plan::Free);
        }
        // Even WITH an expired cache, core surfaces stay untouched.
        issue_at(&hex_seed(&SEED_A), Plan::Team, 5, today_day() - 365, &dir);
        let vk = signer(&SEED_A).verifying_key();
        for surface in ["doctor", "graph", "health"] {
            gate_with(surface, &dir, today_day(), &vk).unwrap();
        }
    }

    #[test]
    fn gate_refuses_premium_surfaces_without_a_license_by_name() {
        let dir = tmpdir("gate-no-license");
        let err = gate_with(
            "sync.push",
            &dir,
            today_day(),
            &signer(&SEED_A).verifying_key(),
        )
        .unwrap_err();
        match err {
            EngineError::SubscriptionRequired {
                surface,
                plan_required,
            } => {
                assert_eq!(surface, "sync.push");
                assert_eq!(plan_required, "team");
            }
            other => panic!("want SubscriptionRequired, got {other:?}"),
        }
        let err = gate_with(
            "sync.pull",
            &dir,
            today_day(),
            &signer(&SEED_A).verifying_key(),
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::SubscriptionRequired { .. }));
        assert!(
            !format!("{err}").is_empty(),
            "refusal carries a human message"
        );
    }

    #[test]
    fn gate_grants_premium_surfaces_for_a_qualifying_license() {
        let dir = tmpdir("gate-active");
        issue_at(&hex_seed(&SEED_A), Plan::Team, 30, today_day(), &dir);
        let grant = gate_with(
            "sync.push",
            &dir,
            today_day(),
            &signer(&SEED_A).verifying_key(),
        )
        .unwrap();
        assert!(!grant.grace);
        assert_eq!(grant.plan, Plan::Team);
    }

    #[test]
    fn gate_grants_in_grace_and_flags_it() {
        let dir = tmpdir("gate-grace");
        issue_at(&hex_seed(&SEED_A), Plan::Team, 10, today_day() - 12, &dir);
        let grant = gate_with(
            "sync.pull",
            &dir,
            today_day(),
            &signer(&SEED_A).verifying_key(),
        )
        .unwrap();
        assert!(
            grant.grace,
            "within the revalidation grace the surface works, labeled"
        );
    }

    #[test]
    fn gate_refuses_an_expired_license_beyond_grace_by_name() {
        let dir = tmpdir("gate-expired");
        issue_at(&hex_seed(&SEED_A), Plan::Team, 5, today_day() - 300, &dir);
        let err = gate_with(
            "sync.push",
            &dir,
            today_day(),
            &signer(&SEED_A).verifying_key(),
        )
        .unwrap_err();
        match err {
            EngineError::Entitlement(m) => {
                assert!(m.contains("expired"), "names the expiry: {m}");
                assert!(m.contains("sync.push"), "names the surface: {m}");
            }
            other => panic!("want Entitlement, got {other:?}"),
        }
    }

    #[test]
    fn gate_refuses_a_tampered_cache_by_name() {
        let dir = tmpdir("gate-tampered");
        issue_at(&hex_seed(&SEED_A), Plan::Team, 30, today_day(), &dir);
        let path = cache_path(&dir);
        let text = std::fs::read_to_string(&path).unwrap();
        // Forge enterprise entitlement inside the cache, keep the signature.
        let forged = text.replace("\"plan\":\"team\"", "\"plan\":\"enterprise\"");
        assert_ne!(text, forged, "fixture tamper must change the bytes");
        std::fs::write(&path, forged).unwrap();
        let err = gate_with(
            "sync.push",
            &dir,
            today_day(),
            &signer(&SEED_A).verifying_key(),
        )
        .unwrap_err();
        assert!(
            matches!(err, EngineError::Entitlement(ref m) if m.contains("signature")),
            "tampered cache is a named signature refusal: {err:?}"
        );
    }

    #[test]
    fn gate_refuses_a_deleted_license_on_premium_surfaces_only() {
        let dir = tmpdir("gate-deleted");
        issue_at(&hex_seed(&SEED_A), Plan::Team, 30, today_day(), &dir);
        std::fs::remove_file(cache_path(&dir)).unwrap();
        // Deleted token → named refusal on premium surfaces…
        let err = gate_with(
            "sync.push",
            &dir,
            today_day(),
            &signer(&SEED_A).verifying_key(),
        )
        .unwrap_err();
        assert!(
            matches!(err, EngineError::SubscriptionRequired { surface, .. } if surface == "sync.push")
        );
        // …and ZERO effect on core surfaces.
        gate_with(
            "doctor",
            &dir,
            today_day(),
            &signer(&SEED_A).verifying_key(),
        )
        .unwrap();
        gate_with("graph", &dir, today_day(), &signer(&SEED_A).verifying_key()).unwrap();
        gate_with(
            "health",
            &dir,
            today_day(),
            &signer(&SEED_A).verifying_key(),
        )
        .unwrap();
    }

    /* -- issue validation ------------------------------------------------ */

    #[test]
    fn issue_refuses_free_tokens_and_out_of_range_fields() {
        let seed = hex_seed(&SEED_A);
        let err = issue_signed(
            &IssueRequest {
                plan: Plan::Free,
                team: "acme".into(),
                days: 14,
                seats: 5,
            },
            &seed,
            20_000,
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::Entitlement(ref m) if m.contains("never issued")));
        for bad_days in [0u32, 36_501] {
            let err = issue_signed(
                &IssueRequest {
                    plan: Plan::Team,
                    team: "acme".into(),
                    days: bad_days,
                    seats: 5,
                },
                &seed,
                20_000,
            )
            .unwrap_err();
            assert!(matches!(err, EngineError::Entitlement(_)));
        }
        let err = issue_signed(
            &IssueRequest {
                plan: Plan::Team,
                team: String::new(),
                days: 14,
                seats: 5,
            },
            &seed,
            20_000,
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::Entitlement(_)));
        let err = issue_signed(
            &IssueRequest {
                plan: Plan::Team,
                team: "acme".into(),
                days: 14,
                seats: 5,
            },
            "zzzz",
            20_000,
        )
        .unwrap_err();
        assert!(matches!(err, EngineError::Entitlement(ref m) if m.contains("malformed hex")));
    }

    #[test]
    fn issue_is_deterministic_per_nonce_and_day_boundaries() {
        // Same seed + request + issuance day → identical payload bytes
        // except the nonce (random) — i.e. the signature differs only
        // through the nonce, never through hidden clock reads.
        let seed = hex_seed(&SEED_A);
        let req = || IssueRequest {
            plan: Plan::Enterprise,
            team: "acme".into(),
            days: 90,
            seats: 25,
        };
        let a = issue_signed(&req(), &seed, 20_000).unwrap();
        let b = issue_signed(&req(), &seed, 20_000).unwrap();
        assert_ne!(a.nonce, b.nonce, "each mint carries a fresh nonce");
        assert_eq!(a.issued_at_day, 20_000);
        assert_eq!(a.expiry_day, 20_090);
        // The nonce is the ONLY difference — day math is exact and no
        // hidden clock read enters the payload.
        assert_ne!(a.signature, b.signature, "fresh nonce ⇒ fresh signature");
    }

    #[test]
    fn keygen_writes_once_and_refuses_to_clobber() {
        let dir = tmpdir("keygen");
        let first = keygen(&dir).unwrap();
        assert_eq!(first.public_key_hex.len(), 64);
        let priv_text = std::fs::read_to_string(&first.private_key_path).unwrap();
        assert_eq!(priv_text.trim().len(), 64, "32-byte seed as hex");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&first.private_key_path)
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600, "private key file is operator-only");
        }

        let err = keygen(&dir).unwrap_err();
        assert!(
            matches!(err, EngineError::Entitlement(ref m) if m.contains("refusing to overwrite")),
            "keys are never silently replaced: {err:?}"
        );
    }

    /* -- E3 privacy guardrail ------------------------------------------- */

    /// The offline-only SOURCE pin lives in
    /// `engine/tests/entitlement_offline_pin.rs` (it scans this file's text
    /// for network API identifiers; the banned literals must not live in
    /// the scanned source itself). The emitted honesty notes stay pinned
    /// here: the envelope must keep telling the operator the truth.
    #[test]
    fn envelope_honesty_notes_name_offline_verification_and_local_clock() {
        assert!(VERIFICATION_NOTE.contains("zero network I/O"));
        assert!(CLOCK_NOTE.contains("LOCAL wall clock"));
        assert!(SEATS_NOTE.contains("this machine only"));
    }
}
