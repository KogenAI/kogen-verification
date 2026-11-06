# Keep dependency-ordered passes complete on reload

Slug: fix-k-verify-previously-red-first
Model: not applicable — one boolean added to an existing record's serialization; no new state or interacting rules
Acceptance:
- .kogen/intents/fix-k-verify-previously-red-first/acceptance.feature
- features/steps/fix-k-verify-previously-red-first__steps.js
- features/steps/fix-k-verify-previously-red-first__observer.js
- features/steps/fix-k-verify-previously-red-first__driver.js

Fix a defect that an automated review found in the landed k-verify-previously-red-first change (`verify/pass.go`, `Pass.UnmarshalJSON`). The unexported `Pass.dependencyReordered` flag is set by Verify (`verify/run.go`) whenever `Input.Dependencies` is non-empty. When no previously red item changes the schedule, `ExecutionOrder` stays empty and `PulledForward` stays nil. The record then has neither field and does not carry the flag. After `json.Unmarshal`, the flag is false. `Pass.Complete` then takes the strict configuration-order branch and rejects valid green evidence whose checks ran in dependency order.

The defect was reproduced on unchanged main (see Feasibility). Checks `A: printf … A`, `B: printf … B` with `Dependencies = {"A": ["B"]}` run B then A. The pass is green and `Complete` is true in memory. After `json.Marshal` then `json.Unmarshal`, `Complete` is false.

The outcome (persist the flag):

1. `Pass.MarshalJSON` writes `"dependency_reordered":true` when the flag is true and omits the key when it is false. Records of passes without Dependencies therefore keep their exact bytes, and so do records whose order changed only through previously red items.
2. `Pass.UnmarshalJSON` sets the unexported flag from that key: `true` sets it, and an absent key leaves it false. Re-marshalling a decoded record gives the same bytes.
3. `Pass.Complete` is unchanged. A reloaded dependency-ordered pass is judged exactly as the in-memory pass is. A record without the key, which includes every record written before this fix, still needs its checks in configuration order when it has no `execution_order`. So a pass whose checks were swapped without declared dependencies is still rejected after reload.

Nothing else changes: Verify, the schedule, the pass event, `ExecutionOrder`/`PulledForward` serialization, Valid, Legacy handling and the goldens. Every existing test stays green unchanged.

## Decisions
- Reproduce first: the regression test and the first scenario fail on current main for exactly the reported scenario (a pass reordered only by Dependencies, recorded and reloaded), and pass after the fix. The scenario held on main, so the fix proceeds. (source: request)
- "Persist the flag, or derive it from the order": the flag is persisted as the optional pass-record key `dependency_reordered` (written only when true). It is not derived from the recorded order, because a decoded record has no configuration to compare against. Accepting any order without the flag would also drop the strict order check for ordinary passes. (source: request)
- "Test the round trip": the round trip is tested by marshal, unmarshal, `Complete` and byte-identical re-marshal. (source: request)
- Keep every existing test green and make no unrelated changes. (source: request)
- Persist the dependency-reordered flag as the optional pass-record key "dependency_reordered":true. Write it only when the flag is set, and restore it in Pass.UnmarshalJSON. Pass.Complete is unchanged. (decision: D1, round 1) (constraint: Records without the key keep strict configuration-order completeness when they have no execution_order) (constraint: A re-marshalled decoded record is byte-identical) (constraint: No change to Verify, schedule, the pass event, goldens or ExecutionOrder/PulledForward serialization) (evidence: verify/pass.go; verify/run.go; verify/schedule.go; contract/contract_test.go; verify/priority_integration_test.go) (assumption: The reproduction on main came from a scratch probe in an external session, not a Kogen-recorded probe; readiness will observe the missing-feature red directly. Records written before the fix lack the key, so a dependency-reordered one stays rejected (fail-closed) and that pass is rerun.) (source: request)
- Acceptance builds the verify test binary once per run with a go build overlay that adds an acceptance-only driver. The driver runs real Verify passes, records and reloads them. A separate observer has known-good and known-bad controls declared in Feasibility. (decision: D2, round 1) (evidence: features/steps/fix-k-verify-previously-red-first-2__steps.js; features/steps/fix-k-verify-previously-red-first-2__driver.js; features/steps/fix-k-verify-previously-red-first-2__observer.js; README.md) (assumption: Readiness runs the observer controls (good exit 0 "accepted", bad exit 1 "rejected"). In this external session they were only observed on a scratch copy.) (source: request)

## Source comparison
- Addressed: "The unexported `dependencyReordered` is lost on reload. A pass reordered only by Dependencies then takes the strict config-order branch in `Complete` and rejects valid green evidence" / "Where: verify/pass.go UnmarshalJSON". Outcomes 1 and 2 cover it, and scenario "A pass reordered only by declared dependencies stays complete after reload" checks it. On main that case reported `reloaded_complete: false` and no `dependency_reordered` key.
- Addressed: "First reproduce it: add a test that fails on current main for exactly this scenario": the regression test in Tests and scenario 1. Both were observed red on main through the same driver.
- Omitted: "If the scenario does not hold on main, stop and report": the scenario held, so the fix proceeds.
- Addressed: "Persist the flag, or derive it from the order": persisted (Decisions).
- Addressed: "Test the round trip": scenario 1 checks `reloaded_complete` and `rerecorded_identical`, and so does the regression test.
- Addressed: "Keep every existing test green; no unrelated changes": scenario "A pass without dependencies still needs configuration order after reload" checks this (it passes on main and must keep passing). So do the existing tests listed in Tests.

## Tests
- A pass reordered only by declared dependencies stays complete after a JSON round trip: extend `TestDeclaredDependenciesWithoutPriorityComplete` in `verify/priority_integration_test.go`. Marshal the Verify pass, check that the record has `"dependency_reordered":true`, unmarshal it and require `Complete` to be true, and require the re-marshalled bytes to equal the record. This fails on main. Acceptance scenario 1 covers it too. (regression)
- The key is written only when the flag is set, and decoding restores it: add a test in `verify/pass_test.go`. A record containing `"dependency_reordered":true` decodes and re-marshals to identical bytes. A pass without the flag marshals without the key. (unit)
- A record without the key still needs configuration order: `TestBuildCompleteEvidence` "reversed" (contract), `TestPassWireRecords` exact ordinary bytes, and acceptance scenario 2. (existing)
- Priority metadata round trips, completeness and goldens are unchanged: `TestPriorityRunAndStage`, `TestExecutionOrderNeverNullWhenEmitted`, `TestPulledForwardComparedWithDependencyOrder` and the goldens without `-update`. (existing)

## Feasibility
- Reproduction on unchanged main: a scratch probe compiled this Intent's driver into the verify test binary with `go test -c -overlay` (overlay outside the checkout) and ran both cases. `dependency-ordered` gave `{"green":true,"trace":["B","A"],"checks":["B=0","A=0"],"complete":true,"record_dependency_reordered":"absent","reloaded_complete":false,"rerecorded_identical":true,"swapped_reloaded_complete":true}`. `config-ordered` gave `{"green":true,"trace":["A","B"],"checks":["A=0","B=0"],"complete":true,"record_dependency_reordered":"absent","reloaded_complete":true,"rerecorded_identical":true,"swapped_reloaded_complete":false}`. (probe: exit 0 for both cases; binary build under 1 s with a warm cache)
- No external protocol, provider or library uncertainty; no documentation lookup needed.
- evidence: {"id":"observer","kind":"observer","inputs":["features/steps/fix-k-verify-previously-red-first__observer.js","features/steps/fix-k-verify-previously-red-first__driver.js"],"observers":["features/steps/fix-k-verify-previously-red-first__observer.js"],"checks":[{"name":"good","command":"node features/steps/fix-k-verify-previously-red-first__observer.js good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/fix-k-verify-previously-red-first__observer.js bad","exit":1,"output":"rejected\n"}]}
