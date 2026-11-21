# Pin the cohort end-of-command progress line

Slug: verify-elapsed-line-parallel-cohort
Model: not applicable — the behavior is one progress line per finished cohort member and has no state
Acceptance:
- .kogen/intents/verify-elapsed-line-parallel-cohort/acceptance.feature
- features/steps/verify-elapsed-line-parallel-cohort__steps.js

The request asks that each member of a cohort of checks that run together print, when it has run and ended, one progress line built by the existing `endLine` helper from the member's name, status and the wall time of its own command_result event: `kogen: vet passed (1 s)` for a vet member that took 1165 ms and `kogen: build failed, exit 2 (3 s)` for a failing member, in the order members finish; a member cancelled because another member failed (status -1) and a member that never started write no line. The checkout at HEAD already does this: `runCohortCheck` in verify/concurrent.go calls `parent.Progress(endLine(it.name, o.res.Status, wallMS))` under `progressMu` for a started, not cancelled member, using the same `wallMS` it logs in command_result, and the existing tests `TestCohortMembersWriteEndedLines` and `TestCohortCancelledMemberWritesNoLine` in verify/concurrent_test.go cover both required scenarios. So this Intent changes no production code and no test. It only adds acceptance that observes the requested behavior through those two existing tests, so the behavior stays pinned. run.go, the helper, documentation, goldens and every other file stay as they are, and no configuration, flag or setting is added.

Required values, as the request states them. A cohort of two independent checks, one with the command true and one with the command exit 3, writes exactly two progress lines, one for each member, each equal to what the helper returns for that member's name, status and its own wall_ms, so `kogen: ca passed (` and `kogen: cb failed, exit 3 (` each followed by seconds. A cohort where the first member fails at once with exit 3 and the second is still running and is cancelled writes exactly one line, beginning `kogen: first failed, exit 3 (`, and no line naming the second member.

## Decisions
- The requested behavior (one end line per started cohort member from the `endLine` helper, using that member's own wall time, in finish order, no line for a cancelled member with status -1 or for a member that never started) is already implemented at HEAD, so this Intent edits no file of the project. (decision: D1, round 1) (evidence: verify/concurrent.go; verify/concurrent_test.go; verify/run.go) (assumption: the user confirms that the commit already delivering this behavior satisfies the request, and that no further change is wanted) (source: request)
- Acceptance runs only the two existing named tests, TestCohortMembersWriteEndedLines and TestCohortCancelledMemberWritesNoLine, with `go test ./verify -run` and requires each to report PASS; no new Go test is written because the existing ones already check one line per member equal to the helper's text for that member's own command_result wall_ms, and the cancelled member's absence from the lines. (decision: D2, round 1) (evidence: verify/concurrent_test.go) (source: request)
- Because the behavior exists, the acceptance scenarios are not red on the unchanged tree; that is the honest result of a request that is already delivered, not a broken fixture. (decision: D3, round 1) (evidence: verify/concurrent.go) (assumption: the user accepts a regression-only Intent with passing acceptance instead of withdrawing the request) (source: request)

## Source comparison
- Addressed (already present at HEAD): one progress line per started cohort member, text from `endLine`, seconds from the member's own wall time, observed through TestCohortMembersWriteEndedLines.
- Addressed (already present at HEAD): no line for a cohort member cancelled because another failed, observed through TestCohortCancelledMemberWritesNoLine; a member that never started is also covered by the existing TestCohortRefusedMemberWritesNoLine.
- Omitted by request: run.go and the helper, Pass.Summary, goldens, documentation and any new configuration.

## Tests
- Each member of the build and vet style cohort writes exactly one line equal to the helper's text for its own name, status and wall time: the existing TestCohortMembersWriteEndedLines in verify/concurrent_test.go (existing)
- A cohort member cancelled because another member failed writes no line: the existing TestCohortCancelledMemberWritesNoLine in verify/concurrent_test.go (existing)

## Feasibility
- none
