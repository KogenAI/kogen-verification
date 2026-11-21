# Weakened-baseline main-health failure: where the cause lives

The three assembly scenarios `Weakening the baseline is refused or stops the Build at once` fail
with a Build that lands instead of exit code 1. The assembly suite is not in this repository and
was not run from it.

Decision: kogen-build owns the cause. The comparison that decides whether the baseline is intact
is `Attempt.BaselineIntact` in kogen-build, cited as `build/build.go:476` (in that repository,
module version `v0.0.0-20261121131607-1f62072cbf0c`). It compares each approved file's digest
and the baseline's file list, in `baselineDiff` at `build/build.go:503`. The Build reaches it
through `Input.Intact: b.BaselineIntact`, wired at `build/build.go:768`.

What this repository does, and why nothing was changed here:

- `verify.Input.Intact` is a stateless callback. `Fix` calls it after each fixer
  (`verify/run.go:104`) and `verify` calls it after the pass's commands (`verify/run.go:443`),
  and a refusal ends the pass with `baseline_changed`. Neither call site can pass a weakened
  baseline on its own: whatever the callback returns is returned.
- `TestBaselineGuardRunsAfterEachFixerAndAfterThePass` (`verify/verify_test.go:322`) pins that
  both calls happen and that a refusal at either stops the pass. It passes unchanged.
- No defect in this repository was demonstrated, so no guard was changed and no regression test
  was added. The next main-health run, which has the assembly suite, verifies the three
  scenarios.
