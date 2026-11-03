# Recognize host resource verification failures

Slug: k-verify-env-failure-classes
Model: not applicable — classification is a stateless function of a command result
Acceptance:
- .kogen/intents/k-verify-env-failure-classes/acceptance.feature
- features/steps/envfailure_steps.js
- features/steps/envfailure/main.go

Extend verify.EnvFailure(CommandResult) (string, bool), replacing the timeout-only rule and its comment with a closed resource classifier. For nonzero status, scan lines in output order and return the first qualifying line with surrounding whitespace trimmed and true. No match returns empty string and false. Zero status always returns empty string and false. Preserve the existing Go timeout prefix rule exactly. Resource lines qualify when they contain one of these case-sensitive literals: `no space left on device`, `cannot allocate memory`, `out of memory`, `Out of memory: Killed process`, `too many open files`. The capitalized literal covers the standard Linux kill notice; do not classify generic `Killed` output. No resource probing, retry mechanism, caller changes or broader error taxonomy is requested.

## Decisions
- Recognize disk exhaustion, allocation failure / out-of-memory kill notices, and open-file exhaustion only on nonzero status; retain the matched trimmed line and first-match ordering. (source: request)
- Port conflicts and missing files remain candidate failures; zero status never qualifies. (source: request)

## Source comparison
- Addressed: Request Problem/Need and evidence verify/envfailure.go:1-26 are covered by the extended closed classifier above, replacing the single-rule comment without changing the interface.
- Addressed: Synthetic acceptance 1–4 is executable in the outline, including `/x`, status 1, status 0, allocation and file-limit failures, `address already in use`, and `no such file or directory`.
- Addressed: Synthetic acceptance 5 is covered by timeout preservation, prefix-only rejection, trimming and both mixed-category ordering cases. Existing TestEnvFailure remains useful and must be retained.
- Addressed: the requested out-of-memory kill notice is settled as the explicit capitalized Linux notice plus lowercase `out of memory`; no arbitrary kill signal inference is added. No requested behavior is omitted or superseded.

## Tests
- Host resource conditions classify with the trimmed original line: extend TestEnvFailure table with disk, allocation, memory and file-limit cases (regression)
- Zero status rejects each supported condition: extend TestEnvFailure table (unit)
- Port conflict, missing file and generic kill text remain unclassified: extend TestEnvFailure table (unit)
- Timeout prefix semantics and first matching line across categories are preserved: extend TestEnvFailure table and retain existing cases (regression)

## Feasibility
- none
