# Regenerate verify goldens with go test -update

Slug: k-golden-update-verification
Model: not applicable — the change is a test-only switch that rewrites files from the code's current output; there is no lasting state or interacting rules to model
Acceptance:
- .kogen/intents/k-golden-update-verification/acceptance.feature
- features/steps/golden_update_steps.js

The five goldens in `verify/testdata/golden` (`accounts.json`, `feasibility.json`, `passes.json`, `readiness.json`, `text.json`) record fixed inputs and the outputs the verification code must produce for them. Today nothing can regenerate them: the tests only read them, and the `verify/testdata/gen/*.exs` scripts describe how the Elixir implementation once wrote them (from a `cli/verify/...` layout that does not exist here). This Intent adds one documented, test-only update path shared by all golden tests: the Go test flag `-update`, run as `go test ./... -update`.

Behavior:
- Without `-update`, every golden test behaves exactly as today: the same comparisons, the same failure on any drift, and no golden file is ever written.
- With `-update`, each recorded output that differs from the current code's actual output is rewritten in its golden file instead of failing the test; every other assertion of those tests still runs and fails as without the flag. A run without the flag afterwards passes.
- A golden whose recorded outputs all already equal the current output is left byte-for-byte unchanged, so `go test ./... -update` on a tree whose goldens match changes no file.
- A rewrite changes only what differs. The file stays one compact JSON line ending in a newline; object keys keep their recorded order; every value whose recorded JSON equals the current output by value keeps its exact recorded bytes (including the raw U+2028 inside `feasibility.json` and the non-sorted key order of the Elixir-written `accounts.json` and `readiness.json` records). Where the recorded and the current value are both objects with the same keys, or arrays of the same length, only their differing members are re-encoded; any other differing value is replaced whole, encoded the way `encode` in `verify/text.go` writes JSON (compact, keys in byte order, no HTML escaping).
- Recorded inputs and historical bytes are never rewritten, not even with the flag. The result is that any golden change is a deliberate `-update` run that shows up as a reviewable `git diff` of exactly the changed values.

What each golden test may rewrite under `-update` (everything else in the file is input):
- `text.json` (`TestBoundedTextsEqualTheElixirReference`): `cut[].out`, `excerpt[].out`, `tail[].out`, `cap[].out_len` and `cap[].out_hash`, and for `split[]` either `out` (the words; `[]` when there are none) or `error` (the error text), whichever `shellWords` now produces, dropping the other key. Inputs: every `in`, `n`, `cap[].len` and `cap[].kind`.
- `passes.json`: `feedback[].feedback` (`TestPassFeedbackEqualsTheElixirFeedback`) and `complete[].complete` (`TestPassCompleteEqualsTheElixirVerdictOnEveryReference`). Every `pass` record is input, including the legacy records from before `setup` and `not_run` existed; the round-trip assertions on those records stay assertions.
- `feasibility.json`: `declarations[]` `ok` (the declarations) or `error` (`class`, `detail`, `exit`, `lines`, `reason`), whichever `Declarations` now produces, dropping the other key (`TestDeclarationsEqualTheElixirReadingOnEveryReference`); `valid[].valid` (`TestValidEqualsTheElixirVerdictOnEveryReference`); `observations[].observations` and `observations[].acknowledgment` (`TestObservationsAndAcknowledgmentEqualTheElixirTexts`). The three tests share the file: each writes its own part without losing what an earlier test of the same run wrote.
- `accounts.json` (`TestAccountEqualsTheElixirAccountingOnEveryReference`): each case's `result`, written in the projection the test compares (without the scenarios' `unexercised_steps`).
- `readiness.json` (`TestReadinessRecordEqualsTheElixirRecordAndReadsBack`): `head`, `tree`, `sha256`, `baseline`, `record` (the written readiness record without `step_warnings` and without the scenarios' `unexercised_steps`, which the test supplies itself) and `package_facts_keys` (the sorted keys of the package facts file). `project`, `scenarios` and `record_text` (a historical record from before execution observations existed) are input and are never rewritten.

The flag is declared once, in a `_test.go` file of package `verify`, and read only by the tests. It is not a command, flag, configuration key or environment variable of any non-test code: a program that imports `github.com/KogenAI/kogen-verification/verify` has no `update` flag, and no environment variable switches the update on. The eight golden test names above stay unchanged; no timeout is raised and no user-visible option is added.

Documentation: `README.md` gets a section on the goldens under Testing that says what `verify/testdata/golden` holds, shows `go test ./... -update`, and says when to use it: after a deliberate change to a recorded output, or to settle a merge or cherry-pick conflict in a golden by regenerating it on the combined tree; then run the full checks without the flag and review `git diff verify/testdata/golden`. It also says the flag never rewrites recorded inputs or historical records and must not be used to silence an unexplained failure. Each golden test file has a comment, next to the test or its golden type, that names its golden file and says what it holds: its inputs, the outputs `-update` rewrites, and the bytes that are never rewritten. The `readGolden` comment and the comments that point at `testdata/gen/*.exs` are updated to the new path.

Removed: `verify/testdata/gen/` (`accounts.exs`, `feasibility.exs`, `passes.exs`, `readiness.exs`, `text.exs`). Those Elixir generators cannot run in this repository and would be a second, contradicting update path; `-update` replaces them.

Shaping checked this in scratch copies outside the repository: the eight golden tests are exactly the tests whose names contain `Elixir`; `go test ./... -update` on the unchanged tree fails with `flag provided but not defined: -update`; an order-preserving re-encode with Go keeps four goldens byte-identical and differs in `feasibility.json` only on the raw U+2028; a rough implementation of the rules above passed all eight scenarios, while a whole-file `json.Marshal` rewrite failed seven of them.

## Decisions
- The update path is the Go test flag `-update`, run as `go test ./... -update`; it is never a command, flag, config key or environment variable of the kogen binary (source: request)
- Without the flag the golden tests compare and fail exactly as today; with it they write the goldens, and a following run without the flag passes (source: request)
- Golden changes stay deliberate and show up as a reviewable diff; each test file says what its golden holds (source: request)
- Synthetic fixtures only; no new user-visible option; no raised timeouts (source: request)

## Source comparison
- Request "a Go test flag such as `go test ./... -update`, read only by the tests": addressed by the `-update` flag declared in a `_test.go` file of package `verify`; scenario "Updating goldens that already match rewrites nothing" runs `go test ./... -update` and checks that a program importing the non-test `verify` package has no `update` flag.
- Request "rewrites each golden from the current code's actual output": addressed for all five listed goldens (`verify/testdata/golden/accounts.json`, `feasibility.json`, `passes.json`, `readiness.json`, `text.json`), one drift scenario each, every one of the eight golden tests exercised.
- Request "Without the flag, every golden test behaves exactly as today ... same failure on any drift": addressed; each drift scenario first checks that the run without the flag fails in exactly the owning tests and leaves the edited golden unchanged.
- Request "A follow-up run without the flag must pass": addressed; every update scenario ends with a passing run without the flag.
- Request "Goldens that must not change without deliberate intent keep that rule ... reviewable diff": this repository has no `force_ordinary_golden.json`; its hash-pinned and historical bytes are `readiness.json`'s `head`/`tree`/`sha256` and `record_text` and the legacy pass records in `passes.json`. Addressed by writing only under `-update`, never rewriting inputs or historical records, and byte-preserving rewrites (readiness scenario edits the pinned `head`).
- Request "the test file says what each golden holds": addressed by the per-golden test comments; the documentation scenario checks every golden file is named in a comment of a `verify/*_test.go` file.
- Request "the docs say when to use it": addressed by the README section; the documentation scenario checks it shows `go test ./... -update` and names `verify/testdata/golden`.
- Request "Synthetic fixtures only. No new user-visible option; no raised timeouts": addressed; the scenarios edit synthetic values in a temporary copy of the repository.
- Request goldens in other component repositories (`shape/testdata/force_ordinary_golden.json`, `build/testdata/k-revod-gate/parts-requests.json`, `build/testdata/context-external-golden.json`, `reviewretry/*.wire.json`): omitted; they are not in this repository.
- Request evidence (2 Nov K-SHAPE-DECIDE-NON-UX and K-MODELS-FILE landings, 3 Nov kogen-shaping 13ff132 rebuild) and Delivery's later conflict resolution: background; the README names conflict resolution on the combined tree as a use of the flag.
- Existing `verify/testdata/gen/*.exs` generators: superseded by `-update` and removed (the documentation scenario checks `verify/testdata/gen` holds no files).

## Tests
- Without the flag a drifted recorded output fails its golden test and no golden is written: the five drift scenarios' runs without the flag, failing exactly the owning tests with the golden unchanged (scenario)
- With the flag every drifted recorded output in each of the five goldens is rewritten from the current code, only the differing values change, and a following run without the flag passes: drift scenarios for text.json, passes.json (two tests sharing the file), feasibility.json (three tests sharing the file), accounts.json and readiness.json, each ending byte-for-byte equal to the committed golden (scenario)
- Goldens that already match are left byte-for-byte unchanged by `go test ./... -update`: scenario "Updating goldens that already match rewrites nothing" (scenario)
- Recorded inputs and historical records are kept while their outputs follow the current code: scenario "A recorded input is kept and its recorded output follows the current code" and the readiness scenario's byte-for-byte check, which includes `record_text` (scenario)
- The flag exists only in the tests: the program importing the non-test `verify` package reports no `update` flag (scenario)
- The README documents `go test ./... -update` and when to use it, each test file names what its golden holds, and the Elixir generators are gone: documentation scenario (scenario)
- The other assertions of the golden tests and every other test keep passing unchanged: the existing suite, `go test -race -count=1 ./...` (existing)

## Feasibility
- none
