# Ignore timeout text logged by failing tests

Slug: envfailure-ignores-timeout-logs
Model: not applicable — EnvFailure is a stateless function of one command result
Acceptance:
- .kogen/intents/envfailure-ignores-timeout-logs/acceptance.feature
- features/steps/envfailure-ignores-timeout-logs__steps.js

EnvFailure in verify/envfailure.go must not report a line that looks like the Go test timeout (`panic: test timed out after `) when that line is text logged by a failing test, so a product failure whose test logs such text is not turned into an environmental refusal. A real Go test timeout outside a failing test's logged output is still reported. The change is confined to verify/envfailure.go and verify/envfailure_test.go. Other environment failure signals (host resource phrases, unauthenticated model tool) and the verification output formats are unchanged.

Text logged by a failing test is what the existing rule already skips for the resource phrases: the indented lines after a `--- FAIL:` header, up to the next unindented `--- ` header, a bare `FAIL`, a `FAIL<tab>` package line or `exit status 1`. The timeout check follows that rule for such lines. The Go test binary prints its own timeout panic at the start of a line, with no indentation, so an unindented `panic: test timed out after ` line is a real timeout even when it follows a failing test's lines with no boundary line between. Nothing is removed; no setting is added.

## Decisions
- A timeout-looking line that is indented and lies inside a failing test's output (the text a test logs) is not an environment failure; the existing in-test skip now applies to it as it already does to resource phrases. (evidence: verify/envfailure.go; verify/envfailure_test.go) (source: request)
- A real Go test timeout outside a failing test's logged output is still reported: a line that starts, with no leading whitespace, with the timeout text is always reported, including directly after a failing test's lines with no boundary line, and an indented timeout line outside any failing test is reported as before. A line that does not begin with the timeout text after trimming whitespace is still ignored. (evidence: verify/envfailure.go; verify/envfailure_test.go) (source: request)
- Acceptance calls verify.EnvFailure through the existing driver program in features/steps/envfailure, which the new step file compiles once on first use and reuses, as the README requires of step code. (evidence: features/steps/envfailure/main.go; features/steps/envfailure_steps.js; README.md) (assumption: the user accepts reusing the existing driver program as the acceptance entry point) (source: request)
- Distinguishing logged text from the real panic by indentation is a repository-level limit: a test that prints the timeout text unindented to standard output cannot be told apart from a real timeout and is reported. (assumption: the user accepts this limit, since the request names logged text) (source: request)

## Source comparison
- Addressed: a timeout-looking line logged inside a failing Go test is not reported (acceptance scenario 1).
- Addressed: "A real Go test timeout outside a failing test's logged output is still reported" (acceptance scenarios 2, 3 and 4, and the existing timeout cases in TestEnvFailure).
- Out of scope and unchanged: other environment failure signals and verification output formats.

## Tests
- A timeout-looking line logged inside a failing test is not an environment failure: add a case to TestEnvFailure in verify/envfailure_test.go (unit)
- A real timeout is still reported, plain, directly after a failing test's lines and after a finished failing test: add cases to TestEnvFailure in verify/envfailure_test.go (unit)
- Both behaviors through the real entry point: acceptance.feature runs verify.EnvFailure via the existing driver (scenario)

## Feasibility
- none
