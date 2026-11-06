# Start the deadline test's clock at first setup

Slug: k-verify-wall-time-test-clock
Model: not applicable — only one test's timing changes; no product state or rule changes
Acceptance:
- .kogen/intents/k-verify-wall-time-test-clock/acceptance.feature
- features/steps/k-verify-wall-time-test-clock__steps.js
- features/steps/k-verify-wall-time-test-clock__driver.js
- features/steps/k-verify-wall-time-test-clock__good.js
- features/steps/k-verify-wall-time-test-clock__old.js

`TestWallTimeDeadlineAndNeverStarted` in `verify/wall_time_test.go` fails at random on busy hosts and turns landings red. Today it gives the whole `Verify` call a 300 ms deadline (`context.WithTimeout(context.Background(), 300*time.Millisecond)`) and then requires the first setup command to have run for at least 100 ms. The work `Verify` does before that first command starts (tree snapshot, tool identity probes, host-load probe) comes out of the same budget. On a slow or loaded host that work takes most or all of it, so the test sees the first command run too briefly or never start. Neither is a product defect.

After this change the test measures what it claims: a deadline that reaches a running setup command aborts that command and reports the deadline, and no later setup command starts. Its 300 ms clock starts when the first setup command starts, not when the `Verify` call starts. A 30-second fallback deadline ends a run whose first setup command never starts, so a broken product fails rather than hangs.

What stays as it is:
- The test keeps its name `TestWallTimeDeadlineAndNeverStarted` and its file `verify/wall_time_test.go`.
- The fixture stays the same: `newProj`, `p.Config.Setup = []string{"sleep 30", "echo never"}`, and `s.Env` with `PATH` set to a temp dir that holds only a `sleep` symlink to `/bin/sleep`.
- These checks stay the same:
  - `errors.Is(err, context.DeadlineExceeded)` on the error `Verify` returns.
  - `requireAborted(t, <memLog>, "timeout")` with `item` equal to `"setup-1"`.
  - Exactly one `command_result`, named `setup-1`, via `requireWall`.
  - Its `wall_ms` is at least 100 and below 3000.
  - No `command` event whose name contains `setup-2`.
- `requireWall`, `TestWallTimeStageAndMaintainedFeature` and `TestWallTimeCancelledCohortBeforeStart` stay unchanged.

What changes:
- The context passed to `Verify` gets a 300 ms deadline only when the first setup command starts. "Starts" means the test's logger receives the event `{"event": "command", "name": "setup-1", ...}`. `Verify` logs this event in `runLogged` (`verify/run.go`) immediately before it runs the command.
- When that deadline fires, the context's `Err()` must be `context.DeadlineExceeded`, because `Verify` returns `ctx.Err()` and classifies the cause from it. A `WithCancelCause`-style cancellation would read as `context.Canceled` and is wrong.
- `Verify`'s `Log` must still be (or embed) the `*memLog` the assertions read. Wrapping it adds the arming hook.
- A test-local type that implements `context.Context` is enough: `Done`, `Err`, `Deadline` and `Value`, armed by the logger.
- The fallback is the parent context: `context.WithTimeout(context.Background(), 30*time.Second)`, created just before `Verify` is called. If the first setup command never starts, `Verify` returns when the fallback ends, and the test fails. An explicit message such as "setup-1 never started before the 30s fallback deadline" is fine.
- No product code changes: no file under `verify/` other than `verify/wall_time_test.go` changes, and nothing outside `verify/` changes.

## Decisions
- The test's 300 ms deadline is measured from the start of the first setup command (the `command` event for `setup-1`), not from the start of the `Verify` call (source: request)
- The checks on the first command's run time (at least 100 ms, below 3000 ms), the deadline error, the aborted first item and the never-started later item stay unchanged (source: request)
- A fallback deadline ends a run whose first setup command never starts. Shaping sets it to 30 seconds from just before the `Verify` call, far above any host's pre-setup work and well inside the 120-second acceptance step limit (source: request)
- Only the test changes; no product code changes (source: request)
- Start the test's 300 ms deadline when the logger receives the `command` event for `setup-1`. Verify receives a test-local context.Context whose Err() becomes context.DeadlineExceeded once the armed budget ends. The parent context.WithTimeout(30s) is the fallback deadline. (decision: D1, round 1) (constraint: Only verify/wall_time_test.go changes) (constraint: The test name TestWallTimeDeadlineAndNeverStarted and its other checks stay unchanged) (constraint: Fallback deadline is 30 seconds) (evidence: verify/wall_time_test.go; verify/run.go; verify/env.go; verify/concurrent.go; verify/helper_test.go; verify/verify_test.go) (assumption: The known-good test's behavior under the race detector and vet was observed only in a scratch copy with external tools, not in a Kogen probe record. Readiness's Feasibility observer controls are the retained proof.) (source: request)
- Acceptance builds verify test binaries with go build overlays for three product variants (slow-pre-setup: 250 ms sleep before setup; ignore-deadline: context.WithoutCancel in runStepAs; never-start: wait for ctx.Done before setup). It runs the candidate test 300 times (ten concurrent processes), once, and once, respectively. (decision: D2, round 1) (constraint: Variant anchors in verify/run.go and verify/env.go must each occur exactly once) (constraint: 300 runs must finish within the 115 s step timeout) (evidence: features/steps/fix-k-verify-previously-red-first-2__steps.js; README.md; verify/run.go; verify/env.go) (assumption: Timing (300 runs in about 36 s on 12 CPUs; good control about 117 s, old control rejected at slow-pre-setup in about 30 s) was observed only in an external scratch copy on this host. Run time on a much slower acceptance host is not measured.) (source: request)

## Source comparison
- Problem (the fixed whole-call budget is consumed by pre-setup work on busy hosts): addressed by starting the 300 ms clock at the `setup-1` `command` event. Scenario "The deadline test passes 300 times when the work before setup takes most of the old budget".
- Need, "clock must start when the first setup command starts": addressed as above.
- Need, "keep the test's other checks unchanged" (lower bound, upper bound, deadline error, aborted first item, no later item started): addressed. The prose lists each check and its literal values.
- Need, "add a fallback deadline that ends a run whose first command never starts": addressed with 30 s. Scenario "The deadline test fails at its fallback deadline when the first setup command never starts".
- Need, "change only the test; no product code changes": addressed in the prose. Product variants exist only in go build overlays that the acceptance driver writes to a temp dir. The checkout is never edited.
- Synthetic acceptance 1 (at least 300 runs on a host where pre-setup work takes most of the old budget, passing every time): the `slow-pre-setup` variant inserts `time.Sleep(250 * time.Millisecond)` right after `s.Progress(fmt.Sprintf("kogen: verifying (pass %d)", in.N))` in `verify/run.go`. That is 250 ms of the old 300 ms budget. The test runs 300 times, split over at most ten concurrent processes, and must pass every time.
- Synthetic acceptance 2 (a product variant that ignores the deadline): the `ignore-deadline` variant inserts `ctx = context.WithoutCancel(ctx)` at the top of `runStepAs` in `verify/env.go`, so each step runs with a context that cannot be cancelled. The test must run once and fail, without hitting the test-binary timeout.
- Synthetic acceptance 3 (a product variant whose first setup command never starts): the `never-start` variant makes `verify` wait for `<-ctx.Done()` and return `ctx.Err()` right after the same `s.Progress` line. The test must fail, and its failed run must last from 30 s up to (not including) 60 s. That means it fails at the fallback deadline instead of hanging.
- Synthetic acceptance 4 (the rest of the suite is unchanged and passes): the configured checks cover it (`format`, `compile`, `vet`, `go-test`: `GOFLAGS=-trimpath go test ./...`).

## Tests
- The deadline clock starts when the first setup command starts, so slow pre-setup work does not fail the test: update `TestWallTimeDeadlineAndNeverStarted` in `verify/wall_time_test.go`. Acceptance runs it 300 times under the `slow-pre-setup` variant (regression)
- A deadline that reaches the running first setup command aborts it, reports the deadline, and starts no later setup command; a product that ignores the deadline fails the test: the same updated test keeps these checks. Acceptance runs it under the `ignore-deadline` variant (regression)
- A run whose first setup command never starts fails at the 30 s fallback deadline: the same updated test. Acceptance runs it under the `never-start` variant (regression)
- The rest of the suite is unchanged and passes: the configured `go-test` check (existing)

## Feasibility
- Every `Verify` error path returns `ctx.Err()` (`verify/concurrent.go`, `verify/env.go` `runStepAs`; `kogen-loop/sys` `RunContext` checks `ctx.Err()`). A test-local `context.Context` whose `Err()` is `context.DeadlineExceeded` therefore yields the `timeout` cause without product changes. Observed in a scratch copy outside the checkout: the known-good test from `features/steps/k-verify-wall-time-test-clock__good.js` passed `go vet ./verify` and `go test -race -count=5 -run '^TestWallTime' ./verify` (exit 0, 14.6 s).
- Timing in a scratch copy (12 CPUs): 300 runs of the known-good test under `slow-pre-setup` with ten processes took 36 s. The `ignore-deadline` run failed after 30.5 s ("deadline: <nil>"). The `never-start` run failed after 30.2 s (fallback). Each variant build took under 0.5 s with a warm cache. The known-good control took 117 s in total; the known-bad control took 30 s.
- evidence: {"id":"observer","kind":"observer","inputs":["features/steps/k-verify-wall-time-test-clock__driver.js","features/steps/k-verify-wall-time-test-clock__good.js","features/steps/k-verify-wall-time-test-clock__old.js","verify/run.go","verify/env.go"],"observers":["features/steps/k-verify-wall-time-test-clock__driver.js"],"checks":[{"name":"good","command":"node features/steps/k-verify-wall-time-test-clock__driver.js good","exit":0,"output":"observer accepted\n"},{"name":"bad","command":"node features/steps/k-verify-wall-time-test-clock__driver.js old","exit":1,"output":"observer rejected: slow-pre-setup\n"}]}
