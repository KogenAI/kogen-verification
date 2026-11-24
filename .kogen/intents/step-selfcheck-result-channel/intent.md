# Authenticate step self-check result lines

Slug: step-selfcheck-result-channel
Model: not applicable — this change distinguishes a process result from stdout noise without meaningful domain state
Acceptance:
- .kogen/intents/step-selfcheck-result-channel/acceptance.feature
- features/steps/step-selfcheck-result-channel__steps.js
- features/steps/step-selfcheck-result-channel__driver/main.go

Fix ev-e285f2fc in `verify/stepcheck.go` and add regression coverage in `verify/stepcheck_test.go`. RunStepScript must distinguish the verifier’s result from output produced by loaded step files. Replace acceptance of the first stdout line bearing the fixed `KOGEN_SELFCHECK_RESULT:` prefix and valid JSON with invocation-specific result identification. Keep the public interface and result schema unchanged. Do not change which step definitions pass or how unused definitions are reported.

The original report is: “In verify/stepcheck.go, RunStepScript accepts the first stdout line with the KOGEN_SELFCHECK_RESULT prefix when its remainder is valid JSON. A required step file is loaded in that same Node process and can print a matching line before the verifier emits its result, causing candidate output to be accepted as the self-check result.” The required outcome is: “Make RunStepScript distinguish the verifier’s result from output produced by loaded step files, and add a regression test for a forged result line.” Production scope is exactly `verify/stepcheck.go` and `verify/stepcheck_test.go`; protected acceptance artifacts only exercise that scope.

## Decisions
- A loaded step file that prints a valid-looking result line cannot make RunStepScript report that line as the verifier’s result. (decision: D1, round 1) (evidence: verify/stepcheck.go) (source: request)
- Keep RunStepScript's public signature and StepRaw schema; distinguish the verifier output using a fresh unpredictable per-invocation result prefix passed to the verifier on stdin, without a new setting or option. (decision: D2, round 1) (evidence: verify/stepcheck.go) (source: request)
- Preserve loaded true for a normal self-check result and leave the verifier result unchanged by ordinary step-file stdout that does not contain the result marker. (decision: D3, round 1) (evidence: verify/stepcheck.go) (source: request)
- Limit production changes to verify/stepcheck.go and verify/stepcheck_test.go; do not change which step definitions pass or how unused definitions are reported. (decision: D4, round 1) (evidence: verify/stepcheck.go; verify/stepcheck_test.go) (source: request)
- Exercise the callable RunStepScript interface with real local Node and Cucumber, using a Go driver built once on first use and asynchronous child processes in the Cucumber steps. (decision: D5, round 1) (evidence: README.md; verify/stepcheck.go; prereq/prereq.go; .kogen/project.yaml) (source: request)

This fixes result provenance against the reported stdout forgery. Open limit: loading JavaScript in the same Node process is not a general-purpose isolation boundary against arbitrary runtime tampering; this change does not introduce a sandbox.

## Source comparison
- Addressed: request evidence `ev-e285f2fc` and the fixed-prefix forgery are reproduced by acceptance.feature, “Reject a forged result line”, through the actual RunStepScript API. Its expected loads, definitions and step matches belong to the verifier, not the forged JSON. The corresponding controls.json wrong overlay restores the original first-matching-line parser.
- Addressed: request acceptance 2 is the “Parse a normal self-check result” scenario, including loaded true and actual definition/match contents. The corresponding wrong overlay returns loaded false instead of accepting a valid verifier result.
- Addressed: request acceptance 3 is the “Ignore ordinary step-file stdout” scenario. It includes both diagnostic text and JSON without the result marker; neither may replace the verifier result. Its wrong overlay treats arbitrary JSON stdout as a result.
- Addressed: the requested regression test is added to verify/stepcheck_test.go, with the three cases exercised through Node/Cucumber. Existing definition-policy tests remain useful and unchanged (evidence: verify/stepcheck_test.go).
- Superseded: only the fixed-marker first-valid-JSON selection in verify/stepcheck.go is replaced; its public input/output types and the existing definition/unused-warning policy stay unchanged (evidence: verify/stepcheck.go).
- Omitted: no requested behavior or settled non-secret literal is omitted. The request's two-file production scope is preserved; acceptance helpers and bounded implementation overlays are proof artifacts, not additional product features. No conflicting requirement was identified.

## Tests
- Forged result provenance: add a real Node/Cucumber regression case in verify/stepcheck_test.go and exercise its reproducing stdout through the forged-line acceptance scenario (regression)
- Normal result parsing: add a valid-control case in verify/stepcheck_test.go and compare the real RunStepScript return with the feature's expected verifier observation, including loaded true (integration)
- Ordinary stdout isolation: add an ordinary-output case in verify/stepcheck_test.go and exercise diagnostic and unmarked JSON output through the ordinary-stdout acceptance scenario (integration)
- Definition policy preservation: keep TestStepItems, TestStepItemsExitCodeRemedy and TestExitWrapper unchanged in verify/stepcheck_test.go (existing)

## Feasibility
- The local driver observed the real normal result with loaded true; the same driver on the unchanged implementation observed the forged loads/definitions/steps instead of the verifier result. These observations supply the observer-good.json and observer-bad.json fixtures. The bounded correct overlay's focused TestRunStepScriptResultChannel passed all three cases in a scratch probe. No external protocol or provider dependency changes.
- evidence: {"id":"result-observer","kind":"observer","inputs":[".kogen/intents/step-selfcheck-result-channel/observer-good.json",".kogen/intents/step-selfcheck-result-channel/observer-bad.json","features/steps/step-selfcheck-result-channel__driver/main.go"],"observers":["features/steps/step-selfcheck-result-channel__steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/step-selfcheck-result-channel__steps.js good","exit":0,"output":"observer accepted\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/step-selfcheck-result-channel__steps.js bad","exit":1,"output":"observer rejected\n"}]}
