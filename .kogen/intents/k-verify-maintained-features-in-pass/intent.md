# Verify maintained features in each pass

Slug: k-verify-maintained-features-in-pass
Model: not applicable — wiring maintained specifications into the existing pass lifecycle adds no independent state machine
Acceptance:
- .kogen/intents/k-verify-maintained-features-in-pass/acceptance.feature
- features/steps/maintained_features_steps.js
- features/steps/maintained_features_observer.cjs
- features/steps/testdata/maintainedfeatures/driver.go

Add explicitly supplied maintained feature paths to ordinary clean-candidate verification. Do not discover features or replay historical Intents. Preserve existing behavior and exact serialized/text outputs when the supplied list is absent or empty.

## Decisions
- Each explicitly listed maintained feature runs as its own item on the clean candidate, after maintained models and before configured checks, in supplied order. Existing setup, Intent acceptance and Intent model ordering remains unchanged. Stop at the first definitive failure and name later items in NotRun, as with existing items; the supplied green-then-red example runs both. Scoped stage gates remain scoped and exclude these whole-Intent items. (source: request)
- Failures and unrunnable paths fail the pass and appear under the feature path in feedback, including failing scenario details when available. Checkout movement invalidates green evidence. (source: request)

Technical contract: add `Input.MaintainedFeatures []string`. Use the configured acceptance command with KOGEN_ACCEPTANCE_FEATURES set to exactly the supplied repository-relative path and a separate report per item; parse that candidate feature and account for every expected scenario exactly once using the existing Cucumber Messages accounting semantics. Missing/unreadable/invalid feature or unrunnable command/report is failed item evidence, not a skip or fatal loss of the pass record (ordinary cancellation and infrastructure stops retain their existing semantics). Do not reinterpret supplied paths as Intent slugs. Add Pass.MaintainedFeatures with ordered path/result entries, serialized as `maintained_features,omitempty`; result is an Acceptance object, or `"not_run"` for an item prevented from running. Preserve round-trip records including failed detail. Include failing feature paths in Failing and Feedback. No maintained features means the field is absent and previous JSON and feedback bytes remain unchanged. Document this ordering in the public Verify/Input documentation. Reuse existing mutation and baseline guards rather than adding a parallel lifecycle.

The protected acceptance harness copies its Go driver into a temporary checkout to invoke real Verify using existing synthetic Git/report helpers. That test exists in the submitted driver, not a test the builder must invent. Keep feature report URIs tied to the supplied paths. The observer compares JSON values semantically; array order remains meaningful.

## Source comparison
- Addressed: request Problem/Need, maintained feature drift, explicit paths and normal-pass integration: technical contract and ordered scheduling above; acceptance covers green/red records, failure feedback, and model/check positioning.
- Addressed: synthetic cases 1–4: green/red, missing path, and unlisted feature trace scenarios. Historical Intent acceptance remains the existing active Intent gate only; no historical replay or discovery is added.
- Addressed: synthetic cases 5–6: empty-list byte equality against the same control input, and checkout movement on spec/green.feature after its successful run.
- Omitted: no requested behavior omitted. No external provider or protocol change is needed. Existing maintained-model fail-fast scheduling is preserved, not replaced by all-items execution.

## Tests
- Explicit ordered maintained paths execute on the candidate and record green/red results while ignoring unlisted features: synthetic Verify driver with model/runner/check traces (integration)
- Failed and missing features fail the pass with path and scenario detail and stop later checks: red and missing driver cases (regression)
- Empty maintained features preserve record and feedback bytes: same-project control comparison (regression)
- Feature checkout mutation invalidates otherwise green evidence: post-feature check mutates original checkout (integration)
- Maintained feature records round trip and scoped stages omit whole-pass features: add focused Pass serialization and existing stage integration coverage (integration)

## Feasibility
- evidence: {"id":"feature-observer","kind":"observer","inputs":["features/steps/maintained_features_observer.cjs"],"observers":["features/steps/maintained_features_observer.cjs"],"checks":[{"name":"good","command":"node features/steps/maintained_features_observer.cjs good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/maintained_features_observer.cjs bad","exit":1,"output":"rejected\n"}]}
