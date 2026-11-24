# Add direct step analysis ordering tests

Slug: step-analysis-order-contract
Model: not applicable — this test-only change pins a deterministic analysis result and introduces no state transitions
Acceptance:
- .kogen/intents/step-analysis-order-contract/acceptance.feature
- features/steps/step-analysis-order-contract__steps.js

Add direct tests in verify/stepcheck_test.go that pin step analysis file ordering and distinct step text collection for the default and configured step directories. Keep existing useful tests. Change neither step analysis behavior nor readiness; the implementation scope is only verify/stepcheck_test.go. Acceptance uses temporary overlays to demonstrate that these tests would reject the specified wrong implementations without delivering any production changes.

Original request (evidence ev-a0eefa92): In verify/stepcheck.go, StepAnalysisIn puts the Intent’s own step files first, sorts the other JavaScript files, and deduplicates scenario step texts. verify/stepcheck_test.go tests ExitWrapper and StepItems but has no direct test for StepAnalysisIn or StepAnalysis. Expected: Add direct tests that pin step analysis file ordering and distinct step text collection for the default and configured step directories. Scope: verify/stepcheck_test.go. Out of scope: changing step analysis behavior or readiness.

Requested acceptance:
1. A test with own and non-own JavaScript files confirms own files remain first and other files are sorted. Wrong-implementation: sorting the full list would move own files and fail the ordering assertion.
2. A scenario set with repeated step text confirms each distinct text appears once in first-seen order. Wrong-implementation: collecting every occurrence or sorting the texts would fail the assertion.
3. Tests cover both the default directory and a configured nested directory. Wrong-implementation: testing only the default directory would leave configured directory behavior unpinned.

## Decisions
- Limit implementation edits to verify/stepcheck_test.go; change neither step analysis behavior nor readiness. (source: request)
- Assert that own files remain first in their Intent acceptance order and the remaining JavaScript files are sorted, comparing complete returned lists. (evidence: verify/stepcheck.go) (source: request)
- Assert that each distinct text appears once in first-seen order, including repeated text within and across scenarios. (source: request)
- Exercise StepAnalysis for the default directory and StepAnalysisIn for an empty directory argument and a configured nested directory, using temporary real directories and project.Intent and project.Scenario values. These entry points return own, files and texts string slices. (evidence: verify/stepcheck.go) (source: request)
- Use focused Go tests and the existing Go testing conventions; acceptance discovers the test names present in verify/stepcheck_test.go, builds one overlaid test binary and reuses it to check unchanged analysis and isolated wrong behaviors. No new test name is prescribed. (evidence: verify/stepcheck_test.go; README.md; .kogen/project.yaml) (source: request)

## Source comparison
- Addressed: the original request’s scope and exclusions are preserved in the outcome and Decisions: only verify/stepcheck_test.go is an implementation target; analysis and readiness are unchanged.
- Addressed: request acceptance 1 maps to the Own files precede sorted other files scenario and the full-list-sort mutation, including nonalphabetical own-file order and alphabetically earlier non-own files.
- Addressed: request acceptance 2 maps to Distinct texts retain first-seen order and separate mutations for every occurrence and sorted texts. Complete text lists, not counts alone, are required.
- Addressed: request acceptance 3 maps to Cover configured nested step directories and a mutation that ignores the configured directory. The direct Go tests exercise the default wrapper and configured entry point.
- Omitted: none of the requested behavior, supplied wrong-implementation cases, non-secret paths or named interfaces. Conflicting: none. Superseded: none; no existing behavior is replaced.

## Tests
- Own files precede sorted non-own JavaScript files: add direct temporary-filesystem tests comparing own and files slices in order; acceptance requires them to reject sorting the full list (integration)
- Distinct step texts occur once in first-seen order: add direct analysis tests with repeated texts within and across scenarios; acceptance requires rejection of repeated occurrences and alphabetical text sorting (unit)
- Both default and configured nested directories are pinned: exercise StepAnalysis and StepAnalysisIn with real temporary directories; acceptance requires rejection of ignoring the configured directory (integration)

## Feasibility
- An existing focused test produced the real Go verbose PASS format used by the observer; go test ./verify -run '^TestExitWrapper$' -count=1 -v passed. The final-byte controls below also run actual Go test binaries rather than synthetic runner transcripts.
- evidence: {"id":"analysis-test-observer","kind":"observer","inputs":[".kogen/intents/step-analysis-order-contract/controls.json","verify/stepcheck.go","verify/stepcheck_test.go"],"observers":["features/steps/step-analysis-order-contract__steps.js"],"checks":[{"name":"good","command":"node features/steps/step-analysis-order-contract__steps.js good","exit":0,"output":"observer accepted\n"},{"name":"bad","command":"node features/steps/step-analysis-order-contract__steps.js bad","exit":1,"output":"observer rejected\n"}]}
