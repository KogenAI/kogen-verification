# Name changed inputs in readiness refusals

Slug: readiness-refusal-names-changed-inputs
Model: not applicable — the change is a pure comparison of five recorded inputs against their current values, with no state that evolves across steps
Acceptance:
- .kogen/intents/readiness-refusal-names-changed-inputs/acceptance.feature
- features/steps/readiness-refusal-names-changed-inputs__steps.js

When `RecordPass` in verify/readiness.go cannot record readiness evidence because the checked inputs changed, its refusal (`intent/not_ready`) names which inputs changed and what to do. Today the first refusal has the single line `readiness inputs changed during checking or publication` and the second (after the record is written) has no lines at all.

A new unexported function `changedInputs` in verify/readiness.go returns the names of the inputs that differ from the checked result, in this order: `baseline files`, `baseline contents`, `HEAD`, `candidate tree`, `feasibility evidence`. When the current inputs cannot be read at all it returns the single name `unreadable inputs`. A nil `ready` yields a nil list. `Current` keeps its signature and meaning: it is true exactly when `ready` is not nil and the list is empty.

Both refusals in `RecordPass` keep class `intent`, reason `not_ready` (that is, `intent/not_ready`), exit 1, their `Detail` (`the Intent is not ready to build` at the first, `readiness inputs changed during publication` at the second) and the removal of the record. When the list is not empty they gain these lines after the existing first line (the second refusal has no first line, so its lines are just these two):
1. `changed: ` followed by the names joined with `, `, for example `changed: candidate tree`.
2. `next: stop whatever changed the checkout while Kogen was checking, then rerun the command that was refused`.

The first refusal keeps `readiness inputs changed during checking or publication` as its first line. A nil result keeps exactly today's refusal (that one line only). Nothing else changes: not which inputs are compared, `Cached`, `Check`, the published record, the exit code or any other refusal; no new field, setting or configuration.

The unit tests live in verify/readiness_test.go next to the existing test, use the helpers `isolateTmp`, `newProj`, `p.readiness()`, `p.session()`, `p.write`, `p.git`, `failWith` and `eqSlice`, and follow the pattern of that test: run `r.Check`, remove the record at `readinessPath(p.Root, fixtureSlug)`, change one thing, then call `r.RecordPass(s, fixtureSlug, ready)`. The existing TestReadinessRecordIsRefusedWhenItsInputsChangedDuringChecking pins only the old one-line result; it is replaced by TestRecordPassRefusalListsEveryChangedInput with the new expectation.

## Decisions
- Add an unexported `changedInputs` in verify/readiness.go and define `Current` through it, so the signature and meaning of `Current` (also called from contract/contract_test.go and tests) stay. (decision: D1, round 1) (evidence: verify/readiness.go; verify/readiness_test.go) (source: request)
- The `changed:` and `next:` lines are added only when the list is non-empty, so a nil result keeps today's single-line refusal; the second refusal carries only these two lines. (decision: D2, round 1) (evidence: verify/readiness.go) (source: request)
- The existing one-line test is renamed and updated to TestRecordPassRefusalListsEveryChangedInput, since the feature-file edit changes both the baseline contents and the candidate tree; two new focused tests cover the candidate tree and HEAD, all asserting the refusal with `failWith` (class `intent`, reason `not_ready`) and the lines with `eqSlice`. (decision: D3, round 1) (evidence: verify/readiness_test.go) (source: request)
- Acceptance drives RecordPass through a Go test driver written into a scratch copy of the checkout, so it does not depend on test names the Build invents; the second (publication) refusal is not driven because it needs a change racing the write and has no deterministic trigger. (decision: D4, round 1) (evidence: verify/readiness_test.go; features/steps/fix-k-verify-check-wall-ms__steps.js) (assumption: the race-only publication refusal is covered by the shared changedLines helper and the unit tests, not by a dedicated scenario) (source: request)

## Source comparison
- Addressed: every refusal of `RecordPass` for changed inputs names the changed inputs and the next step; scenarios 1 to 3 of the request map to the three acceptance scenarios with the exact `Lines` given, and the nil-result rule is pinned by a fourth scenario.
- Addressed: the order `baseline files`, `baseline contents`, `HEAD`, `candidate tree`, `feasibility evidence` and `unreadable inputs` are specified above; the baseline files and feasibility evidence names and `unreadable inputs` have no dedicated acceptance scenario (the request names no fixture for them) and are covered by the ordered list in the code contract.
- Preserved: class `intent`, reason `not_ready` (`intent/not_ready`), exit, `Detail` strings, removal of the record, `Current` signature and meaning, compared inputs; test helpers `failWith` and `eqSlice` as named by the request.
- Superseded: the old one-line expectation in TestReadinessRecordIsRefusedWhenItsInputsChangedDuringChecking.

## Tests
- A new file changes only the candidate tree and the refusal names it with the next step: TestRecordPassRefusalNamesTheCandidateTree in verify/readiness_test.go, using failWith and eqSlice (unit)
- A moved HEAD is named alone: TestRecordPassRefusalNamesHead in verify/readiness_test.go (unit)
- Several changed inputs are listed in the specified order: TestRecordPassRefusalListsEveryChangedInput in verify/readiness_test.go, the updated existing test (unit)
- A nil result keeps today's one-line refusal: the nil scenario of the acceptance feature (scenario)

## Feasibility
- The driver, written into a scratch copy with the controls' correct implementation applied, ran as go test ./verify -run '^TestReadinessRefusalDriver$' -count=1 -v and reported the three lines expected by the feature for each case and the single first line for the nil case. (scratch run: exit 0, 1.5 s)
- evidence: {"id":"refusal-observer","kind":"observer","inputs":["features/steps/readiness-refusal-names-changed-inputs__steps.js"],"observers":["features/steps/readiness-refusal-names-changed-inputs__steps.js"],"checks":[{"name":"good","command":"node features/steps/readiness-refusal-names-changed-inputs__steps.js good","exit":0,"output":"good controls accepted\n"},{"name":"bad","command":"node features/steps/readiness-refusal-names-changed-inputs__steps.js bad","exit":1,"output":"bad controls rejected\n"}]}
