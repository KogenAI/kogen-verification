# Record failure phases and refuse setup failures

Slug: k-verify-failed-readiness-setup-visible
Model: not applicable — classifies each failed scenario of one observed acceptance run and records the result in the existing readiness evidence lifecycle; no new state machine
Acceptance:
- .kogen/intents/k-verify-failed-readiness-setup-visible/acceptance.feature
- features/steps/k-verify-failed-readiness-setup-visible__readiness.js

Readiness (package `verify`, `Readiness.Check`) must record, for every failed scenario of the acceptance dry run, which phase failed (`setup`, `action`, `assertion` or `teardown`) together with its failure output, keep it in the readiness evidence `.kogen/local/readiness/<slug>.json`, and show it in the readiness observations the shaper receives. A scenario that fails in setup (a Before hook, a Background step or a Given step) is refused as a setup failure naming the scenario, the failing step or hook and its output, unless the failure is explained by the feature being missing (a function the feature will add is not there yet). Failures in the action or assertion phase remain accepted missing-feature red, as now. The failure phase is a per-scenario field, not folded into a pass/fail count.

This is the kogen-verification shelf request of 3 Nov 2026 (owner kogen-verification; verify/readiness.go and the report accounting, which lives in verify/report.go — there is no verify/acceptance.go). It replaces the current `harness failure:` refusal from `harnessFailure` in verify/report.go (which refuses every failing Context step or hook before an operation, including a missing product function called from a Given) with the phase classification and the missing-function exemption below. It does not change scenario accounting, undefined/ambiguous/pending/skipped refusals, the unexercised-step observations, the evidence identity checks, timeouts or limits.

### Phase of a failed scenario
For a scenario whose status is `failed`, take the first test step, in the order of the Cucumber Messages `testCase.testSteps`, whose result status is `FAILED`:
- a hook test step placed before the scenario's first pickle step (a Before hook): `setup`;
- a hook test step placed after a pickle step (an After hook): `teardown`;
- a pickle step whose Gherkin pickle step `type` is `Context` (Given, including Background steps and `And`/`But` after a Given): `setup`;
- a pickle step of type `Action` (When): `action`;
- a pickle step of type `Outcome` (Then) or `Unknown` (`*`): `assertion`.

A scenario whose status is not `failed` has no phase.

### Setup failures explained by the missing feature
A `setup` failure is explained by the feature being missing exactly when that FAILED result's `exception.type` is `TypeError` and the first line of its `exception.message` ends with ` is not a function` (Node's report for calling a function that does not exist yet, observed as `product.prepare is not a function`). Such a scenario is accepted like any other missing-feature red and keeps phase `setup`. Every other `setup` failure (for example `Error: ENOENT ...` from a bad fixture path, or a thrown `TypeError('broken setup helper')`) is unexplained and refuses readiness. `action`, `assertion` and `teardown` failures are always accepted. This classification is deliberately narrow; a typo calling a nonexistent fixture helper is indistinguishable from a missing product function and is accepted with phase `setup`, visible in evidence and observations.

### Refusal
When any scenario has an unexplained setup failure, `Readiness.Check` returns `intent/not_ready` (detail `the Intent is not ready to build`, exit 1), writes no evidence and leaves nothing `Readiness.Cached` can reuse. Its lines contain, in scenario order, for each unexplained setup failure the line `setup failure: <scenario name> (line <scenario line>)` followed by the lines of its failure detail (the existing step detail: `acceptance.feature line <n>: <Keyword> <text>` for a step, or `hook <name>: a hook at <uri> line <n>` for a named hook, then the failure message). After all of them come, in scenario order, one line per other failed scenario, which is accepted: `accepted <phase> failure: <scenario name> (line <scenario line>)` (for example `accepted assertion failure: First (line 2)`; an explained setup failure reads `accepted setup failure: ...`). These lines replace the `harness failure: ...` lines. Other refusal reasons keep their current precedence and text.

### Evidence
- `ScenarioResult` gains `Phase` (JSON `phase`, omitted when empty): set by the report accounting for every `failed` scenario, absent for every other status, wherever `ScenarioResult` is serialized. The existing `detail` stays the failure output (failing step or hook line, then message).
- The readiness record becomes version 5. `Readiness.Cached` reuses only version-5 records in which every `failed` scenario has a `phase` of `setup`, `action`, `assertion` or `teardown` and no other scenario has a `phase` key; version-4 records and records violating this are normal misses. A cached result carries the same phases.
- `Observations` (and so `Acknowledgment`) prints, for each failed scenario, the line `Failure phase: <phase>` directly after its `Scenario: <name> (acceptance.feature line <n>)` header and before its detail. Cached and fresh observations stay identical.
- Goldens: `accounts.json`, `passes.json` and `readiness.json` record outputs that may gain `phase` or `version` 5 are regenerated deliberately with `go test ./... -update` and reviewed; historical inputs such as `record_text` (a version-4 record that must still miss) are never rewritten. The readiness golden test supplies phases for its failed scenarios in test code.

## Decisions
- Phases are `setup`, `action`, `assertion` and `teardown`, taken from the first FAILED test step's Cucumber test-step identity (hook position) and Gherkin pickle step type, not from stack frames; `teardown` exists only so an After-hook failure is not mislabelled, and it stays accepted as today. (evidence: verify/report.go) (source: request)
- "Explained by the feature being missing" is decided deterministically as a `TypeError` whose message ends with ` is not a function`; anything else in setup is refused. This supersedes, for this case only, the earlier k-verify-harness-fault-not-ready decision to refuse every setup failure: its `broken shared fixture` hook, `broken setup helper` helper and stand-in cases stay refused. (evidence: .kogen/intents/k-verify-harness-fault-not-ready/intent.md; verify/real_test.go) (source: request)
- Action-phase failures are not setup failures and stay accepted missing-feature red. (source: request)
- A Context step failing after an executed When or Then is still `setup` (classified by step type alone); the former condition that a later Action or Outcome step must exist is dropped. (evidence: verify/report.go) (source: request)
- The refusal names the accepted failed scenarios with their phase so a mixed Intent shows which failures were refused and which accepted. (source: request)
- Evidence uses a per-scenario `phase` field next to the existing `detail` output; the record version moves to 5 so older evidence without phases cannot bypass the new gate. (evidence: verify/readiness.go; verify/readiness_golden_test.go) (source: request)
- Acceptance runs the real `Readiness.Check` with the repository's real Cucumber 13.3.0 through a Go driver embedded in the protected step file, compiled once per run with `go test -c -overlay` and started asynchronously, as README's Acceptance steps section requires; the driver uses the existing package test helpers `realProject`, `(*proj).readiness`, `(*proj).session`, `(*proj).readinessRecord`, `(*proj).write`, `(*proj).commit`, `fixtureSlug`, `Observations` and `Readiness.Cached`, which the Build keeps. (evidence: README.md; features/steps/k-verify-harness-fault-not-ready__readiness.js; features/steps/k-verify-approval-acceptance-fits-step__steps.js) (source: request)

## Source comparison
- Addressed: request Problem (setup failures hidden behind expected failures) and Need (phase and output per failed scenario, kept in evidence, refused unless explained by the missing feature, visible to the shaper, not a count): the Phase, Refusal, Evidence and Observations sections and every scenario.
- Addressed: synthetic acceptance 1 (Given throws on a bad fixture path → setup failure with step and output, not ready): scenario "A Given that throws on a bad fixture path is a setup failure", plus the Background, Before-hook and broken-helper scenarios for the other setup forms the Need lists.
- Addressed: synthetic acceptance 2 (Given passes, Then fails because the feature is missing → ready, phase "assertion"): scenario "A Then that fails because the feature is missing is accepted as an assertion failure".
- Addressed: synthetic acceptance 3 (two assertion failures, one Given failure → refused for the one, the other two named as accepted): scenario "A mixed Intent refuses the setup failure and names the accepted ones".
- Addressed: synthetic acceptance 4 (Given fails only because it calls a function the feature will add → accepted, phase recorded): scenario "A Given that calls a function the feature will add is accepted with phase setup"; its counterexample (a non-missing-function TypeError) stays refused.
- Addressed: synthetic acceptance 5 (evidence lists phase and output for each failed scenario): scenario "The evidence lists the phase and output of every failed scenario", covering setup, action and assertion and a passing scenario without a phase.
- Superseded: the `harness failure:` refusal text and the k-verify-harness-fault-not-ready rule that refused a missing product function called from setup; its acceptance (which checks names and messages, not that wording) keeps passing.
- Omitted: no requested behavior is omitted; no new settings, model or provider classification, timeouts or limits.

## Tests
- Each failed scenario gets the phase of its first FAILED test step (Before hook and Context/Background steps setup, Action action, Outcome and Unknown assertion, After hook teardown) and non-failed scenarios get none: report accounting tests over Cucumber Messages reports in verify (unit)
- An unexplained setup failure (bad fixture path, Background step, Before hook, thrown non-missing-function TypeError) refuses readiness with `setup failure:` lines, the failing step or hook, its output, and no evidence: acceptance scenarios plus an updated TestRealReadinessRefusesHarnessFailures (integration)
- A setup failure whose TypeError ends with ` is not a function` is accepted with phase setup: acceptance scenario plus a real-Cucumber readiness test (integration)
- A mixed refusal names each accepted failed scenario with `accepted <phase> failure:` lines after the setup failures: acceptance scenario (scenario)
- Evidence version 5 records `phase` for failed scenarios; Cached rejects version 4, a failed scenario without a valid phase and a phase on a non-failed scenario, and returns the recorded phases: Readiness.Cached regression tests and the regenerated readiness golden (regression)
- Observations print `Failure phase: <phase>` after each failed scenario header, identical from cache: update the real observation tests (integration)
- Action and assertion red, assertion-helper red, undefined/ambiguous/pending/skipped refusals, unexercised steps and evidence identity are unchanged: existing readiness, report and harness tests with go build, go vet, go test and the format check (existing)

## Feasibility
- Real Cucumber 13.3.0 reports a Given calling a missing function as `exception.type` `TypeError`, `exception.message` `product.prepare is not a function`, and a bad fixture path as type `Error`, message `ENOENT: no such file or directory, open 'fixtures/missing.json'`; Given and Background steps have pickle type `Context`, Then `Outcome`, and a named Before hook reports `sourceReference.uri` `features/steps/...` relative to the run directory. (scratch probe outside the repository: exit 0)
- The embedded driver compiled with `go test -c -overlay ./verify` in about 3 s on this checkout and, on the unchanged tree, produced `harness failure: First (line 2)` / `hook shared fixture: a hook at features/steps/fixture_steps.js line 2` / `Error: fixture service down` for the hook fixture, and refused the mixed fixture with the ENOENT and `TypeError: product.prepare is not a function` details; this confirms the fixtures reach the intended steps and that the current code refuses the explained case. (focused driver runs: exit 0)
- evidence: {"id":"setup-phase-observer","kind":"observer","inputs":["features/steps/k-verify-failed-readiness-setup-visible__readiness.js"],"observers":["features/steps/k-verify-failed-readiness-setup-visible__readiness.js"],"checks":[{"name":"good","command":"node features/steps/k-verify-failed-readiness-setup-visible__readiness.js good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/k-verify-failed-readiness-setup-visible__readiness.js bad","exit":1,"output":"rejected\n"}]}
