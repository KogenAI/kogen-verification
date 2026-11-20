# Print a line when each cohort check ends

Slug: verify-pass-lines-cohort-elapsed
Model: not applicable — the change prints one progress line per finished cohort member and has no state
Acceptance:
- .kogen/intents/verify-pass-lines-cohort-elapsed/acceptance.feature
- features/steps/verify-pass-lines-cohort-elapsed__steps.js

A verification pass runs independent checks such as build and vet together in a cohort and prints no line when a member ends, so the time of each is invisible in the Build log. The serial path already writes one ended line per setup command and check through the helper `endLine` in verify/run.go, which takes the name, the status and the wall time in milliseconds. This change makes the cohort path write the same line through that same helper.

When a member of a cohort has run and ended, one progress line is written in the same words as the serial path: `kogen: go-test passed (385 s)` for status 0 and `kogen: go-test failed, exit 1 (385 s)` otherwise, with the member's own name, its own exit status and the seconds of that member's own command_result wall_ms, rounded half up by the helper. Lines are written in the order members finish. A member that was cancelled because another member failed has status -1 and writes no line. A member that never started, or that ended with a runner error or an interrupt of the pass, writes no line. Nothing else changes: which passes are green or red, the logged events, the serial path and its lines.

The change touches only `verify/concurrent.go` and Go test files in the verify package. `verify/run.go` is not edited; the cohort only calls the existing helper. No documentation, design or README file, no configuration, flag or setting.

## Decisions
- Each cohort member that has run and ended writes exactly one progress line when it ends, `kogen: <name> passed (<n> s)` for status 0 and `kogen: <name> failed, exit <status> (<n> s)` otherwise, written by calling the existing `endLine` helper with the member's name, status and wall time in milliseconds; no second helper or copy of the wording is added. (decision: D1, round 1) (evidence: verify/run.go; verify/concurrent.go) (source: request)
- The seconds come from the same wall time that the member's command_result event records, measured in runCohortCheck, so the line and the event agree. (decision: D2, round 1) (evidence: verify/concurrent.go) (source: request)
- Lines are written in the order members finish: the line is written by the member itself when it ends, not after the cohort has joined. Because members end concurrently, the writes to the session's progress stream are serialized so that each line is whole. (decision: D3, round 1) (evidence: verify/concurrent.go) (assumption: a package-level mutex around the write is acceptable, because runCohortCheck is also called directly by tests) (source: request)
- A cancelled member (status -1), a member that never started, and a member that ended with an error or an interrupt write no line. (decision: D4, round 1) (evidence: verify/concurrent.go) (source: request)
- No new configuration, flag or setting; the line holds no command text, so it needs no redaction. (decision: D5, round 1) (source: request)

## Source comparison
- Addressed: the passing line, the failing line with exit status, the member's own seconds from its command_result wall time rounded half up by the shared helper, finish order, and no line for the cancelled member. Scenarios 1 to 3 run the real cohort runner with the commands true, exit 3, sleep 1.6 and a long sleep; scenario 4 runs a whole verification pass of the standard go build and go vet commands served by a fake go.
- Omitted by request: the serial path, run.go edits, documentation, configuration.

## Tests
- Two independent cohort checks, true and exit 3, record exactly two ended lines, each with the seconds of its own command_result event: a model-free Go test in verify/concurrent_test.go using runCohort and fake commands, plus acceptance scenario 1 (integration)
- A quick and a slow member write their lines in the order they finish, with half-up seconds: a Go test in verify/concurrent_test.go and acceptance scenario 2 (integration)
- A cohort whose first check fails at once and whose second is a long sleep that is cancelled records a line for the first and none naming the second: a Go test in verify/concurrent_test.go and acceptance scenario 3 (integration)
- A whole verification pass of go build and go vet with a fake go writes one line for each: acceptance scenario 4 (integration)

## Feasibility
- A scratch copy with the correct change applied ran the submitted driver with `go test ./verify -run '^TestCohortElapsedDriver$' -count=1 -v`, which passed and wrote lines such as `kogen: slow passed (2 s)` for 1617 ms and `kogen: first failed, exit 3 (0 s)`, and no line for the cancelled member; on the unchanged tree it wrote no lines. (probe: scratch run, exit 0, 4 s)
- evidence: {"id":"cohort-elapsed-observer","kind":"observer","inputs":["features/steps/verify-pass-lines-cohort-elapsed__steps.js"],"observers":["features/steps/verify-pass-lines-cohort-elapsed__steps.js"],"checks":[{"name":"good","command":"node features/steps/verify-pass-lines-cohort-elapsed__steps.js good","exit":0,"output":"good controls accepted\n"},{"name":"bad","command":"node features/steps/verify-pass-lines-cohort-elapsed__steps.js bad","exit":1,"output":"bad controls rejected\n"}]}
