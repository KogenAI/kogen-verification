# Fit approval acceptance in the 120-second limit

Slug: k-verify-approval-acceptance-fits-step
Model: not applicable — an approval timeout refusal gains diagnostic lines read from the stopped run's own report, one step file builds its harness on first use instead of on every run, and the README gains a section; no workflow, readiness state, retry or setting is added
Acceptance:
- .kogen/intents/k-verify-approval-acceptance-fits-step/acceptance.feature
- features/steps/k-verify-approval-acceptance-fits-step__steps.js
- features/steps/k-verify-approval-acceptance-fits-step__observer.js
- features/steps/k-verify-approval-acceptance-fits-step__driver.js

Builds stop at approval with `intent/not_ready` because the approval's acceptance step exceeds the fixed 120-second `StepTimeout` (`verify/attempt.go`) and is stopped with its process group. Today the refusal (`environment/step_timeout`, exit 3, detail `Approval step acceptance timed out after <s> and was stopped with its process group (the step limit is 120s for each step on its own).`) shows the command, its output, the approval steps that ran and the host load, but not which Cucumber steps used the time, so slow step code (steps that build or run Go in every scenario) stays invisible. This Intent changes three things in this repository:

1. **The approval refusal of a timed-out acceptance step names the slowest Cucumber steps**, read from the Cucumber Messages report that the stopped run had written (contract below).
2. **`features/steps/probe_trust_steps.js` no longer builds its harness for every acceptance run.** Today its unconditional `BeforeAll` runs `go build -o <temp>/probetrust ./features/steps` whenever Cucumber loads `features/steps/*.js`. So every approval of every Intent in this repository pays that build, as does Kogen's runner check, which runs a feature without scenarios. Instead, the first step that needs the harness builds it, at most once per Cucumber run, with the same command and the same failure message. Later steps reuse it. `AfterAll` removes its folder only when one was created. Its step sentences and scenarios are otherwise unchanged. After the change, running the configured acceptance command over a feature that uses none of the Go-backed steps starts no `go` command at all.
3. **README.md gains the subsection `### Acceptance steps`**, at the end of `## Testing` (after `### Goldens`, before `## License`), holding exactly this paragraph (one line):
   Kogen's approval runs an Intent's acceptance with only that Intent's feature file, but Cucumber still loads every step file in `features/steps`, and the run has the fixed 120-second step limit. Step code therefore does no work when it is loaded or in hooks that run for every feature. A step that needs a Go program or test binary builds it once per run, on first use, and later scenarios reuse it instead of running `go build`, `go run` or `go test` again. Child processes are started asynchronously (not with `spawnSync` or `execFileSync`), so that Cucumber's report keeps the times of finished steps when a run is stopped.

Unchanged:
- `StepTimeout` stays the 120-second constant, and `NewAttempt` keeps giving every approval step that limit. It is not configurable. `ContractShapeAcceptanceDeadline` stays test-only. Scenario 1 observes the limit through an approval check with `NewAttempt`'s own bound: the refusal says `(each step has its own 120s limit)` and the record has `step_timeout_seconds` 120.
- The approval acceptance still passes only the Intent's own feature, `KOGEN_ACCEPTANCE_FEATURES=.kogen/intents/<slug>/acceptance.feature`; scenario 3 asserts it.
- Every other existing refusal line and its order stay as they are, and so does the `approval_attempt` record schema, apart from the new lines in `failure.lines`.
- A timeout of any other approval step (setup, model, check) gets no new line.
- The Shape-time acceptance refusal (`intent/not_ready`, `acceptance timed out`, `refuseShapeTimeout`) is unchanged, as are Build passes and every non-timeout result.
- Nothing is retried.
- Existing step files of completed Intents that run `go` inside their own scenarios are not rewritten: they run only for their own features.

### Refusal contract

When an approval attempt's step named `acceptance` times out, both when its process group was observed to end and when that could not be observed:

**Reading the report.** Kogen reads that run's `KOGEN_ACCEPTANCE_REPORT` file after the stop, before the report's temporary folder is removed.
- Each line that parses as a JSON object is a message. Other lines are ignored, such as a final line cut off by the stop. A missing or unreadable file has no messages.
- Cucumber writes this report asynchronously. Steps that block the event loop (`spawnSync`) leave it nearly empty; asynchronous steps leave it complete up to the running step (see Feasibility).

**Timed entries.**
- *Test step:* identified by `testCaseStartedId` and `testStepId`, from `testStepStarted.timestamp` and/or `testStepFinished.testStepResult.duration`.
- *Test-run hook* (`BeforeAll`/`AfterAll`): `testRunHookStarted` (`id`, `hookId`, `timestamp`) and/or `testRunHookFinished` (`testRunHookStartedId`, `result.duration`).
- *Wall time of a finished entry:* its duration (`seconds` + `nanos`).
- *Wall time of an entry started but not finished:* it is still running. Its wall time is the instant Kogen recorded as the acceptance step's end (`ended_at`) minus its start `timestamp`, never below 0.

**Labels.**
- A test step whose `testCase.testSteps[]` entry has `pickleStepId` (pickle reached via `testCaseStarted.testCaseId` → `testCase.pickleId`; Gherkin step via the pickle step's first `astNodeIds` entry) reads `acceptance.feature line <line>: <keyword without surrounding spaces> <pickle step text>`. This is the same form failure details already use.
- A hook, whether a test step with `hookId` or a run hook, reads `a hook at <sourceReference.uri> line <sourceReference.location.line>`, or `a hook (location not reported)` when the location is missing.
- Anything else unresolved reads `a step (location not reported)`.

**Order and cap.** Slowest first; equal wall times keep the order in which their first message appears. At most 5 entries are listed.

**Lines.** They are inserted after the command's output lines (the output block, `It wrote no output before it was stopped.` or `Its output could not be read.` with any output) and before `Steps that ran, with wall time (each step has its own <n>s limit):`.
- With at least one entry: `Slowest Cucumber steps before the stop (from its report, slowest first):`, then one line per entry. A finished entry reads `  <s>: <label>`; a still-running one reads `  <s>, still running when stopped: <label>`. Here `<s>` is the existing `fmtSeconds` format, e.g. `3.0s`.
- With no entry: the single line `Its Cucumber report recorded no step times before the stop.`

These lines pass through the attempt's redactor like every other line. Because they come before the `Evidence:` line, they are also kept in the retained `attempt.json` `failure.lines`.

Example (scenario 2, step bound contracted to 14 s): a fixture whose `BeforeAll` (line 2 of `features/steps/fixture_steps.js`) waits 1.5 s, with steps waiting 3000, 0, 800, 200, 0 and 60000 ms. The refusal lists, in order:
- `  <≈8s>, still running when stopped: acceptance.feature line 9: Then the fixture step waits 60000 ms`
- `  3.0s: acceptance.feature line 3: Given the fixture step waits 3000 ms`
- `  1.5s: a hook at features/steps/fixture_steps.js line 2`
- `  0.8s: acceptance.feature line 5: Then the fixture step waits 800 ms`
- `  0.2s: acceptance.feature line 7: Given the fixture step waits 200 ms`

The two 0 ms steps are left out by the cap.

### What the acceptance driver relies on

The acceptance driver is the Go source exported by `features/steps/k-verify-approval-acceptance-fits-step__driver.js`. It is written only into an acceptance copy as `verify/approvalfit_acceptance_test.go`. It uses these existing test and package identifiers, which must stay available with their current meaning:
- `newProj`, `fixtureSlug`, `cucumberRun`, `(*proj).readiness`, `write`, `commit`, `session`;
- `NewAttempt` and the unexported `Attempt.timeout`, which the driver sets only for the contracted-bound scenarios;
- `Readiness.Tools`, `Readiness.Attempt` and `Readiness.Check`;
- `project.FeaturePath`, `project.Acceptance` and `sys.AsError`.

## Decisions
- The approval step limit stays the fixed 120-second `StepTimeout`; no timeout increase and no setting. (source: request)
- The approval acceptance run passes only the Intent's own feature file (existing behaviour, kept and asserted). (source: request)
- Step code reuses one build per run instead of building per scenario or per step: this repository's step library starts no Go command for a feature that does not use a Go-backed step, and the README tells step code to build once per run on first use. (source: request)
- When the approval acceptance run still exceeds its limit, the refusal names the slowest steps with their wall times; when the run's report recorded none, the refusal says so. (source: request)
- Whether an approval acceptance of normal size now finishes within 120 seconds on the loaded build hosts of the other component repositories needs human evaluation on those hosts; no scenario here claims it. (source: request)

## Source comparison
- Addressed, Problem (approval acceptance stopped at the 120-second `StepTimeout` in `verify/attempt.go`, cause invisible): refusal contract above; scenarios 2–4.
- Addressed, Need "limit stays as it is (no timeout increase, no setting)": `StepTimeout` and `NewAttempt`'s bound are unchanged. Scenario 1 observes the 120-second limit in the approval refusal and its retained record.
- Addressed, Need "completes within the existing 120-second limit": two changes reduce approval time in this repository. Probe-trust's every-run `go build` is removed (scenario 5), and the README rule guides future step code (scenario 6). This Intent's own steps build one verify test binary per run with `go test -c` and start child processes asynchronously. The time on other repositories' bench hosts needs human evaluation (Decisions).
- Addressed, Need "runs only the Intent's own features": existing `RunAcceptance` behaviour, observed in scenario 3 (`features: .kogen/intents/fixture/acceptance.feature`).
- Addressed, Need "step code reuses one prebuilt binary for the run instead of building per scenario or per step": item 2 and the README section (scenarios 5 and 6). Omitted: rewriting step files of completed Intents that call `go` per scenario (for example `concurrent_steps.js`, `maintained_steps.js`, `uncovered_steps.js`). They run only for their own features, which approvals of other Intents do not run.
- Addressed, Need "the refusal names the slowest steps with their wall times": refusal contract above. Scenario 2 covers ordering, labels, still-running marking, wall-time bounds and the cap of five. Scenario 3 covers the case with no recorded step. Scenario 4 shows other steps' timeouts unchanged.
- Evidence (kogen-setup `k-setup-verify-total-budget` on kogen-bench-eu2, detail `environment/step_timeout: Approval step acceptance timed out after 120.1s and was stopped with its process group (the step limit is 120s for each step on its own).`, load5 2.52 → 2.33; kogen-build `k-build-budget-off-sweep-ms` on the MacBook at 12:06Z, plus the Shape readiness line `acceptance timed out: command exceeds the 120-second limit`): this is the existing refusal, kept unchanged apart from the new lines. Those repositories' step code is not in this checkout. They benefit from the refusal change because Kogen assembles this `verify` package.
- Omitted deliberately: the Shape-time refusal `acceptance timed out: command exceeds the 120-second limit` keeps its exact lines. The request's need names the approval step's refusal.
- Not in scope (request): raising `StepTimeout` or making it configurable.

## Tests
- The approval step limit stays 120 seconds without any setting: acceptance scenario 1 (approval check with `NewAttempt`'s own bound; refusal line and `step_timeout_seconds`); existing attempt tests unchanged (scenario)
- A timed-out approval acceptance step's refusal lists at most five report entries, slowest first, with Gherkin and hook labels, still-running marking and wall times; a cut-off final line is ignored: new unit tests in `verify` that write partial Cucumber Messages reports (finished steps, test-case and test-run hooks, an unfinished step, an unparsable last line, more than five entries) and check the produced lines (unit)
- The same lines appear, after the output and before the steps that ran, in an approval `Readiness.Check` whose real Cucumber acceptance is stopped, and are kept in the retained record's `failure.lines`: acceptance scenario 2 through the driver (scenario)
- An approval acceptance timeout whose report is missing or recorded no step says `Its Cucumber report recorded no step times before the stop.` right before the steps that ran: a new case next to the existing approval timeout tests in `verify` (integration) and acceptance scenario 3 (scenario)
- A timeout of another approval step (setup) gets no step-time line: acceptance scenario 4; existing approval timeout tests that pin exact acceptance-timeout lines are updated only by the inserted line(s) (regression)
- The approval acceptance passes only the Intent's own feature file: existing attempt and readiness tests unchanged, plus the output line asserted in scenario 3 (existing)
- Running the configured acceptance command over a feature without scenarios starts no `go` command (probe-trust builds its harness on first use, once per run): acceptance scenario 5 with a recording `go` first on `PATH` (scenario)
- README.md has the `### Acceptance steps` section with the exact paragraph: acceptance scenario 6 (scenario)

## Feasibility
- Cucumber 13.3.0 (the Kogen release's `KOGEN_CUCUMBER`) writes the `message` report through an asynchronous `fs.createWriteStream`. Two partial reports were read after SIGTERM of a run:
  - Steps blocking in `spawnSync`: the report held only `meta` and `source`.
  - Asynchronous steps: it held every message up to the running step's `testStepStarted`, including `hook` (`type`, `sourceReference.uri` relative such as `features/steps/s.js`, `location.line`), `testRunHookStarted`/`testRunHookFinished` with `result.duration`, and `testStepFinished.testStepResult.duration`. (probes 1–3: exit 143 as expected)
- The driver source (what `k-verify-approval-acceptance-fits-step__driver.js` exports) was installed in a scratch copy of the unchanged tree. It was gofmt-clean and `go test -c` succeeded. Results:
  - The timed Cucumber fixture at a 14 s bound refused `environment/step_timeout` (exit 3) with `Approval step acceptance timed out after 14.1s …`, lines `Command: …`, the output block `......`, `Steps that ran …`, load and `Evidence:`. It retained one `approval_attempt` record whose `failure.lines` equal the refusal lines before `Evidence:`.
  - The `echo features: $KOGEN_ACCEPTANCE_FEATURES; sleep 30` command showed `features: .kogen/intents/fixture/acceptance.feature`.
  - The setup case refused for `setup-1` with `setup-marker` and `Not run: acceptance`.
  - The observer rejected the unchanged cases only at the new lines. (probe 4: exit 0)
- The unchanged-limit case (no bound override, acceptance `echo quick-failure; exit 1`) on the unchanged tree refused `intent/not_ready` (exit 1). It showed `quick-failure` and `Steps that ran, with wall time (each step has its own 120s limit):`, and retained one `approval_attempt` record with `step_timeout_seconds` 120; the observer accepted it. (probe 7: exit 0)
- On the unchanged tree, the configured acceptance command over `Feature: Without scenarios`, with a recording `go` first on `PATH`, exited 0. It recorded exactly one call, `go build -o <temp>/probetrust-harness-…/probetrust ./features/steps`, from `probe_trust_steps.js` `BeforeAll`. That build alone took about 2 s on this host at load average 140–150. (probe 5: exit 0)
- A dry run of the submitted feature with the submitted steps bound all 6 scenarios and 49 steps. (probe 6: exit 0)
- evidence: {"id":"approvalfit-observer","kind":"observer","inputs":["features/steps/k-verify-approval-acceptance-fits-step__observer.js"],"observers":["features/steps/k-verify-approval-acceptance-fits-step__observer.js"],"checks":[{"name":"good","command":"node features/steps/k-verify-approval-acceptance-fits-step__observer.js good","exit":0,"output":"observer accepted\n"},{"name":"bad","command":"node features/steps/k-verify-approval-acceptance-fits-step__observer.js bad","exit":1,"output":"observer rejected\n"}]}
