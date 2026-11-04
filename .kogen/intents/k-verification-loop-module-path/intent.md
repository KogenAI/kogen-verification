# Migrate verification to canonical loop imports

Slug: k-verification-loop-module-path
Model: not applicable — module and import rewiring introduces no meaningful state
Acceptance:
- .kogen/intents/k-verification-loop-module-path/acceptance.feature
- features/steps/k-verification-loop-module-path__commands.js

Replace the bare loop dependency and all `kogen-loop/...` imports with `github.com/KogenAI/kogen-loop/...`, including tests, acceptance drivers and testdata Go files. Remove the bare `kogen-loop v0.0.0` requirement and replacement. Keep no replacement directives and add no go.work. Commit the canonical pseudo-version requirements and go.sum after go mod tidy.

Resolve the previous upstream blocker in this same change: use `go get github.com/KogenAI/kogen-loop@25d87c2177c33aa17a44c00fbe3b0602ea50ce88 github.com/KogenAI/kogen-coordinator@f15509472852998091680d2bc41bff6734599dae`. These are the main SHAs observed during shaping, resolving respectively to `v0.0.0-20261104002337-25d87c2177c3` and `v0.0.0-20261104010828-f15509472852`. Do not retain the old coordinator `v0.0.0-20261102193107-c4a49a4fe84f`. This repository itself is github.com/KogenAI/kogen-verification: migrate it here, not by introducing a self-requirement. Coordinator is its only other currently required component.

Preserve verification behavior and useful existing assertions. Upgrading coordinator changes its fixture validity requirements: supply nonempty Source comparison sections in synthetic Intent generators and readiness fixture Intents as necessary. Reconcile only mechanically derived fixture identities and recorded outputs caused by those input changes or upstream identity computation. Use the documented `go test ./... -update` mechanism for recorded outputs, review the resulting golden diff, and preserve recorded inputs and historical record_text/legacy records. Update hardcoded current identities in contract tests to match the actual fixture, not by disabling Current checks. Do not weaken tests, bypass lint, add replacement workarounds, or alter verification semantics to hide incompatibilities. No unrelated upstream behavior is adopted as a new product feature.

## Decisions
- No behavior change; use canonical module imports without replacements or a workspace. (source: request)
- Upgrade the pinned components together after their loop-path migration, then tidy. (source: request)

## Source comparison
- Addressed: Request Need and Acceptance map to the exact canonical loop pin above, the module/import scenarios, and the full build/vet/test scenario; bare requirement, replacement and imports are removed throughout the repository.
- Addressed: Request Order and automatic-retry evidence map to upgrading coordinator to the observed main SHA in the same change. Its downloaded go.mod requires canonical loop, unlike the old c4a49a4fe84f revision cited in the reported setup failure. Verification is the main module here and is migrated locally rather than required from itself.
- Addressed: Request no-behavior-change maps to preserving existing verification assertions; fixture schema/identity compatibility repairs are explicitly permitted above because probes reproduced new coordinator lint failures and identity drift. Golden history remains immutable under README rules. The builder-reported protected contradiction is historical evidence, not authority or permission to edit this Intent during Build.
- Superseded: The old bare-loop replacement pin is replaced by the two settled main pins. No requested product behavior is omitted, and no replacement fallback is authorized.

## Tests
- Canonical loop and coordinator pins replace bare module wiring without workspaces or replacements: module manifest and tidy scenario (integration)
- Every Go import uses the canonical loop path and compiled dependencies contain no bare loop import: repository and dependency import scenario (regression)
- Verification behavior is preserved across the component upgrade: go build ./... && go vet ./... && go test ./... plus configured checks and existing assertions, with only explained fixture compatibility updates (existing)

## Feasibility
- Main discovery and baseline module inspection succeeded with git ls-remote and go list -m -json all (probe: exit 0, 1.7 s). Observed loop main 25d87c2177c33aa17a44c00fbe3b0602ea50ce88 and coordinator main f15509472852998091680d2bc41bff6734599dae; no active workspace.
- Scratch migration resolved both exact SHAs and tidy produced the canonical requirements without replacements. Build and vet passed; existing tests failed with coordinator Intent lint and fixture identity incompatibilities (probe: exit 1, 26.7 s). This is not a verification pass.
- A focused scratch fixture compatibility exploration confirmed Source comparison requirements and contract identity drift; many generated-fixture lint failures remained (probe: exit 1, 19.8 s). Implementation must repair fixtures, not weaken assertions. Follow-up upstream source inspection confirmed the new comparison requirement and canonical coordinator dependency (probe: exit 0, 0.0 s).
- Documentation search returned sources including go.dev; fetch https://go.dev/ref/mod returned retrieved, untrusted, truncated content describing commit-hash queries and generated pseudo-versions. Repository resolution, not prose, established the exact pins.
