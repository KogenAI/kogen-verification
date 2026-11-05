# Keep readiness identity under absent lineup

Slug: v-consumes-baseline-optional-models
Model: not applicable — the change edits a test fixture and its recorded identity values; there is no state or lifecycle
Acceptance:
- .kogen/intents/v-consumes-baseline-optional-models/acceptance.feature
- features/steps/v-consumes-baseline-optional-models__steps.js

This is the paired consumer row for kogen-coordinator's Build `coord-baseline-optional-files-when-present` (candidates 285e710 and cd8b879). That Build changes the shared baseline format on purpose: `project/baseline.go` leaves `.kogen/models.yaml` out of an Intent's baseline when the file is absent, where the coordinator this repo pins today (`github.com/KogenAI/kogen-coordinator v0.0.0-20261104010828-f15509472852`) always lists it right after `.kogen/project.yaml`. The producer's consumer contract check (4 Nov 22:38Z and 5 Nov 09:20Z, same result both times) refused it with one new failure in this repo:

```
kogen-verification TestReadinessRecordAndIdentity contract_test.go:343: identity not current
```

The cause: `contract/contract_test.go` `TestReadinessRecordAndIdentity` copies `verify/testdata/readiness-simple`, which has no `.kogen/models.yaml`, and compares the readiness identity (`verify.Readiness.Current`: baseline list, `project.Hash` of it, HEAD and tree) with fixed literals that include `.kogen/models.yaml` in the baseline. Under the absent-file rule the baseline has four paths, so the identity is not current.

Outcome: `TestReadinessRecordAndIdentity` (and with it the whole `./contract` package) passes both against the pinned coordinator and against a coordinator with the absent-file rule. It is done by making the fixture carry a `.kogen/models.yaml`, so both rules give the same five-path baseline, and regenerating the recorded identity once from that fixture:

1. Add `verify/testdata/readiness-simple/.kogen/models.yaml` with exactly these bytes (the pinned coordinator's `project.ModelsTemplate()`, a valid team lineup for `project.LoadModels`), ending with one newline:
   ```yaml
   models:
     shape:
       model: gpt-6.1-sol
       effort: high
     build:
       model: gpt-6.1-sol
       effort: medium
     review:
       model: gpt-6.1-terra
       effort: medium
   ```
2. In `contract/contract_test.go` `TestReadinessRecordAndIdentity`, keep the fixed literal identity (do not compute expected values from `project.Baseline` or `project.Hash`), with its values regenerated from the new fixture: `Head` `cf76389c534b622b53ffc386a51864551ab1dad6` (was `5c4121dde97fad9e716064a6edf90dc6a5fb96e3`), `CandidateTree` `6307078b1939625eeb38acd2da2c49e9963d637c` (was `aad40d1e2713322a34e1ba6b7a75f08289d1b4b2`), `SHA256` `f6e3814bafd9a1bea693d23825c90b3837b74aa95167fc07cd888649b08428f7` (was `7ab465474295b8e57c292840a8c713cd06d57bd5aaa594fd2505ebff01f6eda0`). The `Baseline` literal stays exactly `.kogen/intents/fixture/intent.md`, `.kogen/intents/fixture/acceptance.feature`, `features/steps/fixture_steps.js`, `.kogen/project.yaml`, `.kogen/models.yaml`. Everything else in the test stays.
3. In `verify/testdata/golden/readiness.json`, the `readiness-simple` entry's recorded HEAD and tree change because the fixture gained a file, so `TestReadinessRecordEqualsTheElixirRecordAndReadsBack/readiness-simple` would fail on them. Regenerate them with the documented flag: `go test ./verify -count=1 -run '^TestReadinessRecordEqualsTheElixirRecordAndReadsBack$' -update`, which rewrites exactly `head` and `record.head` to `cf76389c534b622b53ffc386a51864551ab1dad6` and `tree` and `record.candidate_tree` to `6307078b1939625eeb38acd2da2c49e9963d637c`. The entry's inert coordinator-owned hash, which the golden test does not compare and `-update` does not touch, is also brought in line with the contract test's fixed identity by hand, so the contract README's statement that the fixed readiness identity is supported by this golden stays true: both occurrences of `7ab465474295b8e57c292840a8c713cd06d57bd5aaa594fd2505ebff01f6eda0` in the file (top-level `sha256` and `record.sha256` of `readiness-simple`) become `f6e3814bafd9a1bea693d23825c90b3837b74aa95167fc07cd888649b08428f7`. The baseline lists, `record_text` (historical bytes), `scenarios`, `package_facts_keys` and the whole `readiness-full` entry stay byte-identical. Then run the checks without the flag.

Boundaries: no change to `go.mod` or `go.sum` (the coordinator and kogen-loop pins stay as they are; this row lands first and the producer is then re-shaped on top), no change to any non-test Go file or product behaviour, and no change to `verify/testdata/readiness-full` or to other tests. Every existing test stays green under the configured checks. Nothing existing is removed.

## Decisions
- TestReadinessRecordAndIdentity must pass against the coordinator this repo pins today and against one with the absent-file rule (`.kogen/models.yaml` left out of the baseline when absent) (source: request).
- The fixture `verify/testdata/readiness-simple` carries a `.kogen/models.yaml`, so both rules give the same baseline, and the recorded identity is regenerated once from that (source: request).
- No pin (go.mod/go.sum) or product behaviour changes; every existing test stays green (source: request).

## Source comparison
- Addressed: Problem (producer leaves `.kogen/models.yaml` out when absent; refusal `kogen-verification TestReadinessRecordAndIdentity contract_test.go:343: identity not current`): reproduced on the unchanged tree with the acceptance's "absent-file rule" coordinator, the pinned coordinator's own source with only that rule added in `project.Baseline`, selected by a scratch `-modfile` with a `replace`; `go test ./contract` with it fails `TestReadinessRecordAndIdentity` with exactly `contract_test.go:343: identity not current`. The candidates 285e710 and cd8b879 are not available locally, so the rule is reproduced from the request's description, and the acceptance first shows the emulated rule's baselines (four paths when absent, five when present).
- Addressed: Need bullet 1 (passes against today's pin and against the absent-file rule): outcome items 1–3; acceptance runs the whole `./contract` package, which contains `TestReadinessRecordAndIdentity`, with both coordinators and requires the package to pass.
- Addressed: Need sub-bullet (fixture carries `.kogen/models.yaml`, identity regenerated once): outcome items 1–3 with exact bytes and values. Technical choices made in shaping: the lineup bytes are the pinned `project.ModelsTemplate()` output; the contract test keeps fixed literals; the golden's inert hash follows the contract test's hash.
- Addressed: Need bullet 2 (no pin or product behaviour change): Boundaries; acceptance checks the exact SHA-256 of `go.mod` (`6eb5ab6850c0f23838702939276a6cb88c680675751cdbec4665e128ed145520`) and `go.sum` (`106e551880e06f9418734c3e530aa1c5bdb6d879110790413b83a602d3530792`) and the required versions `github.com/KogenAI/kogen-coordinator v0.0.0-20261104010828-f15509472852` and `github.com/KogenAI/kogen-loop v0.0.0-20261104002337-25d87c2177c3`.
- Addressed: Need bullet 3 (every existing test green): the fixture change also moves the readiness golden's HEAD/tree, handled by item 3; the configured checks run the whole suite, including `TestReadinessRecordEqualsTheElixirRecordAndReadsBack`, with the pin.
- Out of scope: other consumer packages under the absent-file rule; a scratch run of `./consumes/kogen-coordinator` with that rule already passes, matching the report's single new failure.

## Tests
- The contract test's readiness identity holds whether or not the coordinator lists an absent `.kogen/models.yaml`: update the fixed Head, CandidateTree and SHA256 in contract/contract_test.go TestReadinessRecordAndIdentity for the fixture that now carries `.kogen/models.yaml`; the reproducing absent-file-rule run of `./contract` is in the acceptance (regression)
- The readiness golden matches the changed fixture's HEAD and tree: TestReadinessRecordEqualsTheElixirRecordAndReadsBack/readiness-simple after `-update` (existing)
- Pins and other tests unchanged: configured checks `go test ./...`, `go vet`, `go build`, gofmt (existing)
- End to end with the pinned and the absent-file-rule coordinators, plus unchanged go.mod/go.sum: .kogen/intents/v-consumes-baseline-optional-models/acceptance.feature (scenario)

## Feasibility
- Hash method: a shell recomputation of `project.Hash` (sorted `<path>\0<sha256>\n`, `missing` for an absent file) over the current fixture gave `7ab465474295b8e57c292840a8c713cd06d57bd5aaa594fd2505ebff01f6eda0`, the recorded value; with the lineup file added it gives `f6e3814bafd9a1bea693d23825c90b3837b74aa95167fc07cd888649b08428f7`. Committing the changed fixture with the test's fixed identity and dates (git 2.54.0) gave HEAD `cf76389c534b622b53ffc386a51864551ab1dad6` and tree `6307078b1939625eeb38acd2da2c49e9963d637c`; `project.LoadModels` accepts the lineup bytes. (scratch probe, exit 0)
- On a scratch copy of the unchanged tree, `go test -modfile=<scratch go.mod with replace onto the patched coordinator copy> ./contract` failed only `TestReadinessRecordAndIdentity` with `contract_test.go:343: identity not current`; with the pin it passed; `./consumes/kogen-coordinator` passed under the rule. (scratch probe, exit 1 / 0 / 0)
- On a scratch copy with items 1–3 applied, `-update` changed exactly `head`, `tree`, `record.head` and `record.candidate_tree` of `readiness-simple`, and the contract and golden tests passed with both coordinators. The submitted feature and steps (go commands with `-trimpath`, so the per-run replace path does not force a rebuild) run with Cucumber outside the checkout gave 1 failed scenario (5 passed steps, failing step: the absent-file-rule `go test ./contract`, headed by `contract_test.go:343: identity not current`) on the unchanged copy, and 1 passed scenario (6 steps) on the fixed copy in 6.5 s. (scratch probe)
