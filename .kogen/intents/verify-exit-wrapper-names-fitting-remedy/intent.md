# Name a fitting remedy for each exit-code wrapper

Slug: verify-exit-wrapper-names-fitting-remedy
Model: not applicable — the change is a stateless mapping from a step definition body to a refusal message
Acceptance:
- .kogen/intents/verify-exit-wrapper-names-fitting-remedy/acceptance.feature
- features/steps/verify-exit-wrapper-names-fitting-remedy__steps.js
- features/steps/verify-exit-wrapper-names-fitting-remedy__driver/main.go

The step self-check (`verify.StepItems`, the `exit_code` item) refuses a step definition that asserts an exit code but obtains it through a wrapper that changes exit codes. Today the refusal for an npm run wrapper reads `step definition asserts an exit code but obtains it through npm run, which changes exit codes; build the binary (go build) and run it instead` (the real message also names the definition's pattern after `step definition`), so the remedy part is always the Go advice `build the binary (go build) and run it instead`, which does not apply to a JavaScript site that is started with npm run or npx.

After this change the refusal for a `go run` wrapper stays exactly as it is, byte for byte. For any other wrapper (npm run, npx, and likewise yarn run and pnpm run) the remedy is `run the program that the script starts directly (for example node followed by its file) and read its exit code`, and the refusal does not contain the words `go build`. The classification of a definition as refused, the rest of the message (`step definition <pattern> asserts an exit code but obtains it through <wrapper>, which changes exit codes; `) and the files in scope stay unchanged: only `verify/stepcheck.go` and `verify/stepcheck_test.go` change. The shaping-repo copy of the message, `verify/unused_step_warn_test.go`, documentation and the set of strings that count as wrappers are out of scope.

One refusal per step definition: when a definition uses several wrappers, the single refusal names the wrapper that comes first in the definition's text, not the one that a fixed priority order would pick.

## Decisions
- The remedy depends only on the wrapper: `go run` keeps `build the binary (go build) and run it instead`; every other wrapper gets `run the program that the script starts directly (for example node followed by its file) and read its exit code`. (decision: D1, round 1) (evidence: verify/stepcheck.go) (source: request)
- A definition that uses several wrappers yields one refusal that names the first wrapper in the definition's text. `ExitWrapper` therefore picks the wrapper with the lowest position in the body instead of the fixed order go run, npm run, npx; the strings it recognises and the ` -- ` passthrough exemption for npm run and npx are unchanged. (decision: D2, round 1) (evidence: verify/stepcheck.go; verify/stepcheck_test.go) (source: request)
- yarn run and pnpm run are not newly detected (wrapper detection is out of scope); the remedy rule is stated for every wrapper other than go run so that it fits them if detection names them. (decision: D3, round 1) (evidence: verify/stepcheck.go) (assumption: the request lists yarn run and pnpm run only as wrappers that get the fitting remedy, not as wrappers to start detecting) (source: request)
- A definition that runs npm run but asserts no exit code stays unrefused, as today. (decision: D4, round 1) (evidence: verify/stepcheck.go) (source: request)
- The existing golden-style test in verify/unused_step_warn_test.go expects the unchanged go run message and keeps passing without edits. (decision: D5, round 1) (evidence: verify/unused_step_warn_test.go) (source: request)

## Source comparison
- Addressed: npm run and npx refusals no longer contain `go build` and contain `directly` (scenarios 1 and 2 of the request, acceptance scenarios "npm run is refused with a fitting remedy" and "npx is refused with a fitting remedy"). The old text `step definition asserts an exit code but obtains it through npm run, which changes exit codes; build the binary (go build) and run it instead` is superseded for non-go wrappers.
- Addressed: the go run refusal is byte-for-byte the current message (scenario 3, "go run keeps its refusal exactly").
- Addressed: one refusal naming the first wrapper in the text when a definition uses npm run and go run (scenario 4, "several wrappers give one refusal naming the first"). This changes the choice made by `ExitWrapper` for such bodies, which today always returns go run.
- Addressed: npm run without an exit code is not refused (scenario 5, "npm run without an exit code is not refused").
- Omitted by request: the shaping repo copy of the message, verify/unused_step_warn_test.go, detection of new wrappers, documentation.

## Tests
- npm run, npx and (by the remedy rule) other non-go wrappers get the fitting remedy and no `go build`; go run keeps the exact Go message: extend verify/stepcheck_test.go with a focused test of the `exit_code` item detail from StepItems, in the style of TestExitWrapper (unit)
- A definition with several wrappers names the first one in its text and yields one refusal: add cases to TestExitWrapper and a StepItems case in verify/stepcheck_test.go (unit)
- npm run without an exit code is not refused: add a case in verify/stepcheck_test.go (unit)
- The go run refusal reaches readiness unchanged: existing TestUnusedStepWarnReadinessRefusals in verify/unused_step_warn_test.go (existing)
- End to end through the self-check: acceptance.feature drives verify.StepItems with a step definition body through a built Go driver (scenario)

## Feasibility
- none
