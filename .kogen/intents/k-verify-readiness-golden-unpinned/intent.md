# Unpin coordinator readiness baseline bytes

Slug: k-verify-readiness-golden-unpinned
Model: not applicable — this changes test ownership assertions, not readiness state transitions
Acceptance:
- .kogen/intents/k-verify-readiness-golden-unpinned/acceptance.feature
- features/steps/k-verify-readiness-golden-unpinned__commands.js

Update TestReadinessRecordEqualsTheElixirRecordAndReadsBack in verify/readiness_golden_test.go so coordinator-owned Baseline contents and their derived SHA256 are not foreign golden byte pins. Keep verification's own readiness record schema and values under semantic JSON comparison, including exact keys, while asserting that the written baseline and hash faithfully propagate the current inputs. Supply those dynamic expected values from the real readiness inputs, not from the serialized output being tested. Do not change production readiness behavior or upgrade go.mod to solve this test failure.

Retain coverage of both readiness-simple and readiness-full, historical-record cache misses, complete-record reuse, changed-HEAD invalidation, newline formatting, scenarios, feasibility and package facts. Remove obsolete golden baseline/hash expectations (including nested record copies) or leave historical values inert; update the golden test comment and regeneration logic to describe the new ownership boundary accurately. Preserve record_text historical input bytes. Do not use -update to silence this failure or relax comparison of verification-owned fields.

## Decisions
- Assert only verification's use of coordinator Baseline, not coordinator-owned bytes; preserve detection of verification record shape drift. (source: request)
- Land after k-verify-fixture-title-user-name; its step file is already present in this tree, and this Intent neither imports nor changes its bindings. (source: request)
- Exercise the pinned coordinator version v0.0.0-20261104010828-f15509472852 and coordinator main resolved during shaping to ce1e6baa2d7753ebbd70e6a290c9be36c07ee65f (v0.0.0-20261104042648-ce1e6baa2d77); keep dependency changes confined to disposable acceptance copies. (source: request)

## Source comparison
- Addressed: request Need and Acceptance map to the dynamic-input expectations above and all acceptance scenarios. Obsolete golden hash/baseline values are superseded by runtime input values; no verification-owned record fields are omitted from equality.
- Addressed: reported readiness-full/readiness-simple failure at readiness_golden_test.go:118 is reproduced independently of incidental coordinator history by deliberately stale foreign golden values. Acceptance also runs both projects with pinned and resolved-main coordinator versions.
- Addressed as historical evidence, not freshly proven causation: request reports coordinator 482d565 already red, 91d0a32 title fixture masking at main, likely 4826fb1 adding .kogen/models.yaml, and delivery's 4 Nov consumer-check.sh scratch sweep recorded in sweep-bisect-20261104/RESULT.md. Those historical commits are not new supported-version promises or a requirement to replay the entire sweep. Current pinned run actually passes on this tree; foreign-golden perturbation distinguishes the requested fix from that baseline.
- Addressed: request Order is preserved above; no unrelated title-fixture changes, production changes, dependency upgrade or new settings are in scope.

## Tests
- Coordinator-owned Baseline and hash must not be golden pins: stale foreign golden values must still allow both existing readiness record subtests to pass (regression)
- Both supported dependency inputs work: run the existing named readiness test and require both subtests to pass with pinned and resolved-main coordinator versions (integration)
- Verification-owned record shape remains protected: change written version from 3 to 999 in a disposable copy and require both existing subtests to fail (regression)
- Existing cache, record formatting and evidence assertions remain meaningful: retain the existing readiness record test assertions outside the replaced foreign pins (existing)

## Feasibility
- Pinned named readiness test passed with both subtests on the unchanged tree (probe: exit 0); coordinator main resolved via git ls-remote and its module downloaded successfully (probe: exit 0). No external protocol/library behavior change requires provider documentation.
- evidence: {"id":"runner-controls","kind":"observer","inputs":["verify/readiness.go","verify/readiness_golden_test.go","verify/testdata/golden/readiness.json"],"observers":["features/steps/k-verify-readiness-golden-unpinned__commands.js"],"checks":[{"name":"good","command":"node features/steps/k-verify-readiness-golden-unpinned__commands.js good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/k-verify-readiness-golden-unpinned__commands.js bad","exit":1,"output":"rejected\n"}]}
