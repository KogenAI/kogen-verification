# Name the command and next step in runner refusal

Slug: runner-refusal-names-command-and-next-step
Model: not applicable — the change formats the lines of one refusal from fixed inputs and has no state
Acceptance:
- .kogen/intents/runner-refusal-names-command-and-next-step/acceptance.feature
- features/steps/runner-refusal-names-command-and-next-step__steps.js
- features/steps/runner-refusal-names-command-and-next-step__driver/main.go

When the acceptance runner check fails before the first shaping request, `RequireRunner` (verify/readiness.go) refuses with `environment/acceptance_unavailable`. Its `Lines` today are `Lines = strings.Split(Excerpt(output), "\n")`, only the output excerpt, so the refusal does not name the configured command or say what to change, and a silent runner yields one empty line. The reasons come from `RunnerCheck`: `the runner check failed with status N` and `the runner check wrote no report`. The refusal `Lines` become: the lines of the output excerpt (none when the output is empty or only white space, so no empty line), then one line `commands.acceptance.run: ` followed by the configured acceptance command passed through `(*Redactor)(nil).Redact`, then one `next:` line depending on the reason. The setup refusal's `commands.setup[<i>]: <command>` and `next: ` lines are the pattern to follow.

- non-zero exit: `next: fix commands.acceptance.run in .kogen/project.yaml (commit the change) so it exits 0 on a feature with no scenarios, then rerun the command that was refused`
- missing report: `next: fix commands.acceptance.run in .kogen/project.yaml (commit the change) so it writes a Cucumber Messages report to the file named by $KOGEN_ACCEPTANCE_REPORT, then rerun the command that was refused`

Unchanged: the refusal `Detail` and exit code 3, the `tool_missing` refusal, what `RunnerCheck` runs and its return values, its progress line `kogen: checking the acceptance runner`, the output excerpt policy (up to 60 lines, else the first 30, a marker and the last 20), and every other refusal. No new field, setting or configuration.

The Go unit tests live in verify/tools_test.go next to TestRequireRunnerRefusesAnUnavailableRunner. They use `sys.NewWith(testEnv(), root)` with `root` from `t.TempDir()`, `Tools{}`, a `project.Config` whose `Acceptance.Run` is the command, and the helpers `failWith`, `eq` and `eqSlice`. The existing test is updated: its output of 100 lines gives 53 entries (51 output lines, the command line and the next line) and `e.Lines[30]` stays the omission marker. Each wrong-implementation control runs only the focused tests, with `go test ./verify` and `-run` and the pattern of that test.

## Decisions
- The command line uses the pattern of the setup refusal, `commands.<name>: <command>` then `next: `, with the command masked by `(*Redactor)(nil).Redact` (evidence: verify/readiness.go) (source: request)
- Output lines come from `Excerpt` as today, but an output that is empty or only white space contributes no line (evidence: verify/text.go; verify/readiness.go) (source: request)
- The `next:` line is chosen by the reason from `RunnerCheck`: the non-zero-exit reason gets the exit-0 wording, the missing-report reason gets the report wording (evidence: verify/readiness.go) (source: request)
- Labelled secrets such as `--token abc123` are masked as `[REDACTED]` by the nil-Redactor Redact (evidence: verify/redact.go) (source: request)
- Acceptance observes the behavior through a small Go driver that calls the public `verify.RequireRunner`, so it does not depend on test names the Build must invent; the focused unit tests TestRequireRunnerFailureNamesCommandAndNextStep, TestRequireRunnerSilentFailureHasNoEmptyLine, TestRequireRunnerMissingReportSaysWhatToWrite and TestRequireRunnerMasksLabelledSecretsInTheCommand are still added to verify/tools_test.go (evidence: verify/tools_test.go; features/steps/envfailure_steps.js) (source: request)

## Source comparison
- Lines of the refusal for a failing runner: addressed, see Decisions and acceptance scenarios 1 to 5 (source: request)
- Detail, exit code 3, tool_missing refusal, RunnerCheck return values, progress line and excerpt policy: preserved unchanged; the first scenarios pin Detail and exit, the fifth pins the excerpt and marker (source: request)
- The setup refusal (verify/readiness.go): unchanged pattern reference only (source: request)

## Tests
- A failing runner with output names its command and the next step: TestRequireRunnerFailureNamesCommandAndNextStep in verify/tools_test.go (unit)
- A silent failing runner has no empty line: TestRequireRunnerSilentFailureHasNoEmptyLine in verify/tools_test.go (unit)
- A missing report gets its own next step: TestRequireRunnerMissingReportSaysWhatToWrite in verify/tools_test.go (unit)
- A labelled secret in the command is masked: TestRequireRunnerMasksLabelledSecretsInTheCommand in verify/tools_test.go (unit)
- The excerpt policy and Detail are unchanged, with 53 lines for a 100-line output: TestRequireRunnerRefusesAnUnavailableRunner updated in verify/tools_test.go (unit)

## Feasibility
- none
