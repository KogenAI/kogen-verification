# Export the check reuse key without a pass

Slug: verify-export-check-reuse-key
Model: not applicable — one exported hash function over existing identity data; no state, workflow or setting
Acceptance:
- .kogen/intents/verify-export-check-reuse-key/acceptance.feature
- features/steps/verify-export-check-reuse-key__steps.js

Verification writes `reuse_sha256` on every `command` event (`identityLogger.Log` in `verify/identity.go`): a hash of the command, the tree, the tool probes, the lockfiles, the environment without the per-attempt variables (names starting with `KL_`, `KOGEN_ATTEMPT_ID`, `KOGEN_GENERATION`) and the host. Build runs its own baseline checks and cannot read that value, because the hash is built only inside the unexported identity logger. Build needs the same value before it runs a check.

Package `verify` exports one way to compute that key without running a verification pass:

- `type ReuseSnapshot` — made once per tree; it holds the tree, the tool probes, the lockfile hashes, the filtered environment pairs and the host.
- `func NewReuseSnapshot(s *sys.Session, tools Tools, tree, dir string) ReuseSnapshot` — takes the same tool and lockfile probes as `snapshotIdentity` (it may call it), once.
- `func (r ReuseSnapshot) Key(command string) string` — cheap: it only hashes (`identityHash` over `[command, tree, tools, lockfiles, environment pairs, host]`, exactly the list `reuse_sha256` hashes today). It runs no probe and reads no file.

`identityLogger.Log` computes `reuse_sha256` through the same `ReuseSnapshot.Key` code path, reading the identity's fields at the time it logs, so the exported key and the logged value cannot differ. Nothing else changes: `identity_sha256`, the `check_identity` event, every other event field, every verdict, check order and timing stay exactly as they are. No configuration, cache, written file or new event. Build and docs are out of scope. The consumer-surface pin `TestConsumerSurface` in `contract/contract_test.go` lists the exported names consumers call, so it gains the two new signatures.

## Decisions
- `ReuseSnapshot`, `NewReuseSnapshot(s *sys.Session, tools Tools, tree, dir string) ReuseSnapshot` and `ReuseSnapshot.Key(command string) string` are exported from package verify; `Key` only hashes and the logger uses it for `reuse_sha256`. (constraint: identity_sha256 and check_identity unchanged) (constraint: no new setting, cache, file or event) (evidence: verify/identity.go; verify/identity_test.go) (source: request)
- `Key` hashes the same list as the current `reuse_sha256`, so existing recorded values do not change; acceptance pins both hashes to literals recorded from the unchanged tree. (evidence: verify/identity.go) (source: request)
- The two new signatures are added to the consumer-surface pin in `contract/contract_test.go`, the only place in the repo that lists exported names. (decision: D3, round 1) (evidence: contract/contract_test.go; contract/README.md) (assumption: the contract test is the "consumes pin" the request names; consumes/README.md only maps imports of other modules) (source: request)
- Acceptance runs its own Go test through `go test -overlay`, which adds a test file to package `verify` virtually, so no checkout file is written; the Build adds its own tests to `verify/identity_test.go`. (decision: D4, round 1) (evidence: verify/identity_test.go) (source: request)
- Export ReuseSnapshot, NewReuseSnapshot(s, tools, tree, dir) and ReuseSnapshot.Key(command) from package verify; identityLogger.Log computes reuse_sha256 through Key. (decision: D1, round 1) (constraint: identity_sha256 and check_identity unchanged) (constraint: no new setting, cache, file or event) (evidence: verify/identity.go; verify/identity_test.go) (assumption: A scratch copy outside the checkout passed the overlay-run acceptance test and the five wrong patches each failed their named subtest; the decision cites files read, not those runs.) (source: request)
- Add the two new signatures to TestConsumerSurface in contract/contract_test.go as the consumes pin. (decision: D2, round 1) (evidence: contract/contract_test.go; contract/README.md) (assumption: Assumes this contract test is the pin the request means.) (source: request)

## Source comparison
- Addressed: exported snapshot type, constructor and `Key` (Decision 1; scenarios 1-3).
- Addressed: logger and export share one code path (scenario 1 compares them with a `go.sum` present; a wrong implementation that leaves lockfiles out of the exported key fails).
- Addressed: per-attempt variables do not change the key (scenario 2).
- Addressed: command, tree and PATH each change the key (scenario 3).
- Addressed: `identity_sha256` and `reuse_sha256` equal literals recorded before the change (Decision 2; scenario 4).
- Omitted by request: Build's use of the key, docs, configuration, caches, new events.

## Tests
- The key from the snapshot equals the `reuse_sha256` a logged command event carries for the same inputs, with a go.sum in the scratch dir: add a Go test in `verify/identity_test.go` (unit)
- Changing KOGEN_ATTEMPT_ID, KOGEN_GENERATION and a KL_ variable leaves the key unchanged: add a Go test in `verify/identity_test.go` (unit)
- A different command, tree string or PATH each changes the key: add a Go test in `verify/identity_test.go` (unit)
- `identity_sha256` and `reuse_sha256` equal literals recorded before the change: add a Go test in `verify/identity_test.go` (regression)
- The same four rules through the real identity code: the four scenarios in acceptance.feature (scenario)
- The exported names are pinned for consumers: the two new signatures in `TestConsumerSurface` (existing)
- Existing identity behavior stays green unchanged: the existing tests in `verify/identity_test.go` (existing)

## Feasibility
- evidence: {"id":"export-reuse-key-observer","kind":"observer","inputs":["features/steps/verify-export-check-reuse-key__steps.js"],"observers":["features/steps/verify-export-check-reuse-key__steps.js"],"checks":[{"name":"good","command":"node features/steps/verify-export-check-reuse-key__steps.js good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/verify-export-check-reuse-key__steps.js bad","exit":1,"output":"rejected\n"}]}
