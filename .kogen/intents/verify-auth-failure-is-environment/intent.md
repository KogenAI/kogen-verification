# Report unauthenticated model tool as environment

Slug: verify-auth-failure-is-environment
Model: not applicable — EnvFailure is a pure transformation of one check result; it owns no state
Acceptance:
- .kogen/intents/verify-auth-failure-is-environment/acceptance.feature
- features/steps/verify-auth-failure-is-environment__steps.js
- features/steps/verify-auth-failure-is-environment__driver/main.go

A Build burns builder rounds on a check that cannot pass because the model command-line tool it calls is not authenticated in the verification environment; that output is treated as an ordinary red check. `verify.EnvFailure` must also report a line of a failed check whose text contains the exact phrase `Check authentication and model access` as an environment failure, trimmed of surrounding whitespace, with the same first-line, status and test-block rules as the existing cases: a zero status result is never a failure, and a line inside a failing Go test block is not reported, so a test that quotes the phrase stays an ordinary failure. Every other recognised line and every non-matching output keeps its result exactly. Scope: `verify/envfailure.go` and `verify/envfailure_test.go`. Out of scope: kogen-build and the host-or-base stop, every other verify file, project check scripts, documentation, and any change to which environment failures stop a Build.

## Decisions
- EnvFailure reports a line containing the exact, case-sensitive phrase `Check authentication and model access`, trimmed, as an environment failure; the phrase is matched as a whole phrase, not the word authentication. (constraint: zero status never reports a failure) (constraint: a line inside a failing Go test block is not reported) (constraint: only the exact phrase matches, not the word authentication) (constraint: every other recognised line and non-matching output keeps its result) (evidence: verify/envfailure.go; verify/envfailure_test.go) (assumption: the phrase text is taken verbatim from the request; the real Bruno output was not observed) (source: request)
- Acceptance runs the real exported verify.EnvFailure through a Go driver built once on first use, and the TestEnvFailure table gains rows for the new phrase. (constraint: scope is verify/envfailure.go and verify/envfailure_test.go only) (evidence: verify/envfailure_test.go; features/steps/envfailure_steps.js; features/steps/envfailure/main.go) (source: request)
- verify.EnvFailure reports a line of a nonzero-status check that contains the exact phrase `Check authentication and model access` (trimmed) as an environment failure, using the same first-line, status and failing-test-block rules as the existing resource phrases. (decision: D1, round 1) (constraint: zero status never reports a failure) (constraint: a line inside a failing Go test block is not reported) (constraint: only the case-sensitive exact phrase matches, not the word authentication) (constraint: every other recognised line and non-matching output keeps its result) (evidence: verify/envfailure.go; verify/envfailure_test.go) (assumption: The phrase text is taken verbatim from the request; the real Bruno output was not observed here.) (source: request)
- Acceptance runs the real exported verify.EnvFailure through a Go driver built once on first use, and the TestEnvFailure table gains rows for the new phrase. (decision: D2, round 1) (constraint: scope is verify/envfailure.go and verify/envfailure_test.go only) (evidence: verify/envfailure_test.go; features/steps/envfailure_steps.js; features/steps/envfailure/main.go) (assumption: none) (source: request)

## Source comparison
- addressed: the request's Expected paragraph maps to the phrase rule in verify/envfailure.go and to the five acceptance scenarios (request scenarios 1, 2, 3, 4 and 5; scenario 4 is two scenarios, ordinary-line-first and disk-line-first).
- addressed: guarantees "a zero status result is never a failure" and "a line inside a failing Go test block is not reported" are scenarios 2 and 3.
- omitted by request: kogen-build, the host-or-base stop, other verify files, check scripts and documentation are unchanged.

## Tests
- A line containing the exact phrase in a failed check is an environment failure, trimmed; status 0, failing-test-block lines and the word authentication alone are not: extend the TestEnvFailure table in verify/envfailure_test.go with rows for each case (unit)
- Earlier ordinary line and earlier disk line precede the phrase line: TestEnvFailure rows with the phrase on the second line (unit)
- Same behaviours through the exported EnvFailure: acceptance.feature scenarios (scenario)

## Feasibility
- none
