# Show exit status in failed pass progress lines

Slug: verify-failed-pass-line-shows-exit-status
Model: not applicable — Pass.Summary is a pure function of the Pass value; there is no state or interacting rule to model.
Acceptance:
- .kogen/intents/verify-failed-pass-line-shows-exit-status/acceptance.feature
- features/steps/verify-failed-pass-line-shows-exit-status__steps.js

The progress line of a failed verification pass names the failing project check but not how it failed (`kogen: pass 1: test failed`). In `Pass.Summary` (verify/pass.go), a failing item that is a project check recorded in `p.Checks` with a non-zero `Status` is written `<name> (exit <status>)`, so the line reads `kogen: pass 1: test (exit 1) failed`. Several failing checks keep the order of `p.Failing`: `kogen: pass 2: lint (exit 2), test (exit 1) failed`. A failing item with no matching entry in `p.Checks` (acceptance, compile, setup-N, model) is written exactly as today. The acceptance scenario suffix, the `; Speculative results:` and `; Cancelled work:` sections and the `; not run because an earlier item failed:` tail are unchanged. Nothing else changes: which passes are green or failing, the pass record, feedback texts, any other line; no new configuration. Existing expectations in verify/pass_test.go whose Failing names have no Checks entry still pass unchanged.

## Decisions
- Only a `p.Checks` entry whose Name equals the failing item and whose Status is non-zero adds ` (exit <status>)`; the first such entry is used, and the order of `p.Failing` is kept. (source: request)
- The change is confined to the `len(p.Failing) > 0` branch of `Pass.Summary`; no setting, flag or environment variable is added. (evidence: verify/pass.go) (source: request)
- Acceptance runs a Go driver test through a Go build overlay, so the checkout is not modified and the step builds nothing at load time. (assumption: the overlay-added test file in package verify compiles against the candidate tree) (source: request)

## Source comparison
- Observed log sequence `kogen: verifying (pass 1)`, then `kogen: pass 1: test failed`, then `kogen: building (round 2)`: the first and third lines stay as they are; only the middle line gains the exit status.
- `kogen: pass 1: test (exit 1) failed` for a single failing check with Checks entry Status 1: addressed in scenario 1.
- `kogen: pass 2: lint (exit 2), test (exit 1) failed` keeping Failing order: addressed in scenario 2. The wrong form `kogen: pass 2: lint (exit 2), test failed` (status on the first check only) is rejected by that scenario.
- Failing item `acceptance` without a Checks entry stays `kogen: pass 3: acceptance failed (1 of 1 scenarios: A:9)` even when Checks holds an unrelated passing check: addressed in scenario 3. The wrong form `kogen: pass 3: acceptance (exit 1) failed (1 of 1 scenarios: A:9)` is rejected by that scenario.
- Existing Summary expectations (compile/not-run tail, `lint, acceptance failed ...; Speculative results: test; Cancelled work: build`): unchanged, covered by the existing tests in verify/pass_test.go.

## Tests
- A failing project check in p.Checks with non-zero Status is shown as `<name> (exit <status>)`, in Failing order: add cases to TestPassSummaryProgressLine in verify/pass_test.go (unit)
- A failing item without a Checks entry is written as before: existing cases in TestPassSummaryProgressLine and TestPassSummaryAcceptanceScenarios in verify/pass_test.go (existing)
- The three request examples produce the exact lines: acceptance.feature driving a Go test in package verify (scenario)

## Feasibility
- none
