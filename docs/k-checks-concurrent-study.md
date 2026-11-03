# Concurrent checks: verification study

All timings are wall-clock seconds on `kogen-linux-macbook`, Go `go1.27.2 linux/amd64`, with the host's `GOFLAGS=-mod=mod -p=2`. One repetition each, warm Go build cache, test-result cache disabled. A baseline tree was made with `git archive HEAD`, with the same installed Cucumber and Quint node_modules linked into it. Both trees ran the identical command `/usr/bin/time -f 'wall %e' go test -count=1 ./verify`, consecutively:

| Tree | 1/5/15-minute load before run | Package time | Wall |
| --- | --- | --- | --- |
| Baseline | 0.55 / 0.62 / 0.45 | 51.732 | 53.60 |
| Candidate | 0.82 / 0.68 / 0.48 | 51.628 | 51.94 |

The candidate measurement preceded the addition of the handoff test. Load and build-cache state were not identical, and there was only one repetition. These measurements do not establish a speedup. An earlier `go test ./verify` baseline on the same host took 55.30 seconds wall (load 0.65 / 0.36 / 0.23); an intermediate candidate took 55.67 seconds (load 0.18 / 0.32 / 0.26). Those are not comparable speed measurements either.

## Mutation controls

Each mutation below was temporary and restored before the next test. Commands ran `go test ./verify -run '^TEST$' -count=1` with a 2- or 3-second Go test timeout for the intentionally hung watcher and cancellation mutations. Each exited 1; the assertions remain in the final tests.

- `TestIndependentGoCommands`: removing recognition of the plain build and vet commands failed both positive cases.
- `TestSpeculativeRecordRoundTrip`: omitting both new fields from marshaling lost the recorded results and failed the round trip.
- `TestCompleteRequiresRequiredCleanEvidenceNotAStoredBoolean`: removing the two new Complete guards admitted speculative and cancelled proof, and both cases failed.
- `TestOwnedWatchDoesNotFollowOtherLiveSession`: giving the ended watch the live session instead caused the test to time out instead of detecting the missing result. This is the wrong-owner mutation.
- `TestSuccessfulSpeculationRetained`: putting completed later evidence in NotRun instead of Speculative failed the pass assertion.
- `TestCohortCancellationAtLaunch`: omitting the cancellation signal left the launched process running and the test timed out.
- `TestCohortCallerInterruptJoins`: disconnecting both caller-interrupt propagation paths left the process running and the test timed out.
- `TestCustomChecksAndOverridesKeepHandoffs/names`: choosing cohorts by compile/vet names instead of commands caused the consumer to fail before its input existed.
- `TestCustomChecksAndOverridesKeepHandoffs/override`: ignoring GOFLAGS made the synthetic Go commands race and the consumer failed before its input existed.

The common synthetic-project helper now removes inherited GOFLAGS so those fixtures start with standard Go execution; the explicit override test supplies its own. Before that fixture change, the protected concurrent acceptance failed four scenarios on this host because its driver inherited `GOFLAGS=-mod=mod -p=2`; with GOFLAGS absent, all six passed. This is significant: a local Go module probe confirmed that `-mod=mod` can rewrite go.mod during `go build ./...`, so it must not be treated as an independently safe execution override in production.

The README race command initially failed the existing `TestAttemptBoundsEachStepAndKeepsEvidence`: race-instrumented subprocess exit added the default one-second race-runtime delay to its one-second step bound. Repeating the exact build/vet/race command with `GORACE=atexit_sleep_ms=0` in the environment passed (verify 65.064 seconds). The configured fast checks, the six concurrent acceptance scenarios, and the four supplied model invariants also passed. The initial Quint invocation with repeated `--invariant` flags was rejected by the CLI; rerunning with `--invariants Prerequisite OrderedStop CancelOnlyLater EndedNoRunning` succeeded.
