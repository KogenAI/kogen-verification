# Check each declared invariant separately

Slug: k-verify-model-invariants-separate-runs
Model: not applicable — deterministic declaration validation and process fan-out have no meaningful persistent state
Acceptance:
- .kogen/intents/k-verify-model-invariants-separate-runs/acceptance.feature
- features/steps/invariant_steps.js
- features/steps/invariant_observer.cjs
- features/steps/invariant_control.cjs
- features/steps/invariantdriver/main.go

Pin CheckModel's process boundary: validate all declarations before starting any checker process, then check distinct names separately in first-declaration order. Preserve typecheck, optional model tests, bounds and seed, and existing behavior without invariant declarations. Replace duplicate execution and acceptance of malformed declaration strings; do not change Intent's comma-separated metadata syntax. The malformed case is a single ModelSpec.Invariants element containing a comma, not normal metadata separators.

## Decisions
- Each run receives exactly one unchanged invariant name; never combine names with commas, `and` or another expression joiner. Deduplicate exact strings preserving first occurrence. (source: request)
- Refuse a declaration containing comma or any whitespace before typecheck or any other checker process. Return a failed model with one single-line problem naming that declaration. Validate the complete list before scheduling processes. (source: request)
- A violation fails the model with a problem naming only the violated invariant, while other invariant runs continue independently. Preserve successful runs and diagnostics. (source: request)

## Source comparison
- Addressed: request Problem and Need: CheckModel already iterates declarations in verify/model.go, but lacks malformed-name rejection and deduplication. This contract pins existing separation and continuation and adds those missing rules.
- Addressed: synthetic cases 1–5 are executable scenarios for A/B/C ordered argv, B-only violation, single-string A,B rejection, duplicate suppression and no-invariant control. Whitespace rejection from Need is also executable.
- Addressed: request literals slug k-verify-model-invariants-separate-runs, Intent paths, features/steps location, names A/B/C, and comma versus expression joiners are retained here and in acceptance. No requested behavior is omitted or superseded. No unrelated verification or metadata parser redesign is authorized.

## Tests
- Exact separate argv in declaration order: synthetic CheckModel driver with recorded child argv (integration)
- Violation of B alone while A and C pass: B-only failing checker with exact calls and problem (regression)
- Comma or whitespace declarations refused before any process: malformed declaration scenarios; add focused CheckModel validation tests (regression)
- Duplicates run once in first-occurrence order: repeated B scenario; add focused CheckModel test (regression)
- No declarations preserve typecheck and successful result without invariant runs: empty-list synthetic control (integration)

## Feasibility
- Scratch visibility inquiry found retained proposals are not present in probe copies (exit 2); it supplies no capability evidence.
- evidence: {"id":"invariant-observer","kind":"observer","inputs":["features/steps/invariantdriver/main.go","features/steps/invariant_control.cjs"],"observers":["features/steps/invariant_observer.cjs"],"checks":[{"name":"good","command":"node features/steps/invariant_control.cjs good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/invariant_control.cjs bad","exit":1,"output":"rejected\n"}]}
