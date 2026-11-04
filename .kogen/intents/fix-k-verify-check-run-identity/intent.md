# Record candidate tool paths relative to scratch

Slug: fix-k-verify-check-run-identity
Model: not applicable — one path formatting rule in the identity snapshot; no new state, workflow or setting
Acceptance:
- .kogen/intents/fix-k-verify-check-run-identity/acceptance.feature
- features/steps/fix-k-verify-check-run-identity__steps.js

Fix a review finding on the landed k-verify-check-run-identity change. Verify materializes each candidate into a fresh scratch folder with a random name (`sys.TmpPath("kogen-verify")`, `verify/run.go`) and snapshots the identity with `dir` set to that folder. `resolveIdentityTool` (`verify/identity.go`) joins a relative or empty PATH entry (an empty entry means `.`) onto `dir` and returns the absolute result. So when a tool is found through such an entry, the scratch folder name goes into `tools[].path` of `check_identity` and into every command's `identity_sha256`, and two identical passes hash differently.

Shaping reproduced this on unchanged main (`4eba4cd`) with the acceptance driver's setup. Two identical Verify passes ran with session PATH `<absolute tool folder>:` and an executable `node` committed at the candidate root. They recorded node at `<TMPDIR>/kogen-verify-91954de3afe1ce4d/node` and `<TMPDIR>/kogen-verify-050e2928ada3a71c/node`. Their `acceptance` and `proof` identity hashes differed (`9d0e0423…` vs `8d194eac…`, `72cefa74…` vs `06ae84e9…`). The PATH entry `tools` with `tools/node` behaved the same way (`…/kogen-verify-ce7e18f0c7bca3b2/tools/node` vs `…/kogen-verify-b232a3d168ad63d8/tools/node`).

After the fix, a resolved tool executable that lies under `dir` is recorded relative to `dir`, as the request says: "Record paths under `dir` relative to `dir`". Every other resolved path stays absolute, exactly as now. Because `identity_sha256` already hashes the recorded `tools` (`identityLogger` in `verify/identity.go`), identical passes then hash identically. Nothing else in the identity, the Pass JSON, the command results or the probing behavior changes ("no unrelated changes").

## Decisions
- Recorded form: when the resolved absolute executable path lies under `dir`, `tools[].path` is `filepath.Rel(dir, <absolute path>)`. That is a slash-separated path with no leading `./`: `node` for a tool at the candidate root found through an empty (or `.`) PATH entry, and `tools/node` for the entry `tools`. "Under `dir`" means the relative result is neither `..` nor starts with `../`. This applies to every resolved path under `dir`, however its PATH entry was written. (source: request)
- Paths outside `dir` (absolute PATH entries such as the host tool folders) stay absolute and byte-identical to today, for example `<tool folder>/git`. (source: request)
- The version probe still executes the resolved absolute executable. Only the recorded `path` changes. Executing the relative form with `cmd.Dir = dir` would search PATH instead. Status, version, the one-second timeout, the output bounds and the 4096-byte path limit stay as they are. (source: request)
- `identity_sha256` keeps its formula: it hashes the recorded `tools`, so it changes only through the recorded path. (source: request)

## Source comparison
- Addressed: Problem: a relative or empty PATH entry resolves under the scratch folder, putting its name into `tools[].path` and `identity_sha256`, so two identical passes hash differently (verify/identity.go `resolveIdentityTool`). Both acceptance scenarios cover it: the empty entry `""` with `node`, and the relative entry `tools` with `tools/node`. Each compares two identical passes' node path, the absence of `kogen-verify-` in any tool path, and equal `acceptance`/`proof` hashes.
- Addressed: Need "first reproduce it: a test that fails on current main for exactly this scenario; stop if it does not reproduce". Shaping reproduced it on main (prose above), so the fix proceeds. The Build adds a Go regression test for the empty PATH entry (see Tests) that fails on unfixed main. Both acceptance scenarios also fail on main.
- Addressed: Need "fix it so the test passes: Record paths under `dir` relative to `dir`" (Decisions 1-3). Need "Add a relative-PATH test" (Tests, the `tools` → `tools/node` test).
- Addressed: Need "keep every existing test green; no unrelated changes". No golden records tool paths. `TestIdentityOutputAndEmptyEnvironment` probes a tool under `dir` but asserts no path. The k-verify-check-run-identity acceptance records an absolute stub folder outside scratch, so it keeps its absolute node path.
- Superseded: the k-verify-check-run-identity Intent defined `path` as the resolved absolute executable path. For executables under the materialized candidate it is now the path relative to it. Absolute paths outside it are unchanged.

## Tests
- An empty PATH entry finding an executable at the candidate root makes two identical passes record node path `node` and equal `identity_sha256`. Add a Go regression test in `verify/identity_test.go`: two identical `Verify` passes over `newProj` with an executable `node` committed at the root and session PATH `<absolute folder>:`. It asserts the `check_identity` node path `node` and equal `identity_sha256` for the same command in both passes, and it fails on unfixed main (regression)
- A relative PATH entry records the path relative to `dir`, and an absolute entry outside `dir` stays absolute. Add a relative-PATH Go test in `verify/identity_test.go`: `snapshotIdentity` with `dir` a temporary folder holding an executable `tools/node` and PATH `<absolute folder outside dir>:tools`. It asserts node path `tools/node` with status `ok`, and the absolute path for a tool in the outside folder (integration)
- Both behaviors end to end through `Verify`: the two acceptance scenarios (scenario)
- Unchanged identity behavior (probing, statuses, versions, lockfiles, environment, hash formula), goldens and the earlier identity acceptance: the existing tests stay green unchanged (existing)

## Feasibility
- evidence: {"id":"relpath-observer","kind":"observer","inputs":["features/steps/fix-k-verify-check-run-identity__steps.js"],"observers":["features/steps/fix-k-verify-check-run-identity__steps.js"],"checks":[{"name":"good","command":"node features/steps/fix-k-verify-check-run-identity__steps.js good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/fix-k-verify-check-run-identity__steps.js bad","exit":1,"output":"rejected\n"}]}
