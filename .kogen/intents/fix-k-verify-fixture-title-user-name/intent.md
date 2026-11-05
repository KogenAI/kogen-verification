# Require the baseline guard subtests to have passed

Slug: fix-k-verify-fixture-title-user-name
Model: not applicable — one acceptance step's pass condition, no state transitions
Acceptance:
- .kogen/intents/fix-k-verify-fixture-title-user-name/acceptance.feature
- features/steps/fix-k-verify-fixture-title-user-name__harness.js

The step `k-verify-fixture-title-user-name: the baseline guard regression passes` in `features/steps/k-verify-fixture-title-user-name__commands.js` (landed by k-verify-fixture-title-user-name) runs `go test ./verify -count=1 -run '^TestBaselineGuardRunsAfterEachFixerAndAfterThePass$' -v` and passes whenever that command exits 0. `go test -run` that matches no test still exits 0 (`testing: warning: no tests to run` … `ok … [no tests to run]`), so if the test is renamed the step passes without running the regression.

Reproduced on current main in a scratch copy: with `func TestBaselineGuardRunsAfterEachFixerAndAfterThePass(` renamed to `func TestBaselineGuardRenamedAway(` in `verify/verify_test.go`, running that Intent's feature with only that step file reports `1 scenario (1 passed)`, exit 0. Renaming the subtest `"after the pass"` to `"at the end"`, or making `after the second fixer` call `t.Skip`, also leaves the step green. The reproduction holds, so the fix proceeds.

The fix, in `features/steps/k-verify-fixture-title-user-name__commands.js` only:
- Keep the step sentence `k-verify-fixture-title-user-name: the baseline guard regression passes`, its 120000 ms timeout and the same `go test ./verify -count=1 -run '^TestBaselineGuardRunsAfterEachFixerAndAfterThePass$'` invocation with `-v` (or `-json`).
- The step fails unless the command exits 0 AND its output reports a passing run of each of the three subtests `TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_first_fixer`, `TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_second_fixer` and `TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_pass`. With `-v` that is a line `--- PASS: <full name> (<duration>)` for each (observed real output on main below); with `-json` it is an event with `"Action":"pass"` and that `"Test"`. A `=== RUN` line, a `--- SKIP` line or the absence of the name does not count.
- The failure message names the missing subtest(s) by full name (`TestBaselineGuardRunsAfterEachFixerAndAfterThePass/<subtest>`), includes the `go test` command that was run, and says the outcome (absent, skipped or not run, or the nonzero exit with the output).
- Per README "Acceptance steps", start `go test` asynchronously (for example `execFile` with a callback or `spawn`), not with `execFileSync`/`spawnSync`.

Real `-v` output of the unchanged regression on main (observed):

```
=== RUN   TestBaselineGuardRunsAfterEachFixerAndAfterThePass
=== RUN   TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_first_fixer
=== RUN   TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_second_fixer
=== RUN   TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_pass
--- PASS: TestBaselineGuardRunsAfterEachFixerAndAfterThePass (1.67s)
    --- PASS: TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_first_fixer (0.05s)
    --- PASS: TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_second_fixer (0.07s)
    --- PASS: TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_pass (1.54s)
PASS
ok  	github.com/KogenAI/kogen-verification/verify	1.670s
```

Nothing else changes: `.kogen/intents/k-verify-fixture-title-user-name/` (its feature and intent), `verify/verify_test.go` and all Go code stay as they are, and every existing test and check stays green.

## Decisions
- First demonstrate on current main that the step stays green when the regression does not run; it does, so fix rather than report non-reproduction. (source: request)
- The step asserts, from `-v` or `-json` output, that the three subtests ran and passed; exit status alone no longer suffices. (source: request)
- Keep every existing test green; no unrelated changes. (source: request)

## Source comparison
- Addressed request Problem "`go test -run` matching no tests still exits 0, so the step passes without running the regression if the test is renamed" (Where: `k-verify-fixture-title-user-name__commands.js`): reproduced in a scratch copy (rename → `1 scenario (1 passed)`, exit 0); acceptance scenario "The step fails when the regression test is renamed and go test runs no tests".
- Addressed request Need "First show it … for lost coverage, show the stated requirement is no longer asserted": the reproduction above; the scenarios that rename the test, rename a subtest or skip a subtest fail on current main because the nested run still passes.
- Addressed request Need "fix it so the test fails on the broken behaviour and passes on main: Assert that the three subtests ran (`-v` output or `-json`)": the fix section; scenarios for the unchanged module (passes), a renamed subtest and a skipped subtest.
- Addressed request Need "Keep every existing test green; no unrelated changes": nothing outside the one step file changes; configured checks run the Go suite.
- Decided (not in request): a skipped subtest does not count as having run the regression, because it asserts nothing; and README's asynchronous child-process rule applies to the rewritten step.

## Tests
- The k-verify-fixture-title-user-name step fails when `go test -run` runs no test because the regression was renamed, naming the test and the `go test` command: acceptance scenario that renames `TestBaselineGuardRunsAfterEachFixerAndAfterThePass` in a scratch copy and runs that Intent's feature with only its step file (regression)
- The step fails when one of the three subtests is missing or skipped, naming the missing subtest: acceptance scenarios renaming `after the pass` to `at the end` and skipping `after the second fixer` (regression)
- The step still passes on the unchanged module: acceptance scenario running the same nested acceptance on an unchanged scratch copy (regression)
- Existing Go behaviour unaffected: existing `go test ./...` via the configured checks (existing)

## Feasibility
- Reproduced on current main in a scratch copy: renamed test → nested Cucumber `1 scenario (1 passed)`, exit 0; `go test ... -v` printed `testing: warning: no tests to run` and `ok ... [no tests to run]`, exit 0. Renamed subtest and `t.Skip` in `after the second fixer` also exit 0 (skip shows `--- SKIP: TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_second_fixer`). Against the unfixed step the new feature reports `4 scenarios (1 passed, 3 failed)`.
- The harness generates subprocesses (nested Cucumber and `go test` in scratch copies), so it carries observer controls: a known-good step (requires `--- PASS:` lines for the three subtests) is accepted on all four cases; a plausible wrong step that counts `=== RUN` lines is rejected (it misses the skipped-subtest case).
- evidence: {"id":"subtest-step-observer","kind":"observer","inputs":["features/steps/fix-k-verify-fixture-title-user-name__harness.js"],"observers":["features/steps/fix-k-verify-fixture-title-user-name__harness.js"],"checks":[{"name":"good","command":"node features/steps/fix-k-verify-fixture-title-user-name__harness.js --control good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/fix-k-verify-fixture-title-user-name__harness.js --control bad","exit":1,"output":"rejected\n"}]}
