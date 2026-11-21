# Pin the serial end-of-command progress line

Slug: verify-elapsed-line-helper-serial
Model: not applicable — the behavior is one progress line per finished command and has no state
Acceptance:
- .kogen/intents/verify-elapsed-line-helper-serial/acceptance.feature
- features/steps/verify-elapsed-line-helper-serial__steps.js

The request asks that each setup command and each project check of a serial verification pass print one progress line when it ends: `kogen: go-test passed (385 s)` for status 0 and `kogen: go-test failed, exit 1 (385 s)` otherwise, with whole seconds rounded half up from the wall time the command_result event records, produced by one helper taking the name, the status and the wall time in milliseconds. The checkout at HEAD already does this: `endLine` in verify/run.go is written by `runLogged` after a started command returns, and the existing tests `TestEndLine` (verify/pass_test.go) and `TestSerialPassPrintsALineWhenEachCommandEnds` (verify/verify_test.go) cover the helper and the serial order. So this Intent changes no production code. It only adds acceptance that observes the requested behavior through those existing tests, so the behavior stays pinned. The parallel cohort path, documentation and every other file stay as they are.

Required values, as the request states them. Rounding is half up: 384952 ms is 385 s, 499 ms is 0 s, 500 ms is 1 s, 1499 ms is 1 s, 1500 ms is 2 s; the helper expects (0 s) for 499 ms, (1 s) for 500 ms, (1 s) for 1499 ms and (2 s) for 1500 ms. With name go-test and 384952 ms the helper expects exactly `kogen: go-test passed (385 s)` for status 0, `kogen: go-test failed, exit 1 (385 s)` for status 1 and exit 127 in the line for status 127. A pass with the setup command true, then the checks ca with the command true, cb with the command exit 3 and cc with the command true, records the existing running line for setup-1, then a line that reads `kogen: setup-1 passed`, then `kogen: ca passed`, then `kogen: cb failed, exit 3`, each followed by seconds in parentheses; no line names cc, because cc never ran after cb failed.

## Decisions
- The requested behavior (one end line per started serial setup command or check, `kogen: <name> passed (<n> s)` or `kogen: <name> failed, exit <status> (<n> s)`, half-up whole seconds, one helper taking name, status and wall milliseconds, no line for an item that never ran) is already implemented at HEAD, so this Intent edits no file of the project. (decision: D1, round 1) (evidence: verify/run.go; verify/pass_test.go; verify/verify_test.go; verify/concurrent.go) (assumption: the user confirms that the commits already delivering this behavior satisfy the request, and that no further change is wanted) (source: request)
- Acceptance runs only the two existing named tests, TestEndLine and TestSerialPassPrintsALineWhenEachCommandEnds, with `go test ./verify -run` and requires each to report PASS; no new Go test is written because the existing ones already cover rounding at 499 ms, 500 ms, 1499 ms, 1500 ms and 384952 ms, exit 1 and exit 127, and the setup true, ca true, cb exit 3, cc true order with no line naming cc. (decision: D2, round 1) (evidence: verify/pass_test.go; verify/verify_test.go) (source: request)
- Because the behavior exists, the acceptance scenarios are not red on the unchanged tree; that is the honest result of a request that is already delivered, not a broken fixture. (decision: D3, round 1) (evidence: verify/run.go) (assumption: the user accepts a regression-only Intent with passing acceptance instead of withdrawing the request) (source: request)

## Source comparison
- Addressed (already present at HEAD): the passing line `kogen: go-test passed (385 s)`, the failing line `kogen: go-test failed, exit 1 (385 s)` with its exit status, half-up whole-second rounding ((0 s) for 499 ms, (1 s) for 500 ms, (1 s) for 1499 ms, (2 s) for 1500 ms) and the single helper, observed through TestEndLine.
- Addressed (already present at HEAD): the serial order of the running line for setup-1, then `kogen: setup-1 passed`, `kogen: ca passed` and `kogen: cb failed, exit 3`, with no line naming cc, observed through TestSerialPassPrintsALineWhenEachCommandEnds.
- Omitted by request: the parallel cohort path, Pass.Summary, goldens, documentation and any new configuration.

## Tests
- The helper writes `kogen: go-test passed (385 s)` for 384952 ms, rounds half up at 499 ms, 500 ms, 1499 ms and 1500 ms, and writes `failed, exit <status>` for nonzero statuses: the existing TestEndLine in verify/pass_test.go (existing)
- A serial pass over setup true and checks ca true, cb exit 3, cc true writes the end lines of setup-1, ca and cb in order and none for cc: the existing TestSerialPassPrintsALineWhenEachCommandEnds in verify/verify_test.go (existing)

## Feasibility
- none
