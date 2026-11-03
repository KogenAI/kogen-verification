# Ignore resource phrases quoted by failing tests

Slug: k-verify-quoted-resource-text
Model: not applicable — EnvFailure is a pure report transformation; repeated calls do not own Build lifecycle state
Acceptance:
- .kogen/intents/k-verify-quoted-resource-text/acceptance.feature
- features/steps/envfailure_steps.js
- features/steps/envfailure/main.go

Replace unconditional resource-substring matching in verify.EnvFailure with report-aware classification. Keep its CommandResult input and (trimmed line, matched) return contract. A nonzero failing test remains candidate red when resource text occurs only in its test-output block. Zero status always returns ("", false). Preserve all existing check gates, timeout handling and resource phrases; never turn a failed check green.

Test-output blocks begin at a `--- FAIL:` header and end at the next `--- ` header or package summary. Preserve raw indentation while determining boundaries. Assertion lines and arbitrary logged text inside the block are candidate evidence, including text resembling an OS error. Bare `FAIL`, `exit status 1`, and the package `FAIL\t...` summary in the supplied reports delimit test evidence from later standalone host diagnostics. A resource diagnostic outside the block decides host failure, including one after a candidate block. Return the first qualifying host line, trimmed, not an earlier candidate quote. Keep the existing Go test timeout panic classification.

Two successive verification passes containing the same candidate-red report must remain repairable rather than becoming a host/base stop; after the builder repairs the function the unchanged test can pass. This component exposes classification, not the parent Kogen Build command: executable acceptance exercises the real exported classifier twice followed by the successful report, while the parent lifecycle guarantee remains required consumer behavior. Do not introduce retry policy or a new Build driver in this library.

## Decisions
- Treat assertion messages and test logs within failing-test blocks as candidate evidence, regardless of OS-like wording. (source: request)
- Use outside-block diagnostics and existing timeout panic detection for host evidence, gated by nonzero status. (source: request)
- Retain ordinary failed-check gates and repair opportunities; no failure is made green. (source: request)

## Source comparison
- addressed: request problem and Need paragraphs map to the report-aware EnvFailure contract above and candidate/host scenarios; the unconditional scan in verify/envfailure.go is replaced.
- addressed: synthetic examples 1–6, including exact package names, paths, durations, statuses and phrase substitutions, appear as executable scenario rows below. Additional outside-block runtime/open lines retain the Need examples and existing timeout behavior.
- addressed with component-boundary limitation: example 7 maps to repeated classifier calls and a repaired report in acceptance, and to the required parent Build repairability guarantee above. An actual parent Build repair conversation is not executed by this repository's acceptance; it is not represented as proven here.
- superseded: k-verify-resource-assertion-red is replaced by this slug, not reused as evidence; all supplied reports are complete classifier inputs.
- omitted: no requested resource class, gate, or settled literal is intentionally removed. No external provider/protocol behavior changes.

## Tests
- Resource phrases in assertions and logs stay candidate red: extend TestEnvFailure with the supplied complete reports (regression)
- Block and summary boundaries distinguish later host diagnostics and next headers: extend TestEnvFailure with boundary cases (unit)
- Outside-block resource lines and timeout panic retain first qualifying trimmed line behavior: retain TestEnvFailure and add complete host reports (unit)
- Every supplied report with zero status is non-host: acceptance scenario outline uses zero and nonzero statuses (regression)
- Repeated candidate failures remain non-host and a repaired report is non-host: repeated exported-classifier acceptance sequence; retain existing failed-check gate tests (integration)

## Feasibility
- none
