# Flag implementation changes without spec updates

Slug: k-verify-maintained-spec-unchanged-notice
Model: not applicable — the notice is a pure classification of one candidate's changed paths against declared paths, computed once per pass with no interacting state
Acceptance:
- .kogen/intents/k-verify-maintained-spec-unchanged-notice/acceptance.feature
- features/steps/k-verify-maintained-spec-unchanged-notice__steps.js
- features/steps/k-verify-maintained-spec-unchanged-notice__driver.js
- features/steps/k-verify-maintained-spec-unchanged-notice__observer.js

A verification input can name maintained specification paths (prose, feature files, state models; files or directories) and the implementation paths (files or directories) they describe. A whole verification pass then records, as an informational field, which implementation files and which maintained specification files the candidate changed against the base commit the candidate was started from. It flags "specs not updated" when implementation files changed and no maintained specification file did. The flag goes into the repair-owner feedback and the reviewer material as exactly one line. It does not change green/red unless the caller sets "require spec update", which makes a flagged pass red. Nothing else about the pass changes: this feature does not run the declared specifications (maintained models and features keep their own existing inputs), and with no names supplied the record, feedback and reviewer material stay byte-identical to today's. Nothing existing is removed.

## Decisions
- The pass record states implementation files changed (count and bounded sorted list), maintained specification files changed (count and list) and a "specs not updated" flag when implementation files changed and no maintained specification file did; it is informational and does not change green/red by default. (source: request)
- Feedback and the reviewer material carry the flag as one line. (source: request)
- The project setting "require spec update" makes a flagged pass red, naming the implementation files changed and the unchanged specification paths. (source: request)
- Changes are measured against the base commit the candidate was started from; a test-only or documentation-only change counts as implementation only when its path is declared as implementation. (source: request)
- A declared path that does not exist is a refusal naming it; with no names supplied, record and feedback equal today's. (source: request)

## Interface
This repository is the verification library. The coordinator owns `.kogen/project.yaml`; its `project.Config` has no such setting and is not changed here. Like `AcceptanceSuite.RequireFullCoverage`, the setting arrives through `verify.Input`:

```go
// MaintainedSpecs names the maintained specifications and the implementation they describe.
type MaintainedSpecs struct {
	Specs          []string // repository-relative files or directories
	Implementation []string // repository-relative files or directories
	RequireUpdate  bool     // the project setting "require spec update"
}
```

- Add `MaintainedSpecs *MaintainedSpecs` to `verify.Input`. "Declared" means the pointer is non-nil and `len(Specs)+len(Implementation) > 0`; anything else is "nothing declared". Scoped stage passes (`Input.Stage != nil`) ignore it entirely.
- Add `SpecUpdate *SpecUpdate` to `verify.Pass`, serialized as `"spec_update"` with `omitempty`, and read back by `Pass.UnmarshalJSON` (a marshal → unmarshal → marshal round trip keeps the bytes). Its JSON object has exactly these keys in this order:
  - `implementation_changed_count` (int): all changed implementation files;
  - `implementation_changed` ([]string, never null): the first 20 of them in byte-wise sorted order (the bound is 20);
  - `specs_changed_count` (int) and `specs_changed` ([]string, never null, sorted, not bounded): changed maintained specification files;
  - `specs_unchanged` ([]string, never null): the declared spec paths, as supplied and in declared order, under which no file changed;
  - `specs_not_updated` (bool): `implementation_changed_count > 0 && specs_changed_count == 0`.
- Changed files are `repo.Changed(in.Start, candidateTree)`, the existing coordinator Git call between the commit the candidate started from (`Input.Start`) and the candidate tree Verify already computes (`before`). This includes uncommitted and untracked candidate files and excludes `Input.Excluded`.
- Classification: each declared path is cleaned (`path.Clean`, so `spec/features/` equals `spec/features`). A changed file matches a declared path when it equals it, lies under it (`<path>/` prefix), or the declared path is `.`. A file matching any declared spec path is a specification file; otherwise one matching any declared implementation path is an implementation file; otherwise it is neither. No other rule (extension, test or documentation naming) applies.
- Existence: before any setup command or other item runs, each declared path must exist in the candidate as a file or as a directory holding at least one file. Paths are checked specs first, then implementation, in declared order. The first that does not exist makes `Verify` (and so `Run`) return an error and no pass. The error text contains `maintained specification path does not exist in the candidate: <path>` or `implementation path does not exist in the candidate: <path>`, with the path as supplied.
- The notice line, used everywhere the flag is shown:
  `specs not updated: implementation files changed: <count> (<listed files joined by ", ">[, and <count-20> more]); maintained specifications unchanged: <specs_unchanged joined by ", ">`
  The `and N more` part appears only when the count exceeds 20. Example: `specs not updated: implementation files changed: 1 (src/a.go); maintained specifications unchanged: spec/model.qnt, spec/features/a.feature`.
- When `specs_not_updated` is true, `Pass.Results()` (the reviewer material) appends the notice line as its last line. `Pass.Feedback()` (repair-owner feedback) includes it exactly once as its own line, after the check, speculative/cancelled and acceptance-coverage sections and before the "files changed while checks ran" and not-run lines.
- With `RequireUpdate` and `specs_not_updated`, the notice line is appended to `Pass.Failing`, so the pass is not green and `Complete` rejects it; the item schedule, NotRun and other results are unchanged. Feedback still shows the line once (it is not repeated for the failing entry). Without `RequireUpdate` the flag never affects `Green`, `Failing`, `Complete` or `Summary`.
- Nothing declared: `SpecUpdate` stays nil and no existence check runs. The pass JSON, `Feedback` and `Results` bytes are identical to today's, and the goldens in `verify/testdata/golden` must not change.

## Source comparison
- Addressed: Problem/Need (maintained spec and implementation paths as verification input; informational record of both change sets with counts and bounded sorted list; flag; one line in feedback and reviewer material; default green/red unchanged; "require spec update" red naming files and unchanged spec paths; base-commit measurement; test/doc-only paths count only when declared; no names → today's output): Interface above; acceptance scenarios "Only an implementation file changed", "red for another reason", "Require spec update", "counts as neither" and "Nothing declared".
- Addressed: the synthetic acceptance repo declares `src/a.go` as implementation and `spec/model.qnt`, `spec/features/a.feature` as specs. Cases 1–7 map to these scenarios: implementation (1), red-check (1, feedback line), both (2), spec (3), require (4), missing with `spec/missing.qnt` (5), many with `src` declared as an implementation directory and 300 new files `src/gen/f000.go`..`src/gen/f299.go` (6), control (7). "Control build" is read as the same candidate verified with nothing declared, compared byte for byte.
- Decided (not in the request): the list bound is 20; spec paths win when a file matches both kinds; the record also keeps `specs_unchanged` so a recorded pass can render the notice line; stage gates ignore the input; the notice-line wording above.
- Omitted: wiring `.kogen/project.yaml` keys and the Build/Review callers that supply `MaintainedSpecs`. They belong to the coordinator and consumers in other repositories, outside this library.

## Tests
- Changed files are classified against declared files and directories with spec precedence, sorted and bounded to 20 with the total kept: unit test of the classification on path lists, including `.`, trailing `/`, a path in both kinds, an undeclared doc/test file, and 21 implementation files (unit)
- The notice line renders count, list, `and N more` and unchanged specs; Results appends it once and Feedback contains it once, also with RequireUpdate where it is a failing entry: unit tests on constructed Pass values (unit)
- `spec_update` serializes with the stated keys and round-trips byte for byte; absent when nil: extend the Pass JSON tests in `verify/pass_test.go` (unit)
- Verify measures candidate changes against Input.Start on a synthetic Git repository, stays green when flagged, and turns red only with RequireUpdate: integration test in `verify` using `newProj` (integration)
- A declared path missing from the candidate refuses the pass before setup runs, naming the path: integration test with a setup command that writes a trace, asserting the error text and an empty trace (integration)
- Nothing declared keeps record, feedback and reviewer material identical: integration comparison of nil versus empty `MaintainedSpecs`, plus the unchanged goldens (regression)
- The whole behavior through Verify for the request's seven synthetic cases: acceptance scenarios via the protected overlay driver (scenario)

## Feasibility
- evidence: {"id":"spec-update-observer","kind":"observer","inputs":["features/steps/k-verify-maintained-spec-unchanged-notice__observer.js"],"observers":["features/steps/k-verify-maintained-spec-unchanged-notice__observer.js"],"checks":[{"name":"good","command":"node features/steps/k-verify-maintained-spec-unchanged-notice__observer.js good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/k-verify-maintained-spec-unchanged-notice__observer.js bad","exit":1,"output":"rejected\n"}]}
- The acceptance driver is a Go test added to package `verify` only through a `go test -c -overlay` build of a temporary file. It sets `Input.MaintainedSpecs` by reflection, so it compiles and runs on the unchanged tree and reports `declarable: false` there. Scratch probe: build 5.7 s, each case about 2–5 s, `go vet -overlay` clean. Missing-feature red therefore shows as `declarable` false and an absent `spec_update`, not a compile failure.
