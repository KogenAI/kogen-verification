# Keep fixture titles independent of Git names

Slug: k-verify-fixture-title-user-name
Model: not applicable — independent fixture literals have no meaningful state
Acceptance:
- .kogen/intents/k-verify-fixture-title-user-name/acceptance.feature
- features/steps/k-verify-fixture-title-user-name__commands.js

Keep fixture Git identities distinct from fixture Intent titles throughout this module. Do not encode coordinator title validation wording or its user-name rule in assertions. No coordinator lint behavior is part of this consumer's contract. Preserve useful existing tests and historical golden inputs. The primary repair is already present on this checkout; do not manufacture another literal change merely to produce a diff.

## Decisions
- Retain `Test Author` and `Fixture intent`: these already avoid the reported collision (evidence: verify/helper_test.go; verify/helper_project_test.go) (source: request)
- Retain the other helper's distinct `Fixture` identity and `Demo title`; its parsed-title assertion tests parsing, not title lint (evidence: consumes/kogen-coordinator/project_test.go) (source: request)
- Preserve dependency pins; this request does not authorize upgrades or golden regeneration to silence unrelated failures (evidence: go.mod; README.md) (source: request)

## Source comparison
- Addressed: request Need, module-wide distinct identities/titles and no assertions about lint wording or the user-name rule; covered by the outcome above and existing helper inspection.
- Superseded: reported consumer 3cb7305 used `Fixture` for both name and title; current helper uses `Test Author`. The original reproducer `go test ./verify -run '^TestBaselineGuardRunsAfterEachFixerAndAfterThePass$'` already passes all three subtests. Acceptance retains that real entry point rather than inventing a failing requirement.
- Addressed: original historical producer comparison identified 91d0a32 versus 482d565, and the scratch `Sample intent` correction passed against 03d7341. These are supplied historical evidence, not newly observed results.
- Addressed: delivery verification must also run the reproducer against coordinator 03d7341 and c4a49a4fe84f in disposable copies and run `consumer-check.sh github.com/KogenAI/kogen-coordinator <coordinator-main-checkout> <mirrors> 'kogen-verification|<fix-sha>|.|'` where that external gate and checkouts are available. Record unavailable resources honestly, never claim those runs from the local pinned-version result. No lint-caused failure is acceptable; name and trace any remaining failure to a different producer commit. Original known counterexample: readiness-full/readiness-simple hash drift associated with 4826fb1 adding `.kogen/models.yaml`, not title lint. Current goldens already include that baseline path.
- Omitted from local executable acceptance: external consumer-check harness and historical checkout matrix are not supplied repository interfaces; they remain delivery evidence requirements, not fabricated local commands. Local go.mod now pins f15509472852 rather than the request's historical c4a49a4fe84f.

## Tests
- Fixture setup remains independent of title lint: TestBaselineGuardRunsAfterEachFixerAndAfterThePass including after_the_first_fixer, after_the_second_fixer and after_the_pass (existing)
- Other Intent/identity helper remains usable without lint assertions: TestIntentBaselineFacts (existing)

## Feasibility
- Ran `go test ./verify -run '^TestBaselineGuardRunsAfterEachFixerAndAfterThePass$' -v`: exit 0, all three named subtests passed (probe: 2.9 s). This establishes the reported bug is already fixed in the current pinned environment, not historical matrix compatibility.
