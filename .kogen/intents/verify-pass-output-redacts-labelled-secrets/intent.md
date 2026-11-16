# Redact verification pass command output and

Slug: verify-pass-output-redacts-labelled-secrets
Model: not applicable — redaction is a pure function of the text a command printed or a stored record holds; there is no state or interacting rule to model.
Acceptance:
- .kogen/intents/verify-pass-output-redacts-labelled-secrets/acceptance.feature
- features/steps/verify-pass-output-redacts-labelled-secrets__steps.js

Everything a verification pass keeps or shows from a command must be redacted with the nil-safe labelled-pattern redaction the pass already uses for command lines (a `--token` option or a `password=` assignment followed by its value becomes `--token [REDACTED]` / `password=[REDACTED]`; for example `tool --token abc123 --verbose` becomes `tool --token [REDACTED] --verbose`). This widens verify-pass-lines-redact-and-show-status, which redacted command text but left output and repair feedback raw.

1. In `runStepAs` (verify/env.go) the returned `res.Output` of a command that ran without an Attempt (the `RunWatched` branch) is passed once through `attemptFrom(ctx).Redact`, so setup, `Fix`, project checks, acceptance, maintained features, model steps and the runner check all record, log and show masked output through `runLogged` and `runFeature`, and the `environment/setup_failed` refusal lines of `Readiness.Setup` (`Tail(res.Output, 20)` when `r.Attempt` is nil) carry the masked tail. Under an Attempt nothing changes: `Attempt.run` already sets `res.Output = a.Redact(res.Output)`. The next line of the same refusal already masks the command with `r.Attempt.Redact(cmd)`.
2. `runCohortCheck` (verify/concurrent.go), which starts the command with `s.StartCaptured`, passes `o.res.Output` through `attemptFrom(ctx).Redact` before the `command_result` event (which logged `Cap(o.res.Output)`) and before the `CommandResult` is built.
3. `Pass.Feedback` (verify/pass.go) writes `c.Command` and the output tail `Tail(c.Output, 60)` of every failing setup/check line (`check <name> (<command>): failed, exit status <n>`), and the command and output tail of every speculative and cancelled line (`<name> (<command>): status <n>`), through `(*Redactor)(nil).Redact`, so a record stored raw is still fed back masked. The command text in the `acceptance (` and `feature ` lines is redacted the same way.
4. Output and commands with no labelled secret and valid UTF-8 are byte-identical to today. Invalid UTF-8 bytes become U+FFFD (`Redact` behavior, accepted).

Unchanged: `CommandResult.Command` keeps the configured command exactly (`Pass.Complete` compares it); only `Output` is masked when recorded. The `command_result` event of `runLogged` keeps logging `Cap(r.Output)` and the record keeps `r.Output`, now masked at the source; `Account` receives the masked `r.Output`, so `Diagnostic(output)` in `Problems` is masked. Exit statuses, which items are green or failing, order and grouping of feedback items, truncation to 16,384 bytes, `Pass.Summary`, `identity_sha256` of command events and acceptance accounting by scenario are unchanged; testdata/golden/passes.json expectations pass unchanged. No `Input` field, setting or configuration; verify/redact.go and `Redactor` are not changed. A secret known only from the environment (a `*_TOKEN` value with no label) is still masked only where an Attempt with a Redactor exists. `Attempt.Redact` stays the nil-safe form (`attemptFrom(ctx).Redact`).

The Build also adds the six focused, model-free Go unit tests listed under Tests, using the existing `newProj`, `p.session()`, `p.readiness()`, `memLog` and `eq` helpers; each is run with `go test ./verify` and `-run` naming only that test. For the setup refusal test, `r.Setup(ctx, s, p.Root, false)` with `p.Config.Setup = []string{"echo password=abc12345; exit 4"}` refuses with `environment/setup_failed`.

## Decisions
- Mask in `runStepAs` with `attemptFrom(ctx).Redact(res.Output)` only on the no-Attempt branch, so every caller gets masked output once and Attempt behavior is untouched. (decision: D1, round 1) (evidence: verify/env.go; verify/attempt.go; verify/run.go; verify/readiness.go) (source: request)
- `runCohortCheck` masks `o.res.Output` after the sweep and before the `command_result` event and the `CommandResult`; the recorded `Command` stays raw. (decision: D2, round 1) (evidence: verify/concurrent.go) (source: request)
- `Pass.Feedback` uses a nil `*Redactor` for command text and output tails in the failing, speculative and cancelled lines and for the acceptance and feature command text, so older raw records are fed back masked. (decision: D3, round 1) (evidence: verify/pass.go; verify/redact.go) (source: request)
- Acceptance runs one Go driver test in package verify through a Go build overlay (nothing built at load, checkout unchanged) and the scenarios observe the JSON it writes; it does not depend on test names the Build must invent. (decision: D4, round 1) (evidence: features/steps/verify-pass-lines-redact-and-show-status__steps.js; verify/helper_project_test.go; verify/readiness_test.go; verify/helper_test.go) (assumption: an external scratch copy showed the driver reporting the expected masked values with the correct implementation; this is not Kogen's own record) (source: request)

## Source comparison
- Request item 1 (runStepAs masking, setup refusal lines `environment/setup_failed`, pass record and log): scenarios 1, 2 and 4.
- Request item 2 (concurrent check): scenario 3.
- Request item 3 (Feedback for stored records, speculative and cancelled results, acceptance and feature command text): scenarios 5 and 6; the acceptance problems are observed in scenario 4.
- Request item 4 and constraints (byte-identical without secrets, configured command kept in the record, golden passes.json): existing tests in verify (existing).
- Literals: `echo password=abc12345; exit 4`, `echo password=abc12345; exit 1`, `echo password=abc12345; exit 2`, `lint --token abc123`, `vet --token abc123`, `slow --token abc123` with expected outputs exactly as written in acceptance.feature.

## Tests
- Setup refusal lines are masked: TestSetupRefusalLinesRedactLabelledOutput in verify/readiness_test.go next to TestSetupCommandResultsCarryWallTimeAlsoWhenTheCommandFails (unit)
- A pass records and logs masked check output: TestPassRedactsCheckOutputInRecordAndLog in verify/verify_test.go next to TestPassRedactsSecretsInProgressAndCommandEventsButRecordsTheConfiguredCommands (unit)
- A concurrent check is masked in result and log: TestCohortCheckRedactsOutputInResultAndLog in verify/concurrent_test.go next to TestCohortCancellationAtLaunch (unit)
- Acceptance output is masked in the problems and feedback: TestAcceptanceOutputRedactedInProblems in verify/verify_test.go (unit)
- Feedback masks the command and output of a stored failing result: TestFeedbackRedactsCommandAndOutputOfStoredResults in verify/feedback_group_test.go next to TestFeedbackGroupsCommandsAndSections (unit)
- Feedback masks speculative and cancelled results: TestFeedbackRedactsSpeculativeAndCancelledResults in verify/feedback_group_test.go (unit)
- All six behaviors through the real pass, readiness and feedback: acceptance.feature driving a Go test in package verify (scenario)
- Unchanged output without secrets: existing tests in verify including the golden passes.json comparison (existing)

## Feasibility
- none
