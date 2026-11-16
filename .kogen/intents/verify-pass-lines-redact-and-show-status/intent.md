# Redact and complete verification pass lines

Slug: verify-pass-lines-redact-and-show-status
Model: not applicable — command and status lines are pure functions of the configured command and the pass record; there is no state or interacting rule to model.
Acceptance:
- .kogen/intents/verify-pass-lines-redact-and-show-status/acceptance.feature
- features/steps/verify-pass-lines-redact-and-show-status__steps.js

A verification pass must print, log and stop on redacted, complete command and status lines. In a verification pass, the `kogen: running setup-<n>: <command>` progress line and the `command` field of every `command` event the pass writes (fix commands, setup commands, project checks sequential and concurrent, and the acceptance command) go through `attemptFrom(ctx).Redact`, the nil-safe function readiness already uses. `awaitResult` (verify/hung.go) redacts the command in the `command_no_progress` event and in the `environment/command_no_progress` stop detail with the nil-safe labelled-pattern redaction `(*Redactor)(nil).Redact`. A command with no secret pattern prints, logs and stops byte-identically to today, and `identity_sha256` of such a command event is unchanged.

In `Pass.Summary` (verify/pass.go), a failing item that has a matching entry by name in `p.Setup` with a non-zero `Status` is written `<name> (exit <status>)`, exactly as a failing check already is; `p.Failing` keeps its order. A failing item with no matching entry in `p.Setup` or `p.Checks` (such as `acceptance`, `model`, or a record without setup entries) is written as today. The acceptance scenario suffix, the `; Speculative results:` and `; Cancelled work:` sections and the `; not run because an earlier item failed:` tail stay as they are.

This replaces the two earlier narrow requests verify-pass-command-lines-redact-secrets and verify-failed-setup-line-shows-exit-status. Unchanged: `CommandResult.Command` in `Pass.Setup` and `Pass.Checks` keeps the configured command exactly (`Pass.Complete` compares it with the configuration); command execution, exit statuses, outputs, `command_result` events, `Pass.Feedback`, which passes are green or failing, and the readiness refusal `environment/setup_failed: Setup setup-<n> failed (status=<n>).`. No new `Input` field, setting or configuration; the patterns in verify/redact.go are not changed. The one existing expectation that changes is in verify/verify_test.go (TestFailedSetupRetainsEvidenceAndNamesLaterSetupAndGatesWithoutAnAbsentModel): it becomes `kogen: pass 1: setup-1 (exit 23) failed; not run because an earlier item failed: setup-2, acceptance, z-first, a-later`. Existing expectations in verify/pass_test.go keep passing unchanged, including `kogen: pass 4: setup-1 failed; not run because an earlier item failed: setup-2, acceptance, z-first, a-later` (no `Setup` entries) and `kogen: pass 2: lint (exit 2), test (exit 1) failed`; TestVerifyEndedCommandNoticed keeps passing unchanged.

## Decisions
- Redaction in the pass uses `attemptFrom(ctx).Redact(...)` at the progress line and at each `command` event (Fix, runLogged, runFeature, runCohortCheck); a nil Attempt still masks labelled patterns. (evidence: verify/attempt.go; verify/run.go; verify/concurrent.go; verify/readiness.go) (source: request)
- `awaitResult` has no context, so it redacts the command once on entry with `(*Redactor)(nil).Redact`, and uses the result for both the event and the stop detail. (decision: D2, round 1) (evidence: verify/hung.go; verify/redact.go) (source: request)
- `Pass.Summary` looks a failing item up by name in `p.Setup` and then `p.Checks`, taking the first non-zero match; items without a match are unchanged. The recorded `CommandResult.Command` is never redacted. (decision: D3, round 1) (evidence: verify/pass.go) (source: request)
- Acceptance runs one Go driver test in package verify through a Go build overlay (no checkout change, nothing built at load), recording the stderr, command events, record, stop detail and summaries as JSON that the steps observe. (decision: D4, round 1) (evidence: features/steps/verify-failed-pass-line-shows-exit-status__steps.js) (assumption: the overlay-added test file in package verify compiles against the candidate tree and its helpers newProj, memLog, awaitResult, groupSet) (source: request)
- Redaction in the pass uses attemptFrom(ctx).Redact at the progress line and each command event; awaitResult redacts once on entry with the nil Redactor; Pass.Summary looks up setup then check entries by name. (decision: D1, round 1) (evidence: verify/attempt.go; verify/run.go; verify/hung.go; verify/pass.go; verify/redact.go) (assumption: An external scratch copy showed the driver and the seven wrong variants behaving as intended; this is not Kogen's own record.) (source: request)

## Source comparison
- Observed current behavior: `Readiness.Setup` prints `kogen: running setup-<n>: ` with `r.Attempt.Redact(cmd)` and writes the `command` event with `r.Attempt.Redact(cmd)`, while the verification pass prints the same progress line with the raw `it.command` and writes raw `command` events in Fix, runLogged, runFeature and the concurrent check cohort. Addressed by the redaction rule above.
- `awaitResult` in verify/hung.go, reached by the pass through `RunWatched`, writes the raw command in the `command_no_progress` event and in the stop `environment/command_no_progress: <name> had no live process for <grace> but its result never reached Kogen; stopped waiting for: <command>`. Addressed in scenario 4, which uses a short grace like the existing `shortenGrace` helper (the driver sets the grace to 50ms itself).
- Labelled patterns in verify/redact.go are unchanged; the nil Redactor already turns `tool --token abc123 --verbose` into `tool --token [REDACTED] --verbose` and `password=abc12345` into `password=[REDACTED]`.
- Scenarios 1 to 3 use one pass with `commands.setup` `["true --token abc123"]` and one check named lint running `true password=abc12345`. Setup progress line and setup `command` event redacted (`true --token [REDACTED]`): scenario 1. Check `command` event redacted (`true password=[REDACTED]`): scenario 2. Fix, acceptance and concurrent-check events use the same nil-safe call.
- Pass record keeps `true --token abc123` / `true password=abc12345` and `Pass.Complete` stays true: scenario 3.
- `command_no_progress` event and stop detail redacted: scenario 4.
- Old line `kogen: pass 1: setup-1 failed; not run because an earlier item failed: setup-2, acceptance, z-first, a-later` (setup exit 23) becomes the `setup-1 (exit 23)` form above; a failing check already reads `test (exit 1) failed`.
- Scenario 5: `Pass{N: 1, Failing: [setup-1], Setup: [{setup-1, Status 23}], NotRun: [setup-2, acceptance]}` summarizes exactly as `kogen: pass 1: setup-1 (exit 23) failed; not run because an earlier item failed: setup-2, acceptance`.
- Scenario 6: `Pass{N: 2, Failing: [setup-2], Setup: [{setup-1, Status 0}, {setup-2, Status 127}], NotRun: [acceptance]}` summarizes exactly as `kogen: pass 2: setup-2 (exit 127) failed; not run because an earlier item failed: acceptance`; the wrong form `setup-2 (exit 0) failed` (first setup entry used) is rejected.
- Scenario 7: `Pass{N: 3, Failing: [setup-1], NotRun: [acceptance]}` with no `Setup` entries summarizes exactly as `kogen: pass 3: setup-1 failed; not run because an earlier item failed: acceptance`; the wrong form `setup-1 (exit 0) failed` is rejected.
- Existing pass_test.go lines stay as they are: `kogen: pass 4: setup-1 failed; not run because an earlier item failed: setup-2, acceptance, z-first, a-later` and `kogen: pass 2: lint (exit 2), test (exit 1) failed`.
- Commands without a secret print and log as before: existing tests (TestGreenPassRunsEveryItemInOrderOnTheCleanCandidate, TestVerifyEndedCommandNoticed).
- Tests are listed in the form `- <rule>: <test to add or update> (<layer>)`, as in the section below.

## Tests
- The setup progress line and the setup command event are redacted and stderr holds no secret: add to verify/verify_test.go next to TestGreenPassRunsEveryItemInOrderOnTheCleanCandidate (unit)
- The check command event is redacted: add to verify/verify_test.go next to TestGreenPassRunsEveryItemInOrderOnTheCleanCandidate (unit)
- The pass record keeps the configured commands and stays complete: add to verify/verify_test.go next to TestGreenPassRunsEveryItemInOrderOnTheCleanCandidate (unit)
- The command_no_progress event and stop detail are redacted: add to verify/hung_test.go next to TestVerifyEndedCommandNoticed (unit)
- A failing setup item shows its exit status, taken by name from p.Setup, and an item without a record is unchanged: add cases to TestPassSummaryProgressLine in verify/pass_test.go and update the expectation in TestFailedSetupRetainsEvidenceAndNamesLaterSetupAndGatesWithoutAnAbsentModel (unit)
- All seven behaviors through the real pass and summary: acceptance.feature driving a Go test in package verify (scenario)
- Unchanged outputs for commands without a secret and the existing summaries: existing tests in verify/pass_test.go, verify/hung_test.go and verify/verify_test.go (existing)

## Feasibility
- none
