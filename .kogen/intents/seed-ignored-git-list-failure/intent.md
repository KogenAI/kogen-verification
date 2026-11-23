# Add SeedIgnored non-Git source regression test

Slug: seed-ignored-git-list-failure
Model: not applicable — SeedIgnored is a one-shot function of a source directory and keeps no state
Acceptance:
- .kogen/intents/seed-ignored-git-list-failure/acceptance.feature
- features/steps/seed-ignored-git-list-failure__steps.js

This change adds a regression test to `verify/seed_test.go` for `SeedIgnored` when its source directory is not a Git repository, so listing the ignored paths fails. The new test calls `SeedIgnored(src, dst)` with a non-Git `src` that holds some files and an empty `dst`. It requires an error that identifies the source (the error text contains the source path) and the failed listing (the text contains `listing ignored paths`), and it requires that `dst` holds no entries afterwards. Out of scope: any change to `verify/seed.go`, seeding behavior or error wording; only `verify/seed_test.go` is edited.

## Decisions
- The edit is confined to `verify/seed_test.go`: one new test function there, written with the existing helpers `seedWrite` and the standard library; `verify/seed.go` is not touched. (evidence: verify/seed.go; verify/seed_test.go) (source: request)
- Calling SeedIgnored with a non-Git source returns an error that identifies the source and the failed listing; the test asserts the error contains the source path and the existing wording `listing ignored paths`, which `ignoredPaths` already produces. (decision: D1, round 1) (evidence: verify/seed.go) (source: request)
- The failed call does not create seeded files in the destination: the test asserts the destination directory has no entries after the call. (decision: D2, round 1) (evidence: verify/seed.go) (source: request)
- The test sets GIT_CEILING_DIRECTORIES to the parent of the temporary source so Git cannot find a repository above it; this keeps the source non-Git on any host. (decision: D3, round 1) (evidence: verify/seed.go; verify/seed_test.go) (assumption: the hosts that run the tests have no Git repository at the temporary directory itself) (source: request)
- Acceptance does not rely on a test name the Build must invent: the step file finds the Test functions declared in `verify/seed_test.go` beyond the six that exist at HEAD, runs them with `go test`, and also runs them against overlays of `verify/seed.go` that are wrong (swallowing the failed listing, returning an unrelated error, omitting the source from the error, copying despite the failure), requiring each to make a new test fail. (decision: D4, round 1) (evidence: verify/seed_test.go; verify/seed.go) (source: request)

## Source comparison
- Request scope `verify/seed_test.go`: addressed by the one new test; out of scope (seeding behavior, error wording): `verify/seed.go` is not edited.
- Request acceptance 1 (error identifies source and failed listing; swallowing the Git error or returning an unrelated error fails): addressed by the scenarios on the unchanged code, a swallowed listing, an unrelated error and an error that omits the source.
- Request acceptance 2 (no seeded files in the destination; copying despite the failed listing fails): addressed by the scenario on a SeedIgnored that copies the source despite the failed listing.

## Tests
- SeedIgnored with a non-Git source returns an error naming the source and the failed listing: a new test in `verify/seed_test.go` (regression)
- A failed SeedIgnored leaves the destination without seeded files: the same new test in `verify/seed_test.go` (regression)
- The new test passes now and fails against each wrong SeedIgnored: the acceptance scenarios run it against overlays of `verify/seed.go` (integration)

## Feasibility
- none
