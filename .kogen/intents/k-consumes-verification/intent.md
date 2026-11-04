# Specify consumed Kogen dependency contracts

Slug: k-consumes-verification
Model: not applicable — tests of existing contracts add no product state
Acceptance:
- .kogen/intents/k-consumes-verification/acceptance.feature
- features/steps/k-consumes-verification__commands.js

Keep contract/ and add external-package Go tests in consumes/kogen-coordinator/ and consumes/kogen-loop/. These executable two-sided contracts specify exactly what verification consumes at its current pins, not all producer capabilities. Preserve useful existing tests. No production behavior changes, new commands, flags or options. Leave go.mod and go.sum unchanged.

Add consumes/README.md mapping every non-test dependency use (source location, imported identifier and exported fields/methods, relied-on behavior/format) to concrete assertions. Explain the completeness audit: inspect all non-test imports and follow aliases and receiver/member accesses, not merely qualified identifier searches. Compile-only references do not establish behavioral coverage. Use public producer APIs directly, not verification wrappers or private helpers. Use only deterministic synthetic fixtures and temporary directories; no network, host paths or consumer checkouts. Match contract/ style and isolation. Bound and clean up process fixtures; isolate Git configuration and identity.

Initial observed identifier inventory to complete with receiver/member tracing:

Coordinator/project: Baseline, CheckIntent, Config, EncodeJSON, FeaturePath, Hash, Intent, ModelSpec, ParseGherkin, Scenario, WritePackageFacts.

Coordinator/git: Materialized, New, Repo.

Loop/sys: AsError, ErrTimeoutObservation, Error, Fail, Interrupted, NewWith, Options, Result, Session, Terminate, TmpPath.

Trace verify/attempt.go, concurrent.go, env.go, feasibility.go, hung.go, model.go, pass.go, probe.go, readiness.go, report.go, run.go, stepcheck.go, sweep.go and text.go. Assert consumed command environment/cwd, results/errors/timeout/interruption/cleanup; project configuration/intent/model/scenario shapes, Gherkin parsing, baseline/hash/package facts and JSON formats; Git candidate identity, materialization and cleanup. Consult pinned module source for precise interfaces. Assert only aspects actually used.

## Decisions
- Interpret `consumes/kogen-coordinator kogen-loop/` as two directories, consumes/kogen-coordinator/ and consumes/kogen-loop/. (source: request)
- Keep contract/ and run both new suites through ordinary go test ./... at current pins. (source: request)
- Human evaluation is required for the semantic completeness and exclusivity of the source-to-assertion map, public-API-only use, absence of private helpers, deterministic isolation and absence of network/host-path reliance: passing tests or a README sentence cannot establish those properties. Review the actual tests and production use sites, not just the inventory. (source: request)
- Human evaluation is required for unchanged product behavior and absence of new commands, flags or options; inspect the implementation delta and retain existing regression tests. Automated acceptance does not claim to prove general semantic equivalence. (source: request)

## Source comparison
- Addressed: request's two-sided suites, exact producer names and retained contract/ map to the directories, audit and acceptance above.
- Addressed: all non-test uses and nothing unused, exported-only APIs and deterministic isolation map to direct API assertions and explicit human evaluation above. The observed inventory is not claimed exhaustive.
- Addressed: normal go test ./..., unchanged module pins and no product/CLI change map to offline execution, module byte checks and semantic review.
- Addressed: retry at 2026-11-04T00:15:57Z reported no candidate/intent/shape line in ~/logs/k-consumes-verification.log on kogen-linux-macbook. Deliver this actual package through native shaping; do not fabricate or manipulate host logs or add logging behavior.
- Omitted: no requested behavior; no producer-wide API tests or new blanket-check tooling.

## Tests
- Coordinator consumed contracts: add direct exported API assertions under consumes/kogen-coordinator with audited source map (integration)
- Loop consumed contracts: add direct exported API assertions under consumes/kogen-loop with audited source map (integration)
- Normal discovery and execution: acceptance runs both new suites and configured go test ./... discovers them (integration)
- Existing provided contracts remain usable: acceptance runs existing contract tests offline (existing)
- Module files remain unchanged: acceptance checks recorded SHA-256 values (regression)
- Product behavior remains unchanged: existing configured checks and regression tests plus semantic delta review (existing)

## Feasibility
- Offline existing contract tests passed in scratch via GOPROXY=off GOSUMDB=off go test -count=1 ./contract, exit 0. SHA-256 values were observed for go.mod and go.sum. A source scan produced the initial inventory. A git-diff probe failed because scratch has no Git metadata; acceptance does not depend on history.
