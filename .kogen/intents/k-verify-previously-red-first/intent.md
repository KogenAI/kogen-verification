# Run previously red verification items first

Slug: k-verify-previously-red-first
Model: .kogen/intents/k-verify-previously-red-first/model.qnt invariants=Complete,Prerequisite seed=17 samples=100 steps=20
Acceptance:
- .kogen/intents/k-verify-previously-red-first/acceptance.feature
- features/steps/k-verify-previously-red-first__steps.js
- features/steps/k-verify-previously-red-first__driver.js

Allow a caller to prioritize the previous pass's failures within the same run, reducing repeated red-pass wall time without caching or skipping green evidence. This replaces only the fixed scheduling of a verification pass when known previous-red names are supplied; no repair-loop owner or other repository is changed. Run still fixes once and Verify still materializes and checks one exact candidate. Preserve mutation checks, baseline guards, cancellation, evidence, coverage, fail-fast behavior and complete-pass requirements.

## Decisions
- Accept an optional previous-red item-name list; prioritize those names in their ordinary relative order, not list order, then run all remaining work in ordinary relative order, subject to prerequisites. Unknown names are ignored. A green result requires every item green on the same clean candidate. (source: request)
- Record actual execution order and which work was pulled forward. Without a list, or with only unknown names, execution and serialized records remain byte-identical to existing behavior. (source: request)
- Preserve setup prerequisites, models before checks and declared dependencies even for priority work. (source: request)

## Interface and scheduling
- Add `PreviousRed []string` to `verify.Input`, used by both Verify and Run (including stage gates). It is explicit per-pass input; do not retain cross-run history or infer it globally. Names are the existing exact item names: setup-N, acceptance, model, maintained model/feature paths, configured check names and stage-<id>-N. Do not rename existing items.
- Add `Dependencies map[string][]string` to Input for caller-declared prerequisite names. It augments built-in prerequisites without requiring edits to coordinator's project.Check type (currently Name and Run only). The supported graph consists of existing names and is acyclic; do not add settings or new validation policy for malformed graphs in this feature.
- Use the actual ordinary order in verify/run.go: setup commands, acceptance, applicable Intent model, maintained models, maintained features, configured checks; stage gates contain setup then stage checks. The request's parenthetical models/acceptance/checks describes fixed ordering generally, not a requirement to change today's default sequence.
- All setup commands retain their sequence and precede dependent verification work. Applicable Intent and maintained models precede checks. A selected item is scheduled at the earliest position allowed by its prerequisite closure; execute required prerequisites first in ordinary relative order. Preserve ordinary relative order within selected work and within the remaining work except where dependencies require otherwise. Remove duplicates; never execute an item twice. Do not add an acceptance-before-check dependency: with no models or setup, C may run before acceptance. Do not let Go check cohorts start A/B speculatively ahead of priority C or violate prerequisite boundaries. Preserve existing concurrency when no priority applies.
- Add `ExecutionOrder []string` and `PulledForward []string` to Pass, serialized as `execution_order` and `pulled_forward`. Emit both only when known priority input actually changes the schedule, otherwise omit both to preserve old JSON bytes. ExecutionOrder records the actual started item sequence (not an unexecuted planned tail); PulledForward lists selected items moved earlier by the plan, in scheduled order, not unrelated prerequisites or unknown names. Retain these fields on JSON round trips. Keep existing result collections truthful and associated with their correct item even when maintained items reorder. For checks the result order follows execution as the scenarios require; update Complete/Valid as needed so all-green reordered results are complete evidence, never accepting missing, repeated or failed items. Legacy evidence remains supported.
- Record the same scheduling information in pass events when effective, without changing ordinary events. NotRun remains truthful for the unexecuted tail. Reordering is not result reuse; all applicable items must run again after repair. This library takes the optional list; wiring an external Kogen repair owner is outside this repository/request's pass-level API scope.

## Source comparison
- Addressed: request Problem/Need via optional Input.PreviousRed and prerequisite-aware scheduling above; fixed default behavior is retained. Ordinary ordering is grounded in verify/run.go rather than replacing its acceptance-before-model order with the problem's shorthand.
- Addressed: synthetic cases 1 and 6 via acceptance's still-red C trace, execution record and measured comparison against the unprioritized control (A sleeps 0.2s, B 1s, C 0.05s). Wall includes normal pass overhead; the guarantee is removal of A+B execution cost, not zero Git/process overhead.
- Addressed: synthetic cases 2 and 3 via repaired-C all-green and B-red candidates; Complete must agree with the full result. Case 4 uses declared C -> setup-1 plus built-in setup ordering. Case 5 compares serialized pass bytes for identical candidates and inputs with no priority versus absent/unknown priority.
- Addressed: requested general mechanism, stable relative order, models and declared prerequisites by Interface and scheduling and focused implementation tests below; no scope is superseded by synthetic examples.
- Addressed: requested slug, paths, uniquely prefixed bindings and step filenames by Acceptance. README checks and testing rules remain in force. No protected implementation edit was identified: required production changes are in verify/run.go, verify/pass.go and related unprotected verification code/tests; acceptance uses an independent overlay harness, not a production test name the builder must invent.
- Omitted deliberately: external repair-owner integration and persistent failure history, neither requested as part of this component's optional pass input. No unrelated historical provider/Studio work is authorized.

## Tests
- Stable priority partition with absent, unknown and known names: add focused callable scheduling tests including multiple selected names supplied in reverse order (unit)
- Setup, model and declared prerequisite closure constrain priority without duplicate execution: add focused scheduling tests for dependency chains and setup order (unit)
- Still-red C avoids A and B and records C as pulled forward: acceptance overlay invokes real Verify on local Git/synthetic Cucumber fixtures with actual stub processes (regression)
- Repairing C reruns all required work and permits green only with complete clean evidence: repaired-C acceptance and Pass Complete/Valid reordered-result tests (integration)
- Green C followed by red B remains red and records both outcomes: B-red acceptance (regression)
- Declared setup prerequisite executes before C: setup acceptance (integration)
- No list and unknown names preserve byte-identical records: control pass comparisons in acceptance plus existing pass goldens unchanged (regression)
- Actual executed order and pulled-forward metadata survive serialization without disturbing legacy passes: add round-trip tests for effective and ineffective priority, red and green; assert truthful NotRun and maintained item identity (unit)
- Still-red pass removes A+B wall rather than merely relabeling the record: measured real stub route comparison in acceptance (integration)
- Run and stage entry points pass optional scheduling inputs through without losing fix/baseline behavior: add local integration tests, retaining existing verification/concurrency/coverage tests (integration)

## Feasibility
- Local dependency inspection observed project.Check has only Name and Run, and sys.NewWith supports the existing fixture session approach (probe: exit 0). No external protocol/provider uncertainty requires documentation research.
- Quint model typechecked successfully with the configured Kogen Quint tool (probe: exit 0, 1.1 s). An earlier absolute-path probe was refused; a scratch lookup for privately retained proposals found no files, not observer evidence. The controls below run against the final submitted observer bytes.
- evidence: {"id":"observer","kind":"observer","inputs":["features/steps/k-verify-previously-red-first__steps.js","features/steps/k-verify-previously-red-first__driver.js"],"observers":["features/steps/k-verify-previously-red-first__steps.js"],"checks":[{"name":"good","command":"node features/steps/k-verify-previously-red-first__steps.js good","exit":0,"output":"observer accepted\n"},{"name":"bad","command":"node features/steps/k-verify-previously-red-first__steps.js bad","exit":1,"output":"observer rejected\n"}]}
