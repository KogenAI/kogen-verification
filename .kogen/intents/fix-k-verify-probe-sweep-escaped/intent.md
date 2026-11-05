# Assert escaped child death and probe sweep event

Slug: fix-k-verify-probe-sweep-escaped
Model: not applicable — a test-only change that strengthens one Go test and adds a build constraint; no product state or rules change
Acceptance:
- .kogen/intents/fix-k-verify-probe-sweep-escaped/acceptance.feature
- features/steps/fix-k-verify-probe-sweep-escaped__steps.js
- features/steps/fix-k-verify-probe-sweep-escaped__harness.js

Fix a review finding on the landed k-verify-probe-sweep-escaped change (commit c8beabc). `TestProbeRealTimeoutEscaped` in `verify/probe_timeout_sweep_test.go` runs a probe that times out after its command forks a `setsid` child. It checks only `err == nil && r.TimedOut`, so it never shows that the escaped child died or that the probe's `step_sweep` event was logged. The file also has no build constraint, unlike its sibling `verify/probe_sweep_test.go`.

The finding was reproduced on current main (see Feasibility). The test was compiled with `go test -c -overlay` (overlay files outside the checkout) against broken copies of the production code, and it stayed green in each case:
- `no-sweep`: the `logSweep(pr.Log, "probe", stepMarker, runID, markerFile)` call in `verify/probe.go` `Probe.Run` is removed, so there is no marker sweep and no event.
- `event-only-no-reaper-stop`: that call is replaced by logging a `step_sweep` event named `probe` that stops nothing. In addition, the probe's Linux subreaper helper (`stopAdoptedChildren` in `verify/sweep_linux.go`) still reaps exited children but leaves every live adopted child running: its `if syscall.Kill(p.pid, sig) == syscall.EPERM {` becomes `if sig != 0 {`. The escaped child is then still alive when `Run` returns, and it was observed alive.

The reproduction holds, so the test is fixed. Only test code changes. Production code (`verify/probe.go`, `verify/sweep.go`, `verify/sweep_linux.go`, `verify/env.go` and the rest) stays byte-identical. The acceptance harness edits exact text in `verify/probe.go` and `verify/sweep_linux.go` through overlays, so changing either file breaks acceptance.

The outcome, all in `verify/probe_timeout_sweep_test.go`:

1. **Build constraint.** The file starts with the line `//go:build linux || darwin`, then a blank line, then `package verify`, like `verify/probe_sweep_test.go`. The test stays in this file under the name `TestProbeRealTimeoutEscaped`. It is not moved, renamed or split.
2. **Same scenario, observable child.** The probe still runs under `ContractProbeDeadline(1500*time.Millisecond, nil)` with the 11-second context. Its command is the existing one: a `python3 -c` fork whose child calls `os.setsid()` and sleeps 120 s, backgrounded, then `sleep 1; echo launched; sleep 120`. One change: before sleeping, the escaped child writes its own pid to a pid file in a test temporary directory (`t.TempDir()`), outside the probe root, as `TestProbeSweepsEscapedChildAndPreservesAccounting` does. Pass the path in with `%q` formatting. The probe gets a logger through `Probe.Log`; reuse the existing test logger `sweepLog` (or `memLog`).
3. **Assertions after `Run` returns.** Keep `err == nil && r.TimedOut`. Read and parse the pid file, failing if it is missing or invalid. Register a SIGKILL of that pid (`defer syscall.Kill(pid, syscall.SIGKILL)`) so a failing run leaves no sleeper. Assert that no live, non-zombie process has that pid, using the existing `listProcs()` as the sibling test does. Assert that the logger received exactly one event, with `event` equal to `step_sweep` and `name` equal to `probe`. Do not assert the `stopped` count. On Linux the probe's subreaper already stops the escaped child before the marker sweep runs, so main logs `stopped: 0` here (observed). Each failure message names what is wrong (child pid still alive, or the events seen).

The Problem also says that the 200 ms overhead check counts scratch setup. That check is the quiet-probe scenario of the k-verify-probe-sweep-escaped acceptance steps, not `TestProbeRealTimeoutEscaped`, and the Need's fix list does not include it. It is left unchanged; see Source comparison.

Every existing test stays green. No golden, setting, dependency or unrelated file changes.

## Decisions
- Demonstrate first. On current main, the test stays green when the probe sweep is removed (`no-sweep`) and when the escaped child survives (`event-only-no-reaper-stop`). The reproduction held, so the fix proceeds. (source: request)
- Assert both survivor death (the escaped child's pid is not a live process after `Run`) and the sweep event (exactly one `step_sweep` named `probe`). (source: request)
- Add `//go:build linux || darwin` to `verify/probe_timeout_sweep_test.go`. (source: request)
- Keep every existing test green; make no unrelated changes. Production code is not modified. Acceptance runs the existing probe and sweep tests nearest this test, because the whole `verify` package takes about 140 s, longer than the 120-second step limit. The configured `go-test` check runs the full suite. (source: request)

## Source comparison
- Addressed: "It checks only `TimedOut`, not that the escaped child died or a sweep event was logged" / "Assert survivor death and the sweep event". Outcome 2 and 3. Acceptance scenario 1: `no-sweep` must fail and `unchanged` must pass. Acceptance scenario 2: `event-only-no-reaper-stop` must fail, and `no-reaper-stop` must pass, which shows that the marker sweep alone kills the child when the reaper leaves it running.
- Addressed: "It has no `linux||darwin` build tag" / "Add the tag". Outcome 1. Acceptance scenario 3 requires the exact first line `//go:build linux || darwin`.
- Addressed: "First show it: … demonstrate on current main that breaking the behaviour it claims to check leaves it green". Both broken variants left the current test green on main, as did `unchanged` and `no-reaper-stop` (Feasibility). Scenarios 1 and 2 fail on main for exactly that reason.
- Addressed: "Then fix it so the test fails on the broken behaviour and passes on main". The scenarios run the real test binary of the built tree: `unchanged` and `no-reaper-stop` must pass; `no-sweep` and `event-only-no-reaper-stop` must report `--- FAIL: TestProbeRealTimeoutEscaped`.
- Addressed: "Keep every existing test green; no unrelated changes". Acceptance scenario 4 runs the existing probe and sweep tests on the built tree and requires each to pass. The configured `go-test` check runs the whole suite. Only `verify/probe_timeout_sweep_test.go` changes.
- Addressed: "Where: TestProbeRealTimeoutEscaped". Only that test and its file change.
- Omitted: "The 200ms overhead test counts scratch setup". That measurement is the quiet scenario of `features/steps/k-verify-probe-sweep-escaped__steps.js`, which subtracts only a direct `sys` run from the whole `Probe.Run` time. It is not part of `TestProbeRealTimeoutEscaped`, and the Need's fix list ("Assert survivor death and the sweep event. Add the tag.") does not include it. Changing another Intent's acceptance would be an unrelated change here.
- Settled fact recorded, not changed: on Linux the probe command runs under its own subreaper helper (`acceptanceReaped`), which already kills the escaped child. That is why removing only the sweep keeps the child dead, and why the event assertion is what catches `no-sweep`.
- Superseded from the previous candidate: a variant that disabled the probe's subreaper completely cannot pass inside Kogen's acceptance run. Kogen's own acceptance helper is a lazy subreaper ancestor, so the timed-out probe's killed group members stay zombies there. sys timeout custody counts those zombies as group members, and `Run` returned `context deadline exceeded` with `TimedOut: false` after 11 s. The `no-reaper-stop` variant keeps reaping and removes only the stopping of live adopted children.

## Tests
- The timed-out escaped probe test requires exactly one probe `step_sweep` event: update `TestProbeRealTimeoutEscaped` to pass `Probe.Log` and assert exactly one event with `event` `step_sweep` and `name` `probe`; acceptance scenario 1 shows it fails with the `no-sweep` variant and passes unchanged (regression)
- The timed-out escaped probe test requires the escaped child to be dead when `Run` returns: update `TestProbeRealTimeoutEscaped` so the child writes its pid to a file, assert that the pid is not a live non-zombie process via `listProcs()`, and kill it on cleanup; acceptance scenario 2 shows it fails with `event-only-no-reaper-stop` and passes with `no-reaper-stop` (regression)
- `verify/probe_timeout_sweep_test.go` is built only on Linux and macOS: its first line is `//go:build linux || darwin`, checked by acceptance scenario 3 (scenario)
- Existing tests stay green: acceptance scenario 4 runs `TestProbeSweepsEscapedChildAndPreservesAccounting`, `TestProbeRefusalsDoNotLogSweep`, the probe deadline tests and two step sweep tests on the built tree, and the configured `go test ./...` runs the rest, including the goldens (existing)

## Feasibility
- Reproduction on unchanged main (4ae5fa0). Scratch overlays outside the checkout were built with `go test -c -overlay` and run with `-test.run '^TestProbeRealTimeoutEscaped$'`. The current test passed with `unchanged`, `no-sweep`, `no-reaper-stop` and `event-only-no-reaper-stop` (about 1.6 s, or 2.6 s with `no-reaper-stop`). These runs were made directly and also under a lazy outer subreaper (the verify test binary in its acceptance-reaper helper mode), which emulates Kogen's acceptance process tree. (probe: each exit 0, build about 3 s)
- Under that emulated outer subreaper, a variant that disabled the probe's subreaper completely reproduced Kogen's readiness observation: `r={Status:0 TimedOut:false …} err=context deadline exceeded` after 11.06 s. That variant was therefore replaced by `no-reaper-stop`.
- A candidate test as specified above was built against the same overlays. `unchanged` passed directly and under the emulated subreaper. `no-reaper-stop` passed under the emulated subreaper. `no-sweep` failed with `events: []`. `event-only-no-reaper-stop` failed under the emulated subreaper with `escaped child <pid> still alive`. A `stopped >= 1` assertion failed on unchanged main (`stopped: 0`, because the subreaper had already killed the child), so the Intent does not require it.
- The eight existing tests of scenario 4 passed on main in 2.0 s under the emulated subreaper.
- A real failing run of the named test prints `--- FAIL: TestProbeRealTimeoutEscaped (…)` with exit 1. An anchored filter that matches no test prints `testing: warning: no tests to run` and `PASS` with exit 0, which the harness reports as "ran zero times (absent)".
- No external protocol, provider or library uncertainty; no documentation lookup needed.
- evidence: {"id":"run-observer","kind":"observer","inputs":["features/steps/fix-k-verify-probe-sweep-escaped__harness.js"],"observers":["features/steps/fix-k-verify-probe-sweep-escaped__harness.js"],"checks":[{"name":"good","command":"node features/steps/fix-k-verify-probe-sweep-escaped__harness.js good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/fix-k-verify-probe-sweep-escaped__harness.js bad","exit":1,"output":"rejected\n"}]}
