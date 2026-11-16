# Name the command and next step for a missing

Slug: verify-tool-missing-names-command-and-next-step
Model: not applicable — the change formats the lines of one refusal from the configuration; there is no interacting state
Acceptance:
- .kogen/intents/verify-tool-missing-names-command-and-next-step/acceptance.feature
- features/steps/verify-tool-missing-names-command-and-next-step__steps.js

Problem: when the program of a configured command is not installed, Kogen refuses with a bare `environment/tool_missing: gofmt is not available` (the detail is the program name followed by ` is not available`), so the reader cannot tell which command in `.kogen/project.yaml` needs the program or what to do. Observed right after `kogen: running setup-2: npm ci --prefix testdata/tools/quint`: the project configures `gofmt -w .` as a fix command and `test -z "$(gofmt -l .)"` as the `format` check, and the message names neither. The refusal for a failing setup command (`Setup setup-1 failed (status=3).`, then the output, a line naming the setup command redacted with `r.Attempt.Redact(cmd)`, then a line that starts with `next: `) already names the command and the next step.

Every `environment/tool_missing` refusal of `RequireTools` (verify/readiness.go) gains `Lines` that say which configured command needs the missing program and the next step, in that setup-refusal form. `Detail` and the exit code 3 of every such refusal stay exactly as they are (`sys.Fail("environment", "tool_missing", word+" is not available", 3)`).

Lines of a refusal for a program that a configured command starts with: one line for each configured command whose first program word is that word, in the order Kogen runs them (setup, fix, checks, then acceptance), then one `next:` line that names the missing word, advises to install it or change that command in `.kogen/project.yaml` (commit the change), and to rerun the command that was refused. For the word `nope-tool` that line is exactly `next: install nope-tool or change that command in .kogen/project.yaml (commit the change), then rerun the command that was refused`. A command line is the key of the command in the configuration, then a colon and a space, then the command: `commands.setup[0]: nope-tool install` for the first setup command (zero-based index, as the setup refusal writes it), `commands.fix[0]: nope-tool fmt` for the first fix command, `commands.checks[cb]: nope-tool test` for the check named `cb`, and `commands.acceptance.run: nope-tool accept` for the acceptance command. Every command text goes through `(*Redactor)(nil).Redact`, the nil-safe labelled-pattern redaction already used in the package, so `--token abc123` shows as `--token [REDACTED]`.

For `$KOGEN_NODE` the last line is `next: reinstall Kogen, then rerun the command that was refused` instead (the advice `Tools.Require` already gives), after the command lines. For `git` the only line is `next: install git, then rerun the command that was refused`. The `/bin/sh` refusal (`/bin/sh is not available`) stays exactly as it is, with no `Lines`.

Constraints: no change to which programs are looked up, to the lookup order, to `command -v`, to the first-missing-wins order (git first, then the configured programs in order), to `Tools.Require`, `RequireInstall` and the install-tool refusals (`reinstall Kogen`), to the unterminated-quote internal error, or to anything run when `configured` is false (no configured command is looked at before a Build, so those refusals only have the `git` line). No new `Input` field, setting or configuration, and no change to the redaction patterns.

## Decisions
- The command key is built from the configuration (`commands.setup[i]`, `commands.fix[i]`, `commands.checks[<name>]`, `commands.acceptance.run`) in the order setup, fix, checks, acceptance (decision: D1, round 1) (evidence: verify/readiness.go) (source: request)
- `Detail` and exit 3 are unchanged, and only `Lines` is added, for every word except `/bin/sh` (decision: D2, round 1) (evidence: verify/readiness.go; verify/tools_test.go) (source: request)
- Acceptance observes behaviour through a same-package Go driver (`TestToolMissingDriver`, written into a scratch copy of the project) that calls the existing `RequireTools` and `RequireRunner`, so it does not depend on the unit tests the Build adds; the Build's own unit tests are the Tests lines below (decision: D3, round 1) (evidence: verify/tools_test.go; verify/helper_test.go) (source: request)
- The `git` refusal lists no command line even when a configured command starts with `git` (decision: D4, round 1) (assumption: the request states that `git` has only the next line; a configured `git` command is not named) (source: request)

## Source comparison
- Addressed in acceptance.feature, one scenario each: the `nope-tool --x` check named `cb`, the setup, fix and check commands in run order with zero-based indexes, `--token abc123` masked, the `definitely-not-a-tool` acceptance command labelled `commands.acceptance.run` (a wrong label would be `commands.checks[acceptance]: definitely-not-a-tool`; a wrong one-based index `commands.setup[1]`), the `$KOGEN_NODE` reinstall line, and the git-only line when the session is built with `testEnv("PATH="+emptyDir)` and `configured` is false. `Detail` and exit 3 are asserted in every scenario.
- Existing behaviour kept, pinned by TestMissingProgramsAreNamedAsToolMissingWithExit3 (verify/tools_test.go): the details `nope-tool is not available`, `./not-there is not available` and `nope-tool; is not available` (the last for the unusual `{ nope-tool; }`), and `$KOGEN_NODE is not available` from TestToolLookupResolvesKogenNodeFromTheCallersEnvironment. `cfg.NamedCommands()` still orders setup, fix, checks, acceptance and `words` still collects the first program word of each command; the new tests use `configWith`, `testEnv`, `failWith`, `eq` and `eqSlice`.
- Unchanged and covered by existing tests: the `/bin/sh` refusal, the unterminated-quote error, the install-tool refusals and the lookups when `configured` is false.

## Tests
- A check names its command and the next step: TestToolMissingNamesTheCheckAndNextStep in verify/tools_test.go (unit)
- Every command that needs the program is named in run order with zero-based indexes: TestToolMissingNamesEveryCommandThatNeedsTheProgram in verify/tools_test.go (unit)
- A labelled secret in the command is masked: TestToolMissingMasksLabelledSecretsInTheCommand in verify/tools_test.go (unit)
- The acceptance command is labelled as acceptance: TestRequireRunnerNamesTheAcceptanceCommandWhenItsProgramIsMissing in verify/tools_test.go (unit)
- A missing `$KOGEN_NODE` says reinstall: TestToolMissingKogenNodeSaysReinstall in verify/tools_test.go (unit)
- A missing git needs only a next step: TestMissingGitSaysInstallGit in verify/tools_test.go (unit)
- Detail and exit 3 of every refusal stay: TestMissingProgramsAreNamedAsToolMissingWithExit3 in verify/tools_test.go (existing)

## Feasibility
- evidence: {"id":"observer","kind":"observer","inputs":["features/steps/verify-tool-missing-names-command-and-next-step__steps.js"],"observers":["features/steps/verify-tool-missing-names-command-and-next-step__steps.js"],"checks":[{"name":"good","command":"node features/steps/verify-tool-missing-names-command-and-next-step__steps.js good","exit":0,"output":"good controls accepted\n"},{"name":"bad","command":"node features/steps/verify-tool-missing-names-command-and-next-step__steps.js bad","exit":1,"output":"bad controls rejected\n"}]}
