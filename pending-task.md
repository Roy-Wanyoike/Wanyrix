# WANYRIX — MASTER PRODUCT COMPLETION, VALIDATION & COMMERCIAL READINESS PROMPT

## Mission

You are the complete autonomous engineering, product, QA, security, SRE, UX, documentation, and commercialization team for:

# Wanyrix — Engineering Intelligence Platform

Wanyrix is an evidence-first engineering intelligence platform for Rust and performance-critical systems.

Its purpose is to continuously help engineers:

> OBSERVE → UNDERSTAND → DIAGNOSE → EXPLAIN → RECOMMEND → CHANGE → VERIFY → MEASURE → LEARN

Wanyrix must be capable of running **fully offline/local-first** while also supporting a richer **online/cloud-connected mode**.

The goal of this phase is not to merely verify that features exist.

The goal is to determine whether Wanyrix is actually ready to be:

* installed by a real developer
* used against a real Rust repository
* operated offline
* operated online
* trusted with engineering data
* used continuously
* demonstrated to developers
* deployed by teams
* eventually sold commercially

Do not assume previous implementation is correct.

Do not assume previous agents completed their work.

Do not trust documentation over implementation.

Do not trust implementation over tests.

Do not trust tests without validating that they test the actual behavior.

Everything must be discovered, verified, tested, and reconciled.

---

# 1. NON-NEGOTIABLE OPERATING PRINCIPLES

Follow these principles throughout the entire execution.

### Evidence over assumption

Never declare something implemented merely because:

* a file exists
* an endpoint exists
* a component exists
* a TODO was removed
* a test exists
* documentation claims it exists

Verify actual behavior.

### Local-first

Wanyrix must provide meaningful engineering intelligence without requiring:

* internet access
* cloud account
* API key
* AI provider
* hosted database
* hosted Wanyrix account

The deterministic engineering core must remain functional offline.

### Online-enhanced

When connectivity exists, Wanyrix may provide:

* cloud synchronization
* historical analytics
* team collaboration
* fleet intelligence
* hosted AI
* centralized policy
* organization management
* remote repositories
* telemetry aggregation
* enterprise features

Online functionality must enhance Wanyrix rather than become a hidden dependency for core functionality.

### AI is never the source of truth

AI may:

* explain evidence
* summarize evidence
* generate investigation paths
* propose recommendations
* propose patches

AI must never:

* invent measurements
* invent files
* invent dependencies
* invent build results
* claim verification without verification
* modify source code silently
* override deterministic evidence

### No silent data transmission

Source code, repository information, telemetry, credentials, or sensitive engineering data must never leave the local environment unexpectedly.

Every online transmission path must be:

* explicit
* documented
* configurable
* auditable
* secure

### No incomplete work

Do not leave:

* unresolved implementation gaps
* placeholder production features
* broken tests
* unexplained failures
* undocumented behavior
* abandoned TODOs
* knowingly broken workflows

If something cannot be completed in this phase, create a GitHub issue with an explicit reason, dependency, owner, and release impact.

---

# 2. FIRST STEP — COMPLETE DISCOVERY

Before changing anything, inspect the repository completely.

Inspect:

* repository structure
* README
* documentation
* architecture documentation
* Cargo workspace
* crates
* binaries
* frontend
* backend
* schemas
* protobuf
* migrations
* configuration
* Docker
* infrastructure
* tests
* fixtures
* benchmarks
* examples
* scripts
* CI/CD
* Git history
* branches
* tags
* open issues
* open PRs
* TODOs
* FIXME markers
* feature flags
* environment variables
* dependency versions
* security configuration
* release configuration

Also inspect the complete Git history to understand:

* what was actually implemented
* what was renamed
* what was removed
* what remains unfinished
* previous architectural decisions
* abandoned implementations
* partially completed features
* regressions

Do not recreate functionality that already exists.

Do not delete working functionality merely because it is undocumented.

---

# 3. BUILD A CURRENT SYSTEM BASELINE

Produce an internal baseline covering:

## Product

* What Wanyrix currently does
* What users can actually do
* What is missing
* What is partially implemented
* What is broken
* What is experimental
* What is production-ready

## Architecture

Map:

```text
CLI
 ↓
Daemon
 ↓
Engine
 ↓
Collectors
 ↓
W-EIR
 ↓
Engineering Graph
 ↓
Analyzers
 ↓
Findings
 ↓
Recommendations
 ↓
Experiments
 ↓
Measurements
 ↓
Verification
```

And online:

```text
Wanyrix Local
 ↓
Secure Sync
 ↓
Wanyrix Cloud
 ↓
Organizations
 ↓
Repositories
 ↓
Snapshots
 ↓
Analytics
 ↓
AI
 ↓
Policies
 ↓
Fleet Intelligence
```

## Runtime state

Determine what currently runs successfully.

Record:

* build commands
* test commands
* startup commands
* dependencies
* required services
* required environment variables
* optional services
* ports
* storage
* configuration
* authentication
* network requirements

---

# 4. PRODUCT CONTRACT

Validate Wanyrix against this core promise:

> Point Wanyrix at a real Rust repository and receive a continuously updated, trustworthy engineering model connecting Cargo, rustc, rust-analyzer, Git, builds, tests, dependencies, toolchains, runtime observations, findings, recommendations, experiments, and measurements.

The core user journey must work:

```text
Install
 ↓
wanyrix init
 ↓
Repository discovery
 ↓
Initial analysis
 ↓
W-EIR generation
 ↓
Engineering graph
 ↓
Build intelligence
 ↓
Findings
 ↓
wanyrix doctor
 ↓
Evidence
 ↓
Impact
 ↓
Recommendation
 ↓
Experiment
 ↓
Baseline
 ↓
Candidate
 ↓
Test
 ↓
Benchmark
 ↓
Measurement
 ↓
Verification
```

A developer must be able to complete this flow on a real or representative Rust repository.

---

# 5. OFFLINE-FIRST PRODUCT VALIDATION

This is a critical requirement.

Create a completely isolated offline environment.

Disable:

* internet
* external APIs
* cloud services
* hosted AI
* remote telemetry
* external package access where practical

Then validate:

```bash
wanyrix --version
wanyrix init
wanyrix status
wanyrix doctor
wanyrix analyze
wanyrix dependencies
wanyrix graph
wanyrix findings
wanyrix explain
wanyrix experiment
wanyrix verify
wanyrix storage
wanyrix daemon start
wanyrix daemon stop
```

Determine which commands work offline.

Core functionality MUST NOT depend on the cloud.

At minimum, offline mode must support:

* repository discovery
* Cargo intelligence
* dependency intelligence
* W-EIR
* engineering graph
* Git intelligence
* build analysis where locally available
* findings
* deterministic diagnosis
* recommendations
* local experiments
* measurements
* verification
* local storage
* local history
* machine-readable JSON
* local documentation/help

If AI is unavailable:

> Wanyrix must continue operating normally for deterministic functionality.

The UI must clearly indicate offline mode.

---

# 6. ONLINE MODE VALIDATION

When network connectivity is available, validate:

```text
Local
 ↓
Authentication
 ↓
Organization
 ↓
Repository
 ↓
Secure synchronization
 ↓
Cloud snapshot
 ↓
Analytics
 ↓
AI
 ↓
History
 ↓
Policies
```

Validate:

* authentication
* authorization
* tenant isolation
* repository registration
* secure synchronization
* snapshot synchronization
* conflict handling
* retry behavior
* offline queueing
* reconnection
* duplicate event handling
* audit logs
* cloud failure recovery
* local functionality during cloud outage

If the network disappears during synchronization:

```text
Local state must remain valid.
No data corruption.
No duplicated records.
No lost authoritative observations.
Synchronization resumes safely.
```

---

# 7. OFFLINE ↔ ONLINE TRANSITION

This must be treated as a first-class product capability.

Test:

### Offline → Online

```text
Developer works offline
↓
Analyses repository
↓
Creates snapshots/findings/experiments
↓
Network returns
↓
Wanyrix synchronizes
↓
Cloud receives valid state
```

### Online → Offline

```text
Developer loses connectivity
↓
Wanyrix detects offline state
↓
Local operation continues
↓
No destructive errors
↓
Local state accumulates safely
```

### Repeated transitions

Test:

```text
online
offline
online
offline
online
```

with:

* analysis
* findings
* experiments
* measurements
* configuration changes
* interrupted synchronization

Validate idempotency and consistency.

---

# 8. W-EIR VALIDATION

Validate W-EIR completely.

Entities include:

* Repository
* Workspace
* Package
* Crate
* Target
* Module
* Symbol
* Dependency
* Feature
* Build
* Test
* Benchmark
* GitCommit
* Toolchain
* RuntimeObservation
* Finding
* Evidence
* Recommendation
* Experiment
* Measurement
* PatchProposal
* AnalysisSnapshot

Every entity must have appropriate:

* stable identity
* relationships
* provenance
* version
* source references
* confidence where applicable

Explicitly distinguish:

```text
AUTHORITATIVE OBSERVATION
INFERENCE
RECOMMENDATION
ESTIMATE
MEASUREMENT
VERIFIED RESULT
```

W-EIR snapshots must include:

* repository identity
* commit SHA
* Wanyrix version
* rustc version
* Cargo version
* toolchain
* target
* OS
* architecture
* configuration hash
* Cargo.lock hash
* analysis version
* timestamp

Test semantic reproducibility.

Same:

```text
repository
commit
Cargo.lock
toolchain
configuration
Wanyrix version
```

must produce semantically equivalent deterministic output.

---

# 9. REPOSITORY INTELLIGENCE VALIDATION

Validate discovery of:

* Cargo.toml
* Cargo.lock
* workspace
* packages
* crates
* targets
* dependencies
* transitive dependencies
* workspace dependencies
* optional dependencies
* target-specific dependencies
* features
* examples
* benches
* build scripts
* proc macros
* toolchains
* rustc metadata
* Git state
* Git history
* changed files
* changed modules
* changed crates

Target:

> ≥99.5% authoritative agreement with Cargo for supported repository metadata.

No:

* phantom dependencies
* missing dependencies
* incorrect versions
* incorrect package relationships

---

# 10. ENGINEERING GRAPH VALIDATION

Validate relationships such as:

```text
Repository
 ↓
Workspace
 ↓
Package
 ↓
Crate
 ↓
Module
 ↓
Symbol
 ↓
Dependency
 ↓
Feature
 ↓
Build
 ↓
Test
 ↓
Git
 ↓
Runtime
 ↓
Finding
 ↓
Experiment
 ↓
Measurement
```

The graph must answer:

* What depends on X?
* What changes if X changes?
* Why did this rebuild?
* Which crates are on the critical path?
* Which modules depend on infrastructure?
* Which areas changed most?
* Did an experiment improve anything?

The graph must be useful rather than decorative.

---

# 11. BUILD INTELLIGENCE

Validate:

* build duration
* crate compilation duration
* critical path
* dependency ordering
* parallelism
* proc macros
* build scripts
* duplicate dependencies
* feature expansion
* cache behavior
* incremental compilation
* rebuild scope
* compiler activity
* workspace structure
* CI builds where supported

Wanyrix should answer:

> Why is this build slow?

> Why did this crate rebuild?

> What is causing the rebuild?

> What depends on this crate?

> What would changing this dependency affect?

Never make unsupported causality claims.

---

# 12. CRITICAL PATH

Create deterministic fixtures where expected critical paths are known.

Require:

> 100% correctness on deterministic fixtures.

Where parallel execution produces ambiguity:

Do not fabricate a single answer.

Represent:

* possible paths
* equivalent paths
* uncertainty
* concurrency

---

# 13. INCREMENTAL INTELLIGENCE

Validate:

* filesystem watching
* Git-aware invalidation
* dependency-aware invalidation
* incremental W-EIR
* incremental graph
* incremental analyzers
* cache reuse

Target:

> ≥95% reduction in analysis work for localized changes where the dependency graph permits it.

Test:

* one-line change
* single module change
* single crate change
* dependency change
* Cargo.toml change
* Cargo.lock change
* feature change
* toolchain change
* workspace restructuring

Wanyrix must explain broad invalidation when it occurs.

---

# 14. FINDINGS & DIAGNOSIS

Validate findings categories:

* Build
* Dependency
* Rebuild
* Architecture
* Performance
* Tooling
* Runtime
* Security

Every finding requires:

* stable ID
* category
* severity
* title
* description
* affected entities
* evidence
* impact
* confidence
* recommendation
* provenance

Every actionable finding must have a remediation path.

Target:

> ≥90% precision for high-confidence findings on controlled fixtures.

---

# 15. WANYRIX DOCTOR

`wanyrix doctor` is the flagship user experience.

Validate output similar to:

```text
WANYRIX DOCTOR

Repository
my-rust-project

Build
42.8 seconds

HIGH

Crate: compiler-core

Evidence
- 11.4s compilation time
- 37 downstream dependents
- critical build path

Impact
Changes to compiler-core can affect a large portion of workspace.

Recommendation
Investigate dependency boundary and incremental compilation scope.

Confidence
HIGH

Verification
Create experiment
```

The output must distinguish:

```text
Evidence
Impact
Inference
Recommendation
Confidence
Verification
```

No vague AI-generated statements should replace evidence.

---

# 16. EXPERIMENT ENGINE

Validate:

```text
Finding
 ↓
Recommendation
 ↓
Experiment
 ↓
Baseline
 ↓
Candidate
 ↓
Check
 ↓
Test
 ↓
Benchmark
 ↓
Compare
 ↓
Measurement
 ↓
Verification
```

Each experiment must record:

* ID
* repository
* commit
* baseline
* candidate
* environment
* toolchain
* commands
* tests
* benchmarks
* measurements
* result
* verification

Never call an estimated improvement a measured improvement.

Never call a measured improvement verified until verification actually occurred.

---

# 17. SAFE PATCHING

Validate:

```text
Finding
 ↓
Recommendation
 ↓
Patch Proposal
 ↓
Diff
 ↓
Developer Approval
 ↓
Sandbox
 ↓
cargo check
 ↓
cargo test
 ↓
benchmark
 ↓
comparison
```

Requirements:

* no silent modifications
* explicit developer approval
* reviewable diff
* isolated execution
* verification before claims
* rollback/recovery

---

# 18. AI ENGINEERING INTELLIGENCE

Validate AI support for:

* explaining findings
* repository questions
* dependency impact
* build bottlenecks
* architecture explanations
* investigation paths
* optimization ideas
* experiment explanations
* candidate patches

Support pluggable providers where implemented:

* OpenAI
* Anthropic
* Gemini
* local models
* enterprise providers

AI must be optional.

Test AI adversarially:

* invent dependency
* fabricate file
* fabricate measurement
* contradict build data
* claim verification without experiment
* invent architecture violation

Target:

> 0 authoritative-evidence contradictions.

AI responses must clearly distinguish:

```text
FACT
INFERENCE
RECOMMENDATION
UNCERTAINTY
```

---

# 19. ARCHITECTURE INTELLIGENCE

Validate:

* module coupling
* dependency direction
* circular dependencies
* fan-in/fan-out
* boundaries
* unstable interfaces
* oversized modules
* change concentration
* architecture drift
* architecture rules

Enforce architectural rules such as:

```text
Domain MUST NOT depend on infrastructure.

Core MUST NOT depend on AI vendors.

Core MUST NOT depend on cloud providers.

Analysis MUST NOT depend on UI.

Domain MUST NOT depend directly on database implementations.
```

Architecture boundaries must be CI-enforced.

---

# 20. RUNTIME INTELLIGENCE

Where implemented, validate:

* OpenTelemetry
* metrics
* traces
* logs
* profiling
* runtime events

Correlate:

```text
Service
 ↓
Binary
 ↓
Crate
 ↓
Module
 ↓
Git Commit
 ↓
Finding
```

Never claim causality where evidence does not support it.

Represent uncertainty.

---

# 21. HISTORICAL INTELLIGENCE

Validate:

```text
Commit
 ↓
Snapshot
 ↓
Build
 ↓
Findings
 ↓
Experiments
 ↓
Measurements
```

Support historical views for:

* build trends
* dependency trends
* architecture drift
* regressions
* experiment history
* findings history

---

# 22. SECURITY VALIDATION

Perform a complete security audit.

Validate:

* authentication
* authorization
* tenant isolation
* secrets handling
* secret redaction
* credential storage
* encryption
* TLS
* local storage security
* cloud storage
* API security
* dependency vulnerabilities
* SBOM
* SAST
* supply-chain controls
* signed releases
* sandboxing
* patch execution security
* AI prompt/data boundaries
* repository privacy

Test known fixture secrets.

Target:

> 100% known fixture secrets redacted before cloud/AI transmission.

Require:

> 0 committed secrets.

Require:

> 0 unexpected source-code transmission in local-only mode.

---

# 23. PRIVACY

Document exactly:

* what data is collected
* what remains local
* what may be synchronized
* what AI providers receive
* when source code leaves the machine
* how users disable synchronization
* how users disable AI
* retention policies
* deletion behavior
* organization controls

Create an explicit:

```text
Privacy & Data Flow
```

document.

---

# 24. RELIABILITY & CHAOS VALIDATION

Test:

* compiler failure
* Cargo failure
* Git failure
* disk full
* cache corruption
* daemon interruption
* database interruption
* network failure
* cloud failure
* AI provider failure
* synchronization interruption
* malformed repository
* corrupted snapshot
* interrupted experiment
* interrupted patch execution

The system must recover without corrupting authoritative state.

Kill the daemon during:

* writes
* analysis
* snapshot generation
* graph construction
* synchronization
* experiments
* cache operations

After restart:

```text
SQLite integrity_check = PASS
```

---

# 25. 24-HOUR DAEMON SOAK TEST

Run a representative daemon for at least 24 hours.

Monitor:

* memory
* CPU
* disk
* file descriptors
* cache growth
* database size
* logs
* event queues
* analysis latency
* error rate
* recovery behavior

Acceptance:

* 0 crashes
* 0 database corruption
* 0 unrecoverable state transitions
* bounded memory
* bounded disk growth
* successful recovery

---

# 26. PERFORMANCE VALIDATION

Validate:

* cold startup
* warm startup
* analysis
* incremental analysis
* doctor
* graph queries
* large repositories
* concurrent operations

Targets:

```text
p95 non-analysis CLI startup <150ms

p95 warm localized incremental analysis <1s

p95 medium-repository doctor <10s

idle daemon <100MB RAM

250-crate workspace <1GB RSS unless justified

500+ crate synthetic repository completes without pathological memory growth/crash
```

Any regression greater than 10% must receive an investigation.

---

# 27. TEST MATRIX

Maintain:

### Unit

Domain logic, parsers, analyzers, graph operations.

### Integration

Cross-component behavior.

### Contract

CLI/API/W-EIR/protobuf/event contracts.

### Golden

Stable expected outputs.

### Fixture

Realistic Rust repositories.

### Performance

Benchmarks and resource consumption.

### Failure

Failure injection.

### Recovery

Restart/recovery tests.

### Security

Threat and abuse tests.

### E2E

Full product workflow.

Minimum fixtures:

1. Single crate
2. Workspace
3. Large workspace
4. Async-heavy
5. Proc-macro-heavy
6. Build-script-heavy
7. Dependency-heavy
8. Feature-heavy
9. Architecture-problematic
10. Clean baseline

Also create:

> ≥500-crate synthetic repository.

Run the complete suite repeatedly.

Target:

> 100 consecutive full-suite runs with zero flaky failures.

Any quarantined test requires:

* owner
* issue
* reason
* mitigation
* expiry/review date

---

# 28. CLI VALIDATION

Validate stable:

```bash
--help
--version
--json
```

Machine-readable JSON must have a documented schema.

Document exit codes.

Ensure scripts can reliably consume Wanyrix output.

---

# 29. STORAGE

Validate local storage.

Implement/verify:

```bash
wanyrix storage
```

It must expose:

* storage usage
* cache usage
* logs
* snapshots
* cleanup
* retention
* corruption checks where appropriate

Prevent unbounded:

* cache
* temporary files
* logs
* snapshots

---

# 30. FRONTEND PRODUCT VALIDATION

Validate:

* Overview
* Repositories
* Builds
* Dependencies
* Graph
* Findings
* Architecture
* Experiments
* Runtime
* History
* AI
* Policies
* Organization
* Settings

Repository overview should expose:

* build health
* critical path
* top findings
* dependency risk
* architecture
* recent changes
* regressions
* experiments
* runtime

Finding screen:

* title
* severity
* confidence
* evidence
* impact
* affected crates/modules
* Git history
* recommendation
* create experiment
* AI explanation

Experiment screen:

* baseline
* candidate
* tests
* benchmark
* measurement
* verification
* methodology

The graph must answer engineering questions and not exist merely for visual appeal.

---

# 31. USER EXPERIENCE VALIDATION

Recruit or simulate at least 10 Rust developers.

Give them tasks such as:

1. Install Wanyrix.
2. Analyze a repository.
3. Find the slowest build area.
4. Understand why a crate rebuilds.
5. Identify dependency impact.
6. Investigate an architecture issue.
7. Create an experiment.
8. Verify an optimization.
9. Work offline.
10. Reconnect online.

Measure:

* completion rate
* time to completion
* errors
* confusion
* number of facilitator interventions
* discoverability

Target:

> ≥70% task completion without facilitator.

At least:

> 7/10 users should independently articulate a concrete benefit.

---

# 32. INSTALLATION & DISTRIBUTION

A new developer must be able to go from:

```text
"I found Wanyrix"
```

to:

```text
"I have useful engineering intelligence"
```

with minimal friction.

Validate:

* macOS
* Linux
* supported Windows path if implemented
* clean machine
* clean clone
* package installation
* binary installation
* upgrades
* uninstall
* version compatibility

Create a release process for:

* binaries
* checksums
* signatures where supported
* SBOM
* version metadata

---

# 33. README REBUILD

Do not merely append to the existing README.

Rewrite it into a polished product README.

It must clearly explain:

### What Wanyrix is

### Why it exists

### Who it is for

### What problems it solves

### How it works

### Offline mode

### Online mode

### Core architecture

### Installation

### Quick start

### First analysis

### `wanyrix doctor`

### Findings

### Experiments

### AI

### Security/privacy

### Cloud

### CLI reference

### Example output

### Development

### Contribution

### Roadmap

### Commercial model

### License

The README should be understandable to both:

* senior engineers
* potential customers/investors

Avoid marketing claims that cannot be demonstrated.

---

# 34. CREATE A COMPLETE USER GUIDE

Create:

```text
docs/USER_GUIDE.md
```

Cover:

1. Installation
2. Requirements
3. First repository
4. `wanyrix init`
5. Repository discovery
6. `wanyrix analyze`
7. `wanyrix doctor`
8. Findings
9. Dependencies
10. Engineering graph
11. Build intelligence
12. Incremental analysis
13. Experiments
14. Verification
15. Safe patches
16. AI
17. Offline mode
18. Online mode
19. Synchronization
20. Storage
21. Configuration
22. Security
23. Privacy
24. Troubleshooting
25. CLI reference
26. Performance
27. FAQ

A developer should be able to use Wanyrix without contacting the engineering team.

---

# 35. CREATE DOCUMENTATION SET

Ensure these exist and are accurate:

```text
README.md
ARCHITECTURE.md
DEVELOPMENT.md
CONTRIBUTING.md
SECURITY.md
THREAT_MODEL.md
W-EIR.md
CLI.md
PERFORMANCE.md
PLUGIN_API.md
USER_GUIDE.md
PRIVACY.md
DATA_FLOW.md
OPERATIONS.md
RELEASE.md
COMMERCIAL.md
```

Documentation must match the implementation.

---

# 36. COMMERCIAL PRODUCT MODEL

Design a commercially viable pricing model.

Wanyrix should have a generous:

# 90-DAY FREE TRIAL

The goal is to let engineering teams experience meaningful value before paying.

Do not design pricing merely around API calls.

Price around customer value and usage.

Propose and implement the commercial model conceptually as:

## Free Trial — 90 Days

Suitable for:

* individual developers
* evaluation teams
* hackathons
* open-source projects
* proof of concept

Potential limits:

* limited cloud storage
* limited historical retention
* limited team members
* limited cloud AI usage
* limited repositories

Core local/offline functionality should remain usable without requiring payment.

---

## Developer / Individual

For individual engineers who want persistent cloud history and advanced capabilities.

Possible capabilities:

* unlimited local analysis
* cloud history
* advanced findings
* experiments
* AI allowance
* repository history
* enhanced analytics

---

## Team

For engineering teams.

Capabilities:

* multiple developers
* shared repositories
* team dashboards
* organization policies
* shared findings
* historical intelligence
* team analytics
* increased AI allowance
* centralized administration
* audit logs

---

## Business / Enterprise

For organizations with advanced requirements.

Capabilities:

* SSO/SAML/OIDC
* SCIM
* private deployment
* enterprise policies
* advanced security
* audit controls
* custom retention
* private AI models/providers
* dedicated infrastructure
* fleet intelligence
* advanced integrations
* SLA/support

---

# 37. PRICING EXPERIMENTATION

Do not hard-code pricing prematurely.

Create a pricing model abstraction supporting:

```text
Plan
Features
Limits
Usage
Seats
Repositories
AI allowance
Storage
Retention
Organization features
Enterprise capabilities
```

Pricing should be configurable.

Support future pricing experiments without rewriting the billing architecture.

Document:

* trial rules
* conversion
* limits
* overages
* cancellation
* upgrades
* downgrades
* billing periods
* data retention
* trial expiration behavior

Do not allow billing logic to affect local deterministic engineering functionality.

---

# 38. PRODUCT PACKAGING

Define clearly:

### Wanyrix Local

Free/local-first engineering intelligence.

### Wanyrix Cloud

Cloud history, collaboration, analytics and AI.

### Wanyrix Team

Team engineering intelligence.

### Wanyrix Enterprise

Enterprise security, deployment and governance.

Do not artificially cripple core engineering analysis simply to force cloud adoption.

The commercial value should come from:

* collaboration
* persistence
* history
* analytics
* governance
* automation
* fleet intelligence
* enterprise controls
* advanced AI
* hosted infrastructure

---

# 39. BILLING ARCHITECTURE

If billing is already implemented, audit it.

If not implemented, create the appropriate architecture and issues without destabilizing the local core.

Potential model:

```text
Organization
 ↓
Subscription
 ↓
Plan
 ↓
Entitlements
 ↓
Usage
 ↓
Limits
 ↓
Billing
 ↓
Invoices
 ↓
Payment
 ↓
Audit
```

Requirements:

* idempotent billing events
* immutable billing records
* audit trail
* safe retries
* no double charging
* timezone-safe periods
* trial state machine
* subscription state machine
* entitlement enforcement
* grace periods
* cancellation
* renewal

Never allow billing failures to corrupt engineering data.

---

# 40. CLOUD ARCHITECTURE VALIDATION

Cloud should support:

* organizations
* users
* repositories
* snapshots
* history
* analytics
* AI orchestration
* policies
* fleet intelligence
* audit

Potential architecture:

```text
Next.js
 ↓
API
 ↓
Go Control Plane
 ↓
PostgreSQL
 ↓
NATS JetStream
 ↓
Workers / Temporal
 ↓
ClickHouse
 ↓
S3
```

Local remains:

```text
Rust CLI
 ↓
Rust Daemon
 ↓
Rust Engine
 ↓
SQLite
```

Do not introduce cloud dependencies into the deterministic Rust core.

---

# 41. EVENT ARCHITECTURE

Validate versioned events:

```text
RepositoryDiscovered
AnalysisStarted
AnalysisCompleted
SnapshotCreated
BuildObserved
FindingCreated
ExperimentStarted
ExperimentCompleted
MeasurementRecorded
```

Requirements:

* versioned schemas
* validation
* traceability
* idempotency
* compatibility
* replayability

Use NATS JetStream for durable asynchronous event processing where appropriate.

Use Temporal for genuinely long-running workflows such as:

* large repository analysis
* historical indexing
* experiment execution
* fleet analysis
* AI workflows
* synchronization

Do not use Temporal for trivial local operations.

---

# 42. OBSERVABILITY

Validate:

* OpenTelemetry
* metrics
* traces
* structured logs
* correlation IDs
* error tracking
* health checks

Never expose sensitive repository contents through telemetry by default.

Telemetry should make every major analysis job traceable.

---

# 43. PLUGIN ARCHITECTURE

Validate stable boundaries for:

* Analyzer
* Collector
* Formatter
* RuntimeAdapter
* AIProvider
* CIProvider
* RepositoryProvider

Ensure plugins cannot compromise the core.

Marketplace is not required for MVP, but extension boundaries must be clean.

---

# 44. ARCHITECTURAL QUALITY GATE

Run dependency analysis against the source tree.

Fail if:

```text
core → cloud provider
core → AI vendor
domain → infrastructure
domain → DB implementation
analysis → UI
```

Fail on foundational circular dependencies.

The architecture should allow future cloud, AI, storage, and UI replacements without rewriting the domain.

---

# 45. ISSUE MANAGEMENT

After discovery and baseline:

Create GitHub issues for every meaningful gap.

Each issue must contain:

```text
Title
Problem
Current State
Expected State
Evidence
Impact
Acceptance Criteria
Dependencies
Testing Requirements
Security Considerations
Performance Considerations
Documentation Requirements
```

Deduplicate existing issues.

Do not create duplicate issues.

---

# 46. ENGINEERING TEAM DISPATCH

Dispatch specialized agents according to issue ownership.

Possible teams:

### Principal Engineer

Architecture and cross-system correctness.

### Rust Systems Engineers

Core engine, daemon, collectors, storage.

### Cargo/Compiler Specialists

Cargo, rustc, rust-analyzer and build intelligence.

### Graph Engineers

W-EIR and engineering graph.

### Performance Engineers

Benchmarking, memory, incremental analysis.

### Backend Engineers

Cloud/control-plane systems.

### Frontend Engineers

Web application.

### AI Engineers

Evidence-grounded AI.

### Security Engineers

Security/privacy/supply chain.

### QA Engineers

Functional, integration, E2E and regression.

### SRE

Reliability, observability, chaos, deployment.

### UX/Product

User journeys, onboarding, pricing, documentation.

### Technical Writers

README and guides.

Agents must inspect the repository before modifying anything.

---

# 47. DEVELOPMENT WORKFLOW

Strictly enforce:

```text
GitHub Issue
 ↓
One coherent implementation
 ↓
One PR
 ↓
Automated tests
 ↓
Review
 ↓
Merge
 ↓
Verification
 ↓
Issue closure
```

Do not:

* push directly to protected branches
* combine unrelated features
* create giant unrelated PRs
* close issues without verification
* leave known failures unresolved
* silently modify behavior

---

# 48. QA MUST RUN IN PARALLEL

Engineering agents implement.

QA agents continuously test:

* current behavior
* changed behavior
* regression risk
* edge cases
* failure conditions
* offline mode
* online mode
* transition behavior

Security and performance teams also work in parallel.

Do not wait until the end to discover integration failures.

---

# 49. FULL END-TO-END ACCEPTANCE TEST

Execute the complete journey against a real representative Rust repository:

```text
Clean machine
 ↓
Install Wanyrix
 ↓
wanyrix init
 ↓
Discover repository
 ↓
Create W-EIR
 ↓
Create engineering graph
 ↓
Analyze build
 ↓
Run doctor
 ↓
Detect intentional engineering problem
 ↓
Show evidence
 ↓
Show impact
 ↓
Show recommendation
 ↓
Create experiment
 ↓
Create baseline
 ↓
Create candidate
 ↓
Run checks
 ↓
Run tests
 ↓
Run benchmark
 ↓
Compare
 ↓
Record measurement
 ↓
Verify result
 ↓
Persist history
 ↓
Go offline
 ↓
Continue working
 ↓
Reconnect
 ↓
Synchronize
 ↓
Verify cloud state
```

This entire workflow must succeed.

---

# 50. RELEASE BLOCKERS

Release must be blocked by:

* critical security issue
* database corruption
* unrecoverable daemon
* incorrect deterministic findings
* incorrect dependency graph
* silent source-code transmission
* silent AI modifications
* reproducibility failure
* critical architecture violation
* flaky critical tests
* unbounded memory
* unbounded disk growth
* major unexplained performance regression
* missing evidence
* false verified claims
* broken offline core
* broken offline→online synchronization
* billing corruption

---

# 51. RELEASE CATEGORIES

Do not use a simplistic aggregate score.

Use:

```text
GO
CONDITIONAL GO
NO-GO
```

with evidence.

Every conditional item must have:

* issue
* owner
* impact
* workaround
* release decision
* planned resolution

---

# 52. FINAL PRODUCT READINESS REVIEW

Perform an independent final review from five perspectives.

## Developer

Would I install and use this?

## Engineering Leader

Does this provide actionable engineering intelligence?

## Security Leader

Would I trust it with proprietary source code?

## SRE

Can it operate continuously and recover from failure?

## Buyer

Is there enough durable value to pay for it?

Do not manufacture positive answers.

Document weaknesses honestly.

---

# 53. INVESTOR/PRODUCT VALIDATION

Evaluate whether Wanyrix demonstrates a differentiated product thesis:

### Problem

Engineering teams struggle to understand why systems become:

* slow
* expensive
* risky
* difficult to change

### Product

Wanyrix builds an evidence-backed engineering model rather than merely generating AI suggestions.

### Differentiation

The platform connects:

```text
Code
+
Cargo
+
Compiler
+
Dependencies
+
Builds
+
Git
+
Runtime
+
Architecture
+
Experiments
+
Measurements
```

into a continuously updated engineering intelligence layer.

### Defensibility

Look for:

* W-EIR
* engineering graph
* historical engineering data
* reproducible analysis
* experiment history
* evidence provenance
* domain-specific analyzers
* engineering intelligence workflows
* developer trust

Do not make unsupported market-size or revenue claims.

---

# 54. COMMERCIAL DOCUMENTATION

Create:

```text
docs/COMMERCIAL.md
```

Document:

* product tiers
* 90-day trial
* local vs cloud
* feature entitlements
* pricing architecture
* usage model
* billing states
* enterprise model
* trial conversion
* retention
* cancellation
* upgrade/downgrade
* future pricing experimentation

Do not hard-code arbitrary final prices unless a product decision has already been approved.

Instead define a configurable initial pricing proposal and clearly mark it as subject to market validation.

---

# 55. PRODUCT ROADMAP

Document the progression:

## Phase 1

Core Runtime

## Phase 2

Rust Repository Intelligence

## Phase 3

Engineering Graph

## Phase 4

Build Intelligence

## Phase 5

Findings & Diagnosis

## Phase 6

Incremental Intelligence

## Phase 7

Engineering Experiments

## Phase 8

AI Engineering Intelligence

## Phase 9

Safe AI Patches

## Phase 10

Architecture Intelligence

## Phase 11

Runtime Intelligence

## Phase 12

Historical & Team Intelligence

## Phase 13

Wanyrix Cloud

## Phase 14

Fleet & Enterprise Intelligence

## Phase 15

Product Validation & Commercialization

Do not allow future roadmap features to destabilize the current product.

---

# 56. FINAL DOCUMENTATION AUDIT

After implementation, compare:

```text
README
USER GUIDE
ARCHITECTURE
CLI
W-EIR
SECURITY
PRIVACY
THREAT MODEL
PERFORMANCE
COMMERCIAL
```

against actual code.

For every discrepancy:

* fix the documentation
* or fix the implementation

Never knowingly leave documentation describing nonexistent behavior.

---

# 57. FINAL CLEAN-ROOM VALIDATION

Create a clean environment.

Do not use:

* developer-specific configuration
* cached state
* undocumented environment variables
* manually prepared databases
* hidden files
* previous local state

Perform:

```text
Install
 ↓
Initialize
 ↓
Analyze
 ↓
Doctor
 ↓
Find
 ↓
Experiment
 ↓
Verify
```

Then repeat in offline mode.

Then repeat with online synchronization.

---

# 58. FINAL ACCEPTANCE GATES

Wanyrix is considered ready only if all applicable gates pass:

1. Clean installation works.
2. Core CLI works offline.
3. Repository discovery ≥99.5% supported Cargo agreement.
4. Cargo graph has no unexplained missing/phantom dependencies.
5. W-EIR snapshots are schema-valid.
6. Analysis is reproducible.
7. Incremental analysis meets target where graph permits.
8. Performance targets pass.
9. Memory targets pass.
10. Storage growth is bounded.
11. Build ingestion meets supported-event target.
12. Critical-path fixtures are correct.
13. Findings contain evidence.
14. High-confidence finding precision ≥90% on controlled fixtures.
15. Confidence and measurement states are correctly separated.
16. Dependency blast radius is correct.
17. Git impact is correct.
18. Doctor produces actionable findings.
19. AI produces zero authoritative-evidence contradictions in adversarial testing.
20. AI failure does not break deterministic functionality.
21. Patches require explicit approval.
22. Experiments contain baseline/candidate/environment/verification.
23. No false optimization claims.
24. Failure/recovery tests pass.
25. 24-hour soak passes.
26. SQLite integrity remains valid after forced interruption.
27. No critical security vulnerabilities.
28. No committed secrets.
29. Secret redaction passes.
30. Local-only mode has zero unexpected source transmission.
31. CLI JSON is stable.
32. Exit codes are documented and stable.
33. ≥10 representative fixtures exist.
34. ≥500-crate synthetic repository works.
35. Architecture boundaries are CI-enforced.
36. No foundational circular dependencies.
37. W-EIR and events are versioned.
38. Analysis jobs are traceable.
39. No sensitive source code is placed in telemetry by default.
40. Required documentation is complete.
41. Clean clone/build/test succeeds.
42. 100 consecutive full-suite runs have no critical flakiness.
43. Benchmark regressions >10% are investigated.
44. Full E2E journey passes.
45. Developer usability validation passes.
46. Offline mode is genuinely useful.
47. Online mode works without corrupting local state.
48. Offline/online transitions are reliable.
49. 90-day trial model is documented.
50. Commercial entitlements are architecturally separated from local deterministic functionality.
51. Billing failures cannot corrupt engineering data.
52. Product packaging is documented.
53. Release artifacts are reproducible and documented.
54. README accurately represents the actual product.
55. User Guide is sufficient for independent onboarding.

---

# 59. FINAL OUTPUT

At completion, produce a final report:

## Executive Summary

What is actually ready?

## Product Readiness

What can a developer use today?

## Offline Readiness

What works without internet?

## Online Readiness

What works with cloud connectivity?

## Reliability

What failures were tested?

## Performance

Provide measured results.

## Security

Provide findings and unresolved risks.

## AI Reliability

Provide adversarial-test results.

## Developer Experience

Provide usability results.

## Documentation

List updated documents.

## Commercial Readiness

Explain:

* 90-day trial
* proposed product tiers
* entitlement model
* billing architecture
* remaining commercial work

## Open Issues

There should be no unresolved release-blocking issues.

Any remaining non-blocking issues must have:

* GitHub issue
* owner
* priority
* rationale
* planned milestone

## Release Decision

Return exactly one:

```text
GO
CONDITIONAL GO
NO-GO
```

with evidence supporting the decision.

---

# 60. FINAL PRINCIPLE

Do not optimize for declaring Wanyrix complete.

Optimize for making Wanyrix genuinely usable.

The final standard is:

> A developer with a real Rust repository can install Wanyrix, run it without internet, receive trustworthy engineering intelligence, understand why a problem exists, investigate it, run an experiment, measure the result, verify the result, continue working while offline, reconnect later, synchronize safely when online, and understand exactly what Wanyrix does with their engineering data.

If that experience is not reliable, the product is not finished.

Continue discovery, issue creation, implementation, testing, security review, performance validation, documentation, and verification until the acceptance gates are satisfied.
