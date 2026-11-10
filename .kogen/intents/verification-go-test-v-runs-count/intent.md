# Count verbose Go test runs in verification

Slug: verification-go-test-v-runs-count
Model: not applicable — transcript parsing has no meaningful persistent state
Acceptance:
- .kogen/intents/verification-go-test-v-runs-count/acceptance.feature
- features/steps/verification-go-test-v-runs-count__steps.js
- features/steps/verification-go-test-v-runs-count__observer.js
- features/steps/verification-go-test-v-runs-count__driver/probe_test.go

Extend parseGoRows in verify/namedtests.go to recognize verbose Go test text alongside JSON. Treat `=== RUN` as run evidence, `--- SKIP:` as skip evidence, and `--- PASS:` and `--- FAIL:` as evidence the test ran even without a RUN row. Attribute verbose subtest evidence to its top-level test. Mark recognized verbose output as seen. Preserve `go test -json` parsing and every existing diagnostic message unchanged; do not turn a failed-but-run test into an unwritten test or credit a different test as the required test.

During implementation, first add failing regressions to verify/named_feedback_test.go for the selected failing-test transcript and the transcript running only a different test. Observe the reproducer fail before changing production. Then implement the fix and run `go test ./verify`, followed by configured checks. The acceptance harness independently calls missingNamedTests and parseGoRows in a test-binary overlay; it does not depend on implementation-authored test names. No changes to other verification behavior are requested.

## Decisions
- Keep this a local parser and feedback bug fix with no new dependencies or settings. (evidence: verify/namedtests.go; verify/named_feedback_test.go) (source: request)
- Preserve existing JSON handling and diagnostic strings, changing only which verbose evidence reaches their existing branches. (source: request)

## Source comparison
- Addressed: request's verbose RUN, SKIP, PASS and FAIL rules, seen flag, and top-level subtest attribution are specified above and exercised by acceptance.feature's independent feedback/parser harness.
- Addressed: request's selected failing TestX reproducer and only-TestY counterexample are executable in Failing selected test ran and Only another test ran; the required regression-first sequence and named_feedback_test.go location are retained above.
- Addressed: the reported 9 November 2026 kogen-build incident names TestDiagnosticDataIsBoundedOriginalUTF8 in build/unit_test.go. Reported diagnostic test retains that test name as a transcript fixture; it does not claim that the external build package exists here. The reported unwritten_tests refusal is addressed by checking the actual unwritten feedback result.
- Addressed: unchanged JSON parsing and message wording are required above and exercised by JSON remains supported and exact feedback expectations. Run the verify package tests as requested. Nothing in the original behavioral request is deliberately omitted or superseded.

The historical false positive was `TestX: did not run (the failure shows no run of it)`. Preserve that exact existing message for failures with no recognized Go output. When verbose output runs only another test, recognizing it as seen intentionally selects the existing `no run of it in the go test output` branch instead; this is not a message rewrite.

## Tests
- Verbose selected tests that ran must not be unwritten: add the failing-transcript regression first in verify/named_feedback_test.go and exercise missingNamedTests independently (regression)
- A transcript running only another test must still report the required test missing: add the counterexample regression first in verify/named_feedback_test.go (regression)
- Verbose RUN, PASS and FAIL rows including subtests establish top-level run evidence and seen output: focused parser and feedback cases in acceptance.feature (unit)
- Verbose SKIP rows including subtests retain skipped feedback without unwritten feedback: focused feedback cases in acceptance.feature (unit)
- JSON parsing and all existing messages remain unchanged: retain existing verify tests and run go test ./verify (existing)

## Feasibility
- evidence: {"id":"comparison","kind":"observer","inputs":["features/steps/verification-go-test-v-runs-count__observer.js"],"observers":["features/steps/verification-go-test-v-runs-count__observer.js"],"checks":[{"name":"good","command":"node features/steps/verification-go-test-v-runs-count__observer.js good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/verification-go-test-v-runs-count__observer.js bad","exit":1,"output":"rejected\n"}]}
