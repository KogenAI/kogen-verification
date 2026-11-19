# Add a reuse key that ignores attempt variables

Slug: verify-check-reuse-key-ignores-attempt-env
Model: not applicable — one additional hash field on command events; no state, workflow or setting
Acceptance:
- .kogen/intents/verify-check-reuse-key-ignores-attempt-env/acceptance.feature
- features/steps/verify-check-reuse-key-ignores-attempt-env__steps.js

Verification records one `identity_sha256` per command event (`identityLogger.Log` in `verify/identity.go`). It hashes the command, tree, tools, lockfiles, the environment and the host, so two runs on the same tree with the same tools get different identities when a per-attempt variable differs (`KOGEN_ATTEMPT_ID`, `KOGEN_GENERATION`, or a `KL_` variable set by the loop). A later change in Build will reuse a baseline check that already passed on the same tree; it needs a key that ignores those variables. This Intent only supplies the key.

Every event with `event` equal to `command` also carries `reuse_sha256`: a 64-character lowercase hex SHA-256, computed like `identity_sha256` (`identityHash`) over the list `[command, tree, tools, lockfiles, environment, host]`, where `command`, `tree`, `tools`, `lockfiles` and `host` are exactly the values `identity_sha256` hashes and `environment` is the sorted list of `[name, value]` pairs of the same environment that `check_identity` records, after dropping every variable whose name starts with `KL_` and the variables `KOGEN_ATTEMPT_ID` and `KOGEN_GENERATION`. An environment left with no pairs hashes as the empty list `[]`. `identity_sha256` and the `check_identity` event (its six fields `event`, `tree`, `tools`, `lockfiles`, `environment`, `host`) keep exactly their current values and fields. No verdict, check order, timing, other event field, configuration, cache or written file changes. Docs and Build are out of scope; the scope is `verify/identity.go` and `verify/identity_test.go`.

Suggested shape (not a contract beyond the interface below): `checkIdentity` gets an unexported string field holding the hash of the filtered environment pairs, set by `snapshotIdentity`; `identityLogger.Log` reads it, together with the identity's `Tree`, `Tools`, `Lockfiles` and `Host`, **at the time it logs**, to set `reuse_sha256`. The environment collection (session env merged with `tools.env()`, minus `KOGEN_STEP_RUN`, `KOGEN_ACCEPTANCE_RUN`, `KOGEN_CHECK_REPORT`, `KOGEN_ACCEPTANCE_REPORT`) is shared with `stableEnvironment`, whose signature stays `(identityEnvironment, []string, string)`.

Interface the acceptance test uses (all existing, none renamed): `snapshotIdentity(s *sys.Session, tools Tools, tree, dir string) checkIdentity`; the fields `Tree`, `Tools`, `Lockfiles`, `Host` of `checkIdentity`; `identityLogger{inner, identity}` and its `Log`; and `checkIdentity.event()`.

## Decisions
- `reuse_sha256` is added to command events only, beside `identity_sha256`, and is computed when the event is logged from the identity's fields (so changing `Tree`, `Tools`, `Lockfiles` or `Host` on a snapshot changes it). (evidence: verify/identity.go) (source: request)
- Dropped from the reuse environment: names starting with `KL_`, and exactly `KOGEN_ATTEMPT_ID` and `KOGEN_GENERATION`. Every other name, including `PATH` and other `KOGEN_` names, stays. (source: request)
- `identity_sha256` and the `check_identity` event are untouched. The acceptance test pins `identity_sha256` with a literal recorded from the unchanged tree. (evidence: verify/identity.go; verify/identity_test.go) (source: request)
- The Build adds its own focused Go tests for the four rules to `verify/identity_test.go`; acceptance independently runs its own Go test through `go test -overlay`, which adds a test file to package `verify` virtually, so no file of the checkout is written. (evidence: verify/identity_test.go) (assumption: the request's "one focused model-free Go test" is satisfied by that overlay-run test plus the Build's own tests) (source: request)
- No setting, flag, environment variable or cache is added. (source: request)
- reuse_sha256 is added to command events beside identity_sha256, computed at log time from the identity's Tree, Tools, Lockfiles, Host and an unexported filtered-environment hash that drops KL_*, KOGEN_ATTEMPT_ID and KOGEN_GENERATION (decision: D1, round 1) (constraint: identity_sha256 and check_identity unchanged) (constraint: stableEnvironment signature unchanged) (evidence: verify/identity.go; verify/identity_test.go) (assumption: Probe showed a scratch correct implementation passes the overlay-run test and existing identity tests; the Intent decision cites files read, not that command.) (source: request)

## Source comparison
- Addressed: `reuse_sha256` on command events with the filtered environment (Decisions 1-2; scenarios 1-4).
- Addressed: `identity_sha256` and `check_identity` keep exact values and fields (Decision 3; scenario 4 literal and six-field check).
- Addressed: tree, tool version, lockfile, host architecture and PATH each change the key (scenarios 2, 3, 4).
- Omitted by request: the Build change that uses the key, docs, configuration, caches.

## Tests
- Per-attempt variables (`KOGEN_ATTEMPT_ID`, `KOGEN_GENERATION`, a `KL_` variable) do not change `reuse_sha256`: add a Go test in `verify/identity_test.go` comparing two identities that differ only in them (unit)
- A different tree changes `reuse_sha256`: add a Go test comparing two identities that differ only in the tree (unit)
- A different tool version, lockfile hash or host architecture each changes `reuse_sha256`: add a Go test with one comparison for each (unit)
- A different `PATH` changes `reuse_sha256`, and `identity_sha256` keeps the value the unchanged code computes: add a Go test comparing PATH values and a literal recorded from the unchanged tree (unit)
- The same four rules through the real identity code: the four scenarios in acceptance.feature (scenario)
- Existing identity behavior (`identity_sha256` over the full environment, `check_identity` fields): the existing tests in `verify/identity_test.go` stay green unchanged (existing)

## Feasibility
- evidence: {"id":"reuse-key-observer","kind":"observer","inputs":["features/steps/verify-check-reuse-key-ignores-attempt-env__steps.js"],"observers":["features/steps/verify-check-reuse-key-ignores-attempt-env__steps.js"],"checks":[{"name":"good","command":"node features/steps/verify-check-reuse-key-ignores-attempt-env__steps.js good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/verify-check-reuse-key-ignores-attempt-env__steps.js bad","exit":1,"output":"rejected\n"}]}
