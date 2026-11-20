# Print a line when each serial setup or check ends

Slug: verify-pass-lines-serial-elapsed
Model: not applicable — the change prints one progress line per finished command and has no state
Acceptance:
- .kogen/intents/verify-pass-lines-serial-elapsed/acceptance.feature
- features/steps/verify-pass-lines-serial-elapsed__steps.js

A serial verification pass prints a running line when a setup command starts and nothing when any command ends, so a slow check reads as silence in the Build log. This change makes each setup command and each project check that runs one after another in a verification pass print one progress line when it ends, with its outcome and its wall time in whole seconds. The parallel cohort path, the baseline checks before the Build, acceptance, model, maintained-model and maintained-feature items are not changed and write no such line.

The line for an item that ended with status 0 is `kogen: go-test passed (385 s)`; for any other status it is `kogen: go-test failed, exit 1 (385 s)`. The name is the item's name (setup-1, format, go-test). The seconds are the wall time the item's command_result event records, in whole seconds rounded half up (384952 ms is 385 s, 499 ms is 0 s, 500 ms is 1 s, 1499 ms is 1 s, 1500 ms is 2 s). The line holds no command text, so it needs no redaction. An item that never started, or was not run because an earlier item failed, writes no line.

Example: a pass with the setup command true, then the checks ca with the command true, cb with the command exit 3 and cc with the command true, records the progress lines in this order: the existing running line for setup-1, then a line that reads `kogen: setup-1 passed`, then a line that reads `kogen: ca passed`, then a line that reads `kogen: cb failed, exit 3`, each followed by seconds in parentheses. No line names cc, because cc never ran after cb failed.

The change touches only `verify/run.go` and Go test files in the verify package. No documentation, design or README file, no concurrent.go, no configuration, flag or setting. The line text lives in one helper that takes the name, the status and the wall time in milliseconds, so the parallel item can reuse it. Everything else stays as it is: which passes are green or red, the pass record, Pass.Summary and its progress line, the existing running lines, every logged event, the Fix commands, readiness and the golden files under verify/testdata/golden. Existing tests that compare the whole sequence of progress lines of a serial pass are updated to expect the new lines, and only those.

## Decisions
- Each serial setup command and project check that has run and ended writes exactly one progress line when it ends: `kogen: <name> passed (<n> s)` for status 0, `kogen: <name> failed, exit <status> (<n> s)` otherwise. (decision: D1, round 1) (evidence: verify/run.go) (source: request)
- The seconds are the wall_ms of the item's command_result event rounded half up, that is (wall_ms + 500) / 1000 in integer arithmetic; 499 ms is 0 s, 500 ms is 1 s, 1499 ms is 1 s, 1500 ms is 2 s. (decision: D2, round 1) (evidence: verify/env.go) (source: request)
- The line is written in the function that runs a setup or check item and logs its command_result event, only when the command started (the same condition as that event) and returned without a runner error, so an item that never started writes no line. (decision: D3, round 1) (evidence: verify/run.go) (assumption: a runner error that aborts the pass writes no line because the pass is aborted, not ended) (source: request)
- An item that never started or was never run because an earlier item failed writes no line. Acceptance, model, maintained-model and maintained-feature items write no line; they have their own events. The parallel cohort path in concurrent.go and the baseline checks before the Build are out of scope. (decision: D4, round 1) (source: request)
- The line text lives in one helper taking the name, the status and the wall time in milliseconds. Its name is the Build's choice; acceptance observes real passes, not the helper's name. (decision: D5, round 1) (evidence: verify/pass_test.go) (source: request)
- No new configuration, flag or setting; the line carries no command text. (decision: D6, round 1) (source: request)

## Source comparison
- Addressed: the passing line, the failing line with exit status, and half-up whole-second rounding. Scenario 2 asserts every line of real serial passes against the wall_ms of the logged command_result events, so rounding is observed on real timings (0.3 s, 0.6 s, 0.7 s, 1.6 s commands); the exact boundaries 499, 500, 1499, 1500 and 384952 ms are covered by the unit tests of the helper below.
- Addressed: the lines `kogen: setup-1 passed`, `kogen: ca passed` and `kogen: cb failed, exit 3` in that order after the existing running line for setup-1, with cc never named; exit 127 appears for a failing setup command.
- Omitted by request: the parallel cohort path in concurrent.go, baseline checks, documentation, Pass.Summary, goldens.

## Tests
- The line helper writes `kogen: go-test passed (385 s)` for status 0 and 384952 ms, and rounds half up, (0 s) for 499 ms, (1 s) for 500 ms, (1 s) for 1499 ms, (2 s) for 1500 ms: a unit test next to TestPassSummaryProgressLine in verify/pass_test.go (unit)
- The helper writes `kogen: go-test failed, exit 1 (385 s)` for status 1 and 384952 ms and says exit 127 for status 127: a unit test in verify/pass_test.go (unit)
- A serial pass over setup true and checks ca true, cb exit 3, cc true records the running line for setup-1, then the end lines of setup-1, ca and cb, and no line naming cc: a model-free test in verify/verify_test.go using fake commands, plus the acceptance scenarios (integration)
- The whole progress sequence of a serial pass now holds the end lines of setup-1 and setup-2, with their seconds matched by pattern: update the existing sequence expectation in verify/verify_test.go and change nothing else in it (existing)

## Feasibility
- A scratch copy with the correct change applied ran the submitted driver with `go test ./verify -run '^TestSerialElapsedDriver$' -count=1 -v`, which passed in 7 s and wrote lines such as `kogen: slow passed (2 s)` for 1609 ms and `kogen: gone failed, exit 127 (1 s)` for 709 ms. (probe: scratch run, exit 0, 7 s)
- evidence: {"id":"serial-elapsed-observer","kind":"observer","inputs":["features/steps/verify-pass-lines-serial-elapsed__steps.js"],"observers":["features/steps/verify-pass-lines-serial-elapsed__steps.js"],"checks":[{"name":"good","command":"node features/steps/verify-pass-lines-serial-elapsed__steps.js good","exit":0,"output":"good controls accepted\n"},{"name":"bad","command":"node features/steps/verify-pass-lines-serial-elapsed__steps.js bad","exit":1,"output":"bad controls rejected\n"}]}
