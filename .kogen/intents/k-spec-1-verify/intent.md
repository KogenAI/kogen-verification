# Verify maintained models alongside the Intent

Slug: k-spec-1-verify
Model: not applicable — this is wiring existing model verification into the same stateless verification pass
Acceptance:
- .kogen/intents/k-spec-1-verify/acceptance.feature
- features/steps/maintained_steps.js
- features/steps/maintained_observer.js
- features/steps/testdata/maintained/driver.go

Add only explicit maintained-model input and execution in kogen-verification. Current verify.Input accepts only the current Intent's model; verification also checks supplied maintained specifications.

Add exported Input.MaintainedModels []project.ModelSpec. Each entry carries Path, Invariants, Seed, Samples and Steps using the existing ModelSpec formats. Nil and empty lists preserve today's outputs byte for byte, including serialized Pass, progress, logs, feedback and goldens. Do not introduce empty output fields into legacy records. The Intent's own model and its existing result remain intact.

For a whole verification pass, execute acceptance, the Intent model if applicable, maintained models in supplied order, then Config.Checks. Each maintained model uses CheckModel semantics: typecheck, tests when detected, and each recorded invariant using its seed, samples, steps and TypeScript backend. Preserve existing first-red scheduling between items, list later items as not run, and retain diagnostic evidence. A maintained failure makes Green false and yields a Failing cause and feedback naming its supplied path, not merely model.qnt or model. Keep per-model outcomes distinguishable in new evidence when maintained models are present. Stage gates remain scoped: no acceptance or models, including maintained models.

No disk discovery, promotion (K-SPEC-1-BUILD), CLI commands or flags, project.yaml keys, timeout increase, live providers or real model execution is requested. Use synthetic local tools and existing fixture conventions. The protected Go acceptance driver is copied into a disposable source tree to call Verify with existing synthetic project/report helpers; it does not implement the feature.

## Decisions
- Accept supplied maintained models with their recorded parameters; do not discover or promote them. (source: request)
- Preserve no-maintained-model behavior byte for byte and keep current Intent model verification. (source: request)
- Synthetic tests only; no new CLI/configuration or raised timeout. (source: request)

## Source comparison
- Addressed: request Problem/Need maps to Input.MaintainedModels and whole-pass scheduling above and all acceptance scenarios; each supplied model runs alongside the Intent model with exact parameters.
- Addressed: request failing-model cause maps to path-bearing Failing and feedback and typecheck/invariant failure scenarios.
- Addressed: request empty-list compatibility maps to empty acceptance and unchanged existing golden/verification tests; no legacy record drift is authorized.
- Addressed: request Constraints maps to explicit exclusions above; K-SPEC-1-BUILD remains separate, and the parent path, split identifier and producer-first ruling are retained as context, not permission to implement discovery or promotion.
- Omitted: no requested behavior. No conflicting or superseded source requirements identified.

## Tests
- Supplied maintained models run after the Intent model with recorded invariants and bounds: synthetic Verify acceptance driver with two maintained entries (integration)
- Maintained typecheck failure prevents green and names that path: broken.qnt acceptance case (integration)
- Maintained invariant failure prevents green and names that path: violated.qnt acceptance case (integration)
- Empty maintained list preserves ordinary verification: empty case and existing pass/golden tests unchanged (regression)
- Scoped stages exclude models and earlier failures stop later work: extend existing stage and first-red verification tests for supplied maintained entries (integration)

## Feasibility
- Initial scratch probe did not include proposed files and failed with missing-file diagnostics; it establishes no capability or observer result.
- evidence: {"id":"maintained-observer","kind":"observer","inputs":["features/steps/maintained_observer.js"],"observers":["features/steps/maintained_observer.js"],"checks":[{"name":"good","command":"node features/steps/maintained_observer.js good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/maintained_observer.js bad","exit":1,"output":"rejected\n"}]}
