# Name failing scenarios in verification summaries

Slug: verification-summary-names-failing-scenarios
Model: not applicable — deterministic text rendering has no meaningful state
Acceptance:
- .kogen/intents/verification-summary-names-failing-scenarios/acceptance.feature
- features/steps/verification-summary-names-failing-scenarios__steps.js
- features/steps/verification-summary-names-failing-scenarios__driver/main.go

Change Pass.Summary in verify/pass.go so acceptance failures show progress instead of repeating an indistinguishable failure line. When acceptance is among p.Failing and p.Acceptance has scenario results, append ` (F of M scenarios: <name>:<line>, ...)` to the failure description. F counts every scenario whose status is not `passed`; M counts all scenarios. List at most the first three non-passed scenarios in feature order, adding `, ...` only if there are more than three. Preserve all other text, including pass number, other failing items, speculative/cancelled sections and not-run tail. With nil acceptance or no scenario results, retain the previous summary. Do not change ChecksLine, Results or feedback text.

During implementation add failing regression tests first, then change the implementation, then run the verify package tests. The regression cases must cover seven scenarios with two failures and their lines, five failures truncated to three names, and acceptance not run. Keep useful existing tests.

## Decisions
- Use the scenario result order and status fields rather than aggregate counters to derive the summary details. (evidence: verify/report.go; verify/pass.go) (source: request)
- Limit the change to Summary text; no new settings or output formats. (source: request)

## Source comparison
- Addressed: request's 10 November 2026 studio-coord-model-heads-drift observation of six identical progress lines despite failures falling from seven to two motivates the count and names in Summary; the prose rule and acceptance's Two of seven and Five failures truncate after three scenarios exercise the requested replacement.
- Addressed: request's literal `acceptance failed (F of M scenarios: <name>:<line>, ...)`, non-passed status counting, feature order, three-name cap, and unchanged not-run behavior are preserved in the rendering rule and executable scenarios.
- Addressed: request's tests-first sequence and `verify` package test run are required above; ChecksLine, Results and feedback are explicitly unchanged. No requested behavior is omitted or superseded.

## Tests
- Count and name non-passed scenarios: add focused Pass.Summary regression tests and exercise the callable interface with seven results (regression)
- Truncate names after three: add a five-failure Summary regression and assert exact ordered text (regression)
- Preserve summary when acceptance did not run: add an exact Summary regression for nil acceptance (regression)
- Preserve other reporting: retain existing ChecksLine, Results and feedback tests and run go test ./verify (existing)

## Feasibility
- Local proof-artifact generation succeeded; no external dependencies or protocol assumptions are introduced.
- Ran `go test ./verify` on the unchanged implementation: exit 1 after 143.7 seconds. TestShapeProbeMinimalEnvironment failed because inherited MISE_TRUSTED_CONFIG_PATHS included multiple scratch paths instead of only the expected scratch copy; this is an observed baseline environment failure, not a Summary regression. Run the verify package tests again during implementation and report any remaining failure honestly.
