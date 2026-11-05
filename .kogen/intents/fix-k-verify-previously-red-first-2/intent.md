# Fix dependency cohorts, cycles and null order

Slug: fix-k-verify-previously-red-first-2
Model: not applicable — three local corrections to existing scheduling, gating and serialization code; no new state or interacting rules
Acceptance:
- .kogen/intents/fix-k-verify-previously-red-first-2/acceptance.feature
- features/steps/fix-k-verify-previously-red-first-2__steps.js
- features/steps/fix-k-verify-previously-red-first-2__observer.js
- features/steps/fix-k-verify-previously-red-first-2__driver.js

Fix three defects that an automated review found in the landed k-verify-previously-red-first change (`verify/run.go` Verify, `verify/schedule.go` schedule, `verify/pass.go` Pass.MarshalJSON). All three were reproduced on unchanged main (see Feasibility):

1. A non-empty `Input.Dependencies` turns off Go check cohort concurrency even when no dependency affects any check. Example: `Dependencies = {"vet": ["acceptance"]}` with checks `build: go build ./...` and `vet: go vet ./...` runs build and vet one after the other today.
2. `schedule` stops when no remaining item is ready (a dependency cycle) and silently drops the remaining items, so Verify never runs them and can report a green pass. Example: checks A, B (exit 3), C with `Dependencies = {"A": ["B"], "B": ["A"]}` today runs only acceptance and C and reports green.
3. `Pass.MarshalJSON` writes `"execution_order":null` when `PulledForward` is non-nil and `ExecutionOrder` is nil (a constructed pass, or a decoded record that has `pulled_forward` but no `execution_order`).

The outcome:

1. **Cohort gate.** In Verify, the Go cohort condition stops using `len(in.Dependencies) == 0`. It is gated on `effective` (priority actually changed the schedule) and, so that declared prerequisite boundaries between checks hold, on whether a declared dependency joins two checks. Concurrency is turned off exactly when `effective` is true, or when some entry `in.Dependencies[x]` contains `y` and both `x` and `y` are names of `check` items of this pass. The other conditions stay unchanged: `in.Stage == nil`, `independentGo` and `attemptFrom(ctx) == nil`. Dependencies that name setup commands, acceptance, models, maintained items or unknown names leave concurrency exactly as it is with no Dependencies.
2. **Cycle leftovers.** When no remaining item has all its prerequisites done, `schedule` appends every remaining item in its input (declared) order and returns. Items that are ready are still picked first, as now, so for the example the order is acceptance, C, A, B. Every item appears exactly once. The same rule applies to both the ordinary and the priority schedule. `pulled` is still computed over the complete order. Cycles are not rejected, validated or reported; no setting is added.
3. **Non-null execution order.** In `Pass.MarshalJSON`, when `PulledForward` is non-nil, `execution_order` is written as `nonNil(ExecutionOrder)`, so it is `[]` and never `null`. When `PulledForward` is nil, both fields stay omitted as today, so ordinary records keep their exact bytes. Decoding is unchanged.

Nothing else changes: the pass event's `execution_order` (always non-empty whenever Verify emits it), the unexported `dependencyReordered`, Complete/Valid, the priority semantics, NotRun, fail-fast, speculation/cancellation and the goldens. Every existing test stays green unchanged.

## Decisions
- Reproduce first: the regression tests and scenarios fail on current main for exactly the three reported scenarios, and pass after the fix. (source: request)
- "Gate on `effective`": the Go cohort condition no longer turns concurrency off merely because Dependencies is non-empty. It turns it off for `effective` priority scheduling, and also when a declared dependency joins two checks of the pass. This keeps the settled k-verify-previously-red-first rule that Go cohorts must not violate prerequisite boundaries: a dependent check never starts before its prerequisite check has finished. (source: request)
- "Append leftovers on a cycle": the remaining items go at the end in input order; nothing is dropped and no error is raised. (source: request)
- "Wrap the field in nonNil": only the pass record's `execution_order` when it is emitted. (source: request)
- Keep every existing test green and make no unrelated changes. (source: request)

## Source comparison
- Addressed: "`len(in.Dependencies)>0` turns off Go cohort concurrency even when nothing is reordered" / "Gate on `effective`": outcome 1, scenario "Dependencies that join no two checks keep independent Go checks concurrent". Its `cohort-control` step shows that the fixture runs concurrently today without Dependencies, and its `cohort-acceptance-dependency` step is the reproducing red.
- Addressed with a boundary: a check-to-check dependency still runs sequentially (scenario "A declared dependency between two checks keeps them sequential", unchanged behavior). The settled Intent k-verify-previously-red-first says Go cohorts must not "violate prerequisite boundaries"; reading "gate on effective" as dropping that would contradict it.
- Addressed: "`schedule` breaks on a cycle and silently drops items" / "Append leftovers on a cycle": outcome 2, scenario "A dependency cycle runs every item instead of dropping it". On main the same case reported a green pass with checks `["C=0"]`.
- Addressed: "`execution_order` can marshal as null" / "Wrap the field in nonNil": outcome 3, scenarios for a constructed pass (`PulledForward: []string{}`) and a decoded record with `"pulled_forward":["C"]` and no `execution_order`. On main both wrote `"execution_order":null`.
- Addressed: "Where: verify/run.go Verify": the gate is in Verify. The cycle and null fixes are in `verify/schedule.go` and `verify/pass.go`, which Verify uses.
- Addressed: "Keep every existing test green; no unrelated changes": Tests (existing) and the explicit unchanged list above.
- Omitted: "If the scenario does not hold on main, stop and report": all three were reproduced, so the fix proceeds.

## Tests
- Dependencies that join no two checks do not disable Go cohort concurrency: add a regression test in `verify/concurrent_test.go` using a fake `go` on PATH (as in TestSuccessfulSpeculationRetained). `build` succeeds only if `vet` starts while `build` runs. With `Dependencies {"vet": ["acceptance"]}` the pass is green with both checks; this fails on main. Also cover acceptance scenario 1. (regression)
- A dependency between two checks keeps them sequential: in the same test file, `Dependencies {"vet": ["build"]}` gives `build` red, `vet` in NotRun and no speculative result. Also cover acceptance scenario 2. (integration)
- A cycle appends leftovers in input order and drops nothing: add a case to `verify/schedule_test.go`. Items acceptance, A, B, C with `{"A": ["B"], "B": ["A"]}` schedule to acceptance, C, A, B, both without and with selected names. Also cover acceptance scenario 3 through real Verify. (regression)
- execution_order is `[]`, never null, whenever it is emitted: add a test in `verify/pass_test.go` that marshals a Pass with non-nil PulledForward and nil ExecutionOrder, and re-marshals a decoded record without `execution_order`. Also cover acceptance scenarios 4 and 5. (regression)
- Priority scheduling, round trips, NotRun, dependency-ordered completeness and goldens are unchanged: TestPrioritySchedule, TestPulledForwardComparedWithDependencyOrder, TestPriorityRunAndStage, TestPriorityRedRecordsUnexecutedTail, TestDeclaredDependenciesWithoutPriorityComplete, concurrency tests and goldens without `-update`. (existing)

## Feasibility
- Reproduction on unchanged main: a scratch probe compiled this Intent's driver into the verify test binary with `go test -c -overlay` (overlay outside the checkout) and ran every case. It observed `cohort-control` green `["build=0","vet=0"]`. `cohort-acceptance-dependency` was red: `["build=90"]`, not_run `["vet"]`. `cohort-check-dependency` was red: `["build=90"]`, not_run `["vet"]`. `cycle` was green: checks `["C=0"]`, trace `["C"]`, so A and B were dropped. `record-constructed` and `record-decoded` both gave `execution_order` `null` (present). (probe: exit 0 for every case; binary build 3.0 s)
- No external protocol, provider or library uncertainty; no documentation lookup needed.
- evidence: {"id":"observer","kind":"observer","inputs":["features/steps/fix-k-verify-previously-red-first-2__observer.js","features/steps/fix-k-verify-previously-red-first-2__driver.js"],"observers":["features/steps/fix-k-verify-previously-red-first-2__observer.js"],"checks":[{"name":"good","command":"node features/steps/fix-k-verify-previously-red-first-2__observer.js good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/fix-k-verify-previously-red-first-2__observer.js bad","exit":1,"output":"rejected\n"}]}
