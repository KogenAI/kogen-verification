# Confirm checks_wall_ms finding does not reproduce

Slug: fix-k-verify-check-wall-ms
Model: not applicable — no product behavior changes; this Intent only records executable evidence that the reported state does not occur
Acceptance:
- .kogen/intents/fix-k-verify-check-wall-ms/acceptance.feature
- features/steps/fix-k-verify-check-wall-ms__steps.js

An automated review of the landed k-verify-check-wall-ms commit reported two problems in verify/run.go (checksEnd). First, if a loop exit skips setting `checksEnd`, the pass event's `checks_wall_ms` becomes a huge negative number. Second, `started` detection through new process groups may drop `command_result` for commands that exit fast. The request is to first reproduce exactly this scenario with a test that fails on main, and, if it does not hold on main, to stop and report that it does not reproduce, with no code change. Only if it does reproduce should `checksEnd` be set on every exit, with a test using `true` or `echo`, keeping every existing test green and making no unrelated changes.

The scenario does not reproduce on main (f0e392e), so the outcome is the stop-and-report branch, with no product code change. The Build must not edit verify/run.go, verify/env.go or any other Go file, test or golden. The repository's existing behavior is the intended behavior and stays unchanged:
- In verify(), `tr.start` is set only when a loop item actually starts. Every started item that returns without an error sets `checksEnd` afterwards: the serial path at the end of each iteration, and the go build/vet cohort path immediately after runCohort. Items skipped after a red item never set `tr.start`. Every error path returns before the `pass` event, and Verify's `pass_aborted` event measures from `tr.start` with time.Since, not with `checksEnd`. So the `pass` event's `checks_wall_ms` is never negative. It is 0 when no item ran, for example an empty stage.
- kogen-loop's sys.Session never removes a group from Groups(), so a command that exits immediately still leaves the new group that runStepAs detects. Cohort members use captured.Started() instead. Every started `true` or `echo` command logs exactly one `command_result`.

The acceptance records this non-reproduction on the reported scenario: verification passes whose commands are `true` and `echo`, through the real Run and Verify entry points. It passes on the unchanged tree, and it would fail if `checks_wall_ms` were negative or a fast command's `command_result` were missing.

## Decisions
- Attempt reproduction first; because the scenario does not hold on main, stop and report non-reproduction with no code change. (source: request)
- Reproduce with `true` and `echo` commands. (source: request)
- Keep every existing test green and make no unrelated changes; the Build changes no file outside this Intent's acceptance artifacts. (source: request)

## Source comparison
- Addressed: the claim that a loop exit can skip setting `checksEnd` and make `checks_wall_ms` hugely negative. The serial, stage, empty-stage, setup-red and cohort scenarios assert that each pass logs exactly one `pass` event with an integer `checks_wall_ms` in [0, 120000), or exactly 0 when no item ran. It does not reproduce.
- Addressed: the claim that `started` detection may drop `command_result` for fast commands. Each scenario asserts the exact list of `command_result` names for fast `true`, `echo hi`, `exit 2` and `exit 3` commands: in order for serial passes, as a set for the concurrent cohort. It does not reproduce.
- Addressed: "If the scenario does not hold on main, stop and report that it does not reproduce (no code change)": no product edit is specified.
- Superseded by non-reproduction: the conditional "Set `checksEnd` on every exit" fix and its Go regression test. The request makes them conditional on reproduction, so they are not built.
- Noted, not the reported scenario: started detection compares process-group ids only, so it could misjudge a command only if the operating system reused the process id of a group recorded earlier in the same session. That depends on process-id reuse, not on fast exit, and cannot be reproduced deterministically with `true` or `echo`. No change is specified for it.

## Tests
- none: the reported failure does not reproduce on main and the request forbids a code change in that case. The acceptance scenarios record the non-reproduction through Run and Verify with `true` and `echo` commands. Existing tests stay unchanged and green.

## Feasibility
- A scratch copy of the repository, with an added test, ran Run and Verify five times with fix `true`; setup `true` and `echo hi`; checks `true`, `echo hi`, `exit 3` and `echo never`; a stage with `true` and `echo hi`; an empty stage; a setup that fails first with `exit 2`; and a go build/vet cohort using a stub go that runs `echo ok`. It logged `checks_wall_ms` between 19 and 157 ms (0 for the empty stage) and every expected `command_result`. Only the order of the two concurrent cohort results varied. (probe: go test ./verify -run '^TestZZProbe$' -count=1, 28 s)
- The submitted driver, written into a scratch copy and run as go test ./verify -run '^TestFixWallMsDriver$' -count=1 -v -timeout=100s, passed in 5.6 s. Its report matched every scenario expectation.
- evidence: {"id":"wall-observer","kind":"observer","inputs":["features/steps/fix-k-verify-check-wall-ms__steps.js"],"observers":["features/steps/fix-k-verify-check-wall-ms__steps.js"],"checks":[{"name":"good","command":"node features/steps/fix-k-verify-check-wall-ms__steps.js good","exit":0,"output":"good controls accepted\n"},{"name":"bad","command":"node features/steps/fix-k-verify-check-wall-ms__steps.js bad","exit":1,"output":"bad controls rejected\n"}]}
