# Sweep orphans after every verification step

Slug: k-verify-sweep-other-steps
Model: not applicable — each step gets its own one-shot sweep right after its command returns; nothing persists between steps or runs and no rules interact over time
Acceptance:
- .kogen/intents/k-verify-sweep-other-steps/acceptance.feature
- features/steps/sweep_steps_steps.js
- features/steps/sweep_steps_observer.js
- features/steps/testdata/sweepsteps/driver.go

Request K-VERIFY-SWEEP-OTHER-STEPS (kogen-verification), general mechanism. Package `verify`: `verify/env.go` (`runStepAs`), `verify/run.go` (`RunAcceptance`), `verify/sweep.go` (`stopAcceptanceProcesses`), `verify/attempt.go` and `verify/hung.go` (unchanged callers).

The code does this now. Only the acceptance command is swept. `verify/run.go` `RunAcceptance` is the only caller of `stopAcceptanceProcesses` (`verify/sweep.go`). It is also the only place that creates the per-run value (`newAcceptanceRunID`, carried as `KOGEN_ACCEPTANCE_RUN`) and the marker file held on descriptor 9 (`acceptanceScript`, wrapped on Linux by the subreaper helper `acceptanceReaped`). Every other project command goes through `runStepAs` (`verify/env.go`) and then either `Attempt.run` (`KillGroupOnExit: true` plus the step timeout) or `RunWatched` (whose `hung.go` rule only notices a process group with no member). A command that leaves a background server which changed group or session, for example `sh -c '(setsid sleep 301 &) ; echo ok'`, therefore leaves that server running after the step. It holds ports or locks and fails or hangs the next step or the builder's next run. On this runner, with the unchanged tree, such a server survives a setup step in a builder pass, a check step and a setup step under an approval Attempt, including one that timed out.

The product should do this. Every project command that verification runs through `runStepAs` is swept once it returns, by the same mechanism and safety rules as acceptance. That covers fix (`fix-N`), setup (`setup-N`, in `Verify` and in `Readiness.Setup`), project checks and stage checks, model checks (`CheckModel`), the runner check (`RunnerCheck`) and acceptance, with or without an approval Attempt. Each step writes one bounded `step_sweep` log event naming it. Its exit status, output, timeout result and errors are unchanged. One consequence follows from the request: a daemon that a setup or check command leaves running on purpose (for example a build tool's daemon) is now stopped after that step.

Required behavior, precisely:
- Scope: every command started through `runStepAs` (and so through `runStep` and `run`), on both of its paths: under an approval Attempt (`Attempt.run`, bounded by the attempt's step timeout) and without one (`RunWatched`). Out of scope, unchanged: probes and declared feasibility checks (`Probe.Run`/`probeRun`, run in their own scratch copy and session), and Kogen's internal commands (git, `ps`, `sysctl`, the Node step analysis, the `command -v` tool check).
- Per step, the same mechanism as acceptance today:
  - Before the command starts, create a fresh random value (as `newAcceptanceRunID`) and a fresh marker file: empty, mode 0600, in Kogen's temporary area, not kept open by Kogen.
  - Run the command as `exec 9<'<marker>'; exec /bin/sh -c '<command>'` (today's `acceptanceScript`), wrapped on Linux by the per-run subreaper helper (today's `acceptanceReaped`). On macOS and other platforms that wrapper returns the script unchanged, as today.
  - Environment marker: the acceptance step keeps exactly today's `KOGEN_ACCEPTANCE_RUN=<value>` together with `KOGEN_ACCEPTANCE_FEATURES` and `KOGEN_ACCEPTANCE_REPORT`, and gets no other marker variable. Every other step gets `KOGEN_STEP_RUN=<value>`, which replaces any inherited value.
  - If the value or the marker file cannot be created, `runStepAs` returns that error before anything starts (as `RunAcceptance` does today). If `ctx` is already done when `runStepAs` is called, it returns as today: nothing is created, run, swept or logged.
- Sweep: after the command returns, however it ends (any exit status, the Attempt's timeout, `sys.ErrTimeoutObservation`, `RunWatched`'s `command_no_progress` stop, an interrupt or a cancellation) and before `runStepAs` returns, run `stopAcceptanceProcesses`' selection and signal sequence with that step's own environment entry and marker file, then remove the marker file. The rules stay exactly those of `acceptanceTargets` and the sweep:
  - Select only processes of the current user that carry the step's entry or hold an open descriptor on its marker file (device and inode), plus their descendants by parent pid.
  - Never select Kogen's own process, its ancestors or zombies.
  - Send SIGTERM, wait the 5-second grace (`sweepGrace`), then SIGKILL; then take snapshots and SIGKILL until a snapshot finds none. A process that answers EPERM is not waited for again.
  - Processes the step did not start are never signalled: other steps, other runs and Builds, the user's own processes and other users' processes.
- Log: for each step whose `Logger` is non-nil, exactly one event, written after the sweep and before `runStepAs` returns, so between the step's `command` event and its `command_result` event when the caller writes those: `{"event":"step_sweep","name":<the name passed to runStepAs>,"stopped":<int>,"ms":<int>}`.
  - `stopped` is the number of distinct processes this sweep sent a signal to without EPERM. Processes that the Linux helper already stopped are not counted.
  - `ms` is the sweep's wall time in whole milliseconds.
  - Only when the process table cannot be read, the event also carries `"error": Cut(<error>)`. The sweep then ends there, and this is not an error of the step.
  - The event is written on the timeout and error paths too. With a nil Logger nothing is written; for example `Readiness` passes nil to `RunAcceptance` and to `RunnerCheck`.
  - The acceptance step writes the same `step_sweep` event; `acceptance_sweep_unavailable` is removed.
- Unchanged:
  - Each step's `sys.Result` (`Status`, `Output`, `TimedOut`) and the errors `runStepAs` returns.
  - The command text in the `command` log event, in `AttemptStep.Command` (redacted as today) and in what `RunWatched` reports: it stays the configured command, never the text that holds the marker.
  - `RunAcceptance`'s signature, its `Acceptance` fields and its `KOGEN_ACCEPTANCE_*` environment.
  - The Attempt records: the sweep adds no `AttemptStep`.
  - `sweepGrace` (5 s), `StepTimeout` (120 s) and `noLiveGrace`.
  - No new CLI command, flag or setting, and no change to the `kogen-loop/sys` module.
- Acceptance's sweep moves. Today `RunAcceptance` sweeps in a deferred call after its `command_result` event. Now the sweep runs in the shared step path, before `runStepAs` returns, so the acceptance step's `step_sweep` comes before its `command_result`. Everything else about acceptance stays as it is.
- Cost: a step that leaves no process costs one more process-table snapshot and the marker work, with no added waiting. Observed here, today's sweep with nothing to stop takes 20–40 ms. The whole per-step overhead stays under 200 ms.
- Boundary, unchanged from acceptance: on macOS a process that drops both markers (clears its environment and closes descriptor 9) and also leaves the session and its marked parent stays unattributable. On Linux the per-step subreaper helper still stops it.

Replaced: the doc comments of `run`, `runStep`, `runStepAs`, `RunAcceptance` and `stopAcceptanceProcesses` now describe the per-step sweep, with the marker variable named per step. Function names in `verify/sweep*.go` may be generalized. Removed: the `acceptance_sweep_unavailable` log event, now the `error` field of `step_sweep`.

Build notes:
- The acceptance driver `features/steps/testdata/sweepsteps/driver.go` is copied into a scratch copy as `verify/sweepsteps_acceptance_test.go` (package `verify`). Keep the internal names it uses: `newProj`, `proj.input`, `proj.readiness`, `fixture.session`, `fixtureSlug`, `NewAttempt`, `Attempt.timeout`, `Attempt.steps` (`Name`, `Status`), `Verify`, `Input.Log`, `Readiness.Check`/`Log`/`Attempt`, and `project.Check`.
- The driver sits in `testdata`, so `go build/vet/test ./...` skip it, but `gofmt -l .` still covers it.
- macOS has no `setsid` command. When `setsid` is not on PATH, the driver puts a stand-in first on PATH: `/usr/bin/perl` calling `POSIX::setsid()`, then `exec` of its arguments. The fixture command text stays the request's literal.
- The configured checks do not compile Linux files on this macOS runner. Run `GOOS=linux go vet ./...` as well.

## Decisions
- Every project command verification runs, not only acceptance, is swept after it returns by the same marker sweep and safety rules: current user only, never Kogen itself or its ancestors, bystanders untouched (source: request)
- Each step writes exactly one `*_sweep` log event naming the step; it is `step_sweep` with only the fields `event`, `name`, `stopped`, `ms` (plus `error` when the process table cannot be read) (source: request)
- The step's exit status and output are unchanged (source: request)
- A step that times out is swept too (source: request)
- A step that leaves no background process adds under 200 ms of wall time (source: request)

## Source comparison
- Problem (only acceptance is swept; other steps rely on process-group kill and `RunWatched`'s no-live-process rule): addressed by moving the per-run value, marker file, Linux subreaper wrapper and sweep into the shared step path `runStepAs`.
- Evidence (verify/run.go:303-318 the only `stopAcceptanceProcesses` caller; `newAcceptanceRunID`/marker only there; verify/env.go:126-141 `runStepAs`→`RunWatched`; hung.go:27; verify/attempt.go:153-158 `KillGroupOnExit` only): confirmed at HEAD b8b07d4.
- Need, "any project command run by verification (not only acceptance)": addressed for every command through `runStepAs` on both of its paths. Probes and declared feasibility checks (`Probe.Run`) are not verification steps run through `runStepAs`: they run in their own scratch copy and session, and the request's evidence does not name them. They stay unchanged.
- Need, "same mechanism and same safety rules (own user, never self or ancestors, bystanders untouched)": addressed (Required behavior, Sweep). Scenarios 1–3 check a bystander `sleep 302` that the test starts in its own session.
- Need, "one `*_sweep` log event naming the step": addressed by `step_sweep` with `name`. The acceptance-only `acceptance_sweep_unavailable` is superseded and removed, so that each step has exactly one sweep event.
- Need, "exit status and output of the command are unchanged": addressed; scenarios 1 and 2 compare against the control run.
- Synthetic acceptance, check and setup command `sh -c '(setsid sleep 301 &) ; echo ok'`: kept literally. Scenario 1 runs it as setup and check in a builder verification pass (`Verify`, the `RunWatched` path). Scenario 2 runs it as setup in an approval readiness check (`Readiness.Check` with an Attempt, the `Attempt.run` path). The control run ("control build") is the same command run in the same test through `sys.Session.Run` with today's per-step guard (`KillGroupOnExit`, the same timeout) and no sweep. It also proves that the command leaves a `sleep 301` running here.
- Synthetic item 1 (no `sleep 301` of the run survives after each step; bystander `sleep 302` alive): scenarios 1 and 2. Survivors are counted 300 ms after each step's `command_result` and again 1 s after the run. `sleep 301` processes that were already running are ignored.
- Synthetic item 2 (exit 0 and output `ok`, identical to the control): scenarios 1 and 2, with output `ok\n`.
- Synthetic item 3 (a step that times out is swept too): scenario 3. The setup step runs under an approval Attempt bounded to 2 seconds. The request gives no literal for a timing-out command, so the fixture is `sh -c '(setsid sleep 301 &) ; echo ok; sleep 30'`.
- Synthetic item 4 (no background process: the sweep event is not noisy, one bounded line per step; wall overhead under 200 ms): scenario 4 runs 3 builder passes with setup and check `echo ok`.
  - Every pass writes exactly one `step_sweep` for `setup-1`, `acceptance` and `check`, in that order, with only the fields `event, ms, name, stopped` and stopped 0.
  - Overhead is a step's median wall time (from its `command` event to its `command_result` event) minus the median of 3 control runs, and must be under 200 ms.
- macOS has no `setsid` command: the driver's PATH stand-in (`perl` `POSIX::setsid`) is used when none exists. On Linux the system `setsid` is used.

## Tests
- A setup or check step in a builder pass (no Attempt) stops a detached server the command left in a new session: new integration test in `verify/sweep_test.go`, `runStep` without an Attempt on a command that uses the existing `sweepDetach` launcher (environment cleared and kept), server gone within 5 s after it returns (integration); scenario `A builder verification pass stops the detached servers its setup and check commands leave` (scenario)
- A step under an approval Attempt is swept: new integration test, `runStep` under `NewAttempt(...).Into(ctx)` with the same fixture (integration); scenario `An approval readiness check stops the detached server its setup command leaves` (scenario)
- A step that times out is swept: new integration test, `runStep` under an Attempt whose `timeout` is shortened, on a command that detaches a server and then sleeps past the bound (integration); scenario `A setup step that times out is swept too` (scenario)
- Processes the step did not start are never signalled: new integration test, a process carrying another value of `KOGEN_STEP_RUN` and a detached process started while the step runs both survive a step (integration); existing `TestAcceptanceTargets` and `TestAcceptanceLeavesOtherRunsProcessesAlone` (existing); the bystander in scenarios 1–3 (scenario)
- Non-acceptance steps get a fresh `KOGEN_STEP_RUN` per step that replaces an inherited one, and the acceptance step keeps only `KOGEN_ACCEPTANCE_RUN`: new integration test that runs two setup-like steps and one RunAcceptance, each printing its environment (integration); existing `TestAcceptanceRunValueIsFreshPerRun` (existing)
- Exit status and output of a step are unchanged: scenarios 1 and 2 against the control run (scenario); existing command and model tests that read `command_result` (existing)
- The recorded and logged command of a non-acceptance step stays the configured command, and its marker file exists only for the step: new integration tests patterned on `TestAcceptanceRecordsTheConfiguredCommand` and `TestAcceptanceMarkerFileExistsOnlyForTheRun`, for a setup step (integration)
- Each step writes exactly one bounded `step_sweep` event naming it, before its `command_result`, with stopped 0 when nothing was left; acceptance included; `acceptance_sweep_unavailable` removed: scenario `Steps that leave no process write one bounded sweep line each and add under 200 ms` and the sweep-event steps of scenarios 1–3 (scenario)
- A step without a background process adds under 200 ms: scenario 4 (scenario)
- The Linux build compiles and vets: `GOOS=linux go vet ./...` during the Build, as in the existing k-verify-orphan-sweep-closefd scenario `The Linux build of the module and its tests compiles and vets` (existing)

## Feasibility
- Unchanged tree, this macOS runner (Darwin 25.6, arm64, Go 1.27.2): the driver reproduces the gap. The control run leaves one `sleep 301`, and so do the swept runs: in a builder pass after `setup-1` and after `check`, in a readiness check after `setup-1`, and 1 s after a readiness setup step timed out at 2 s (status 143). No `step_sweep` event is written. All four scenarios fail at their first judgement: 4 failed, 9 skipped steps. (local scratch run in this session, not a Kogen record)
- A scratch prototype (not submitted) made all four scenarios pass in 24 s, and `go test -count=1 ./...` still passed (verify 61 s). It moved the value, marker, `acceptanceReaped(acceptanceScript(...))` wrapping and a deferred sweep with a `step_sweep` event into a shared step function, used `KOGEN_STEP_RUN` for non-acceptance steps and counted signalled pids. Observed sweeps took 18–40 ms with nothing to stop and 93–117 ms when stopping one server. A pre-existing `sleep 301` started outside the run kept running. (local scratch runs in this session)
- `sys.Session.Run` waits up to 1 s (`WaitDelay`) for output pipes that a detached server still holds, then kills the group, so a step that leaves `sleep 301` takes about 1 s with or without the sweep. One cold first run lost the race with the `perl` stand-in before it called setsid; the driver now warms the stand-in once. (local scratch runs)
- evidence: {"id":"sweepsteps-observer","kind":"observer","inputs":["features/steps/sweep_steps_observer.js"],"observers":["features/steps/sweep_steps_observer.js"],"checks":[{"name":"good","command":"node features/steps/sweep_steps_observer.js good","exit":0,"output":"observer accepted\n"},{"name":"bad","command":"node features/steps/sweep_steps_observer.js bad","exit":1,"output":"observer rejected every known-bad report\n"}]}
