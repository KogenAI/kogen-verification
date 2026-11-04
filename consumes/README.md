# Consumed contracts

These external-package tests exercise the pinned coordinator and loop directly, using
synthetic repositories, temporary directories and local shell processes. They run under
`go test ./...` without a consumer checkout or network. `contract/` specifies the
opposite direction: verification's own interfaces used by its consumers.

## Audit method

Inspect **all non-test imports** of the two modules, then trace the values passed through
aliases, parameters, result structs and receiver/member accesses in the listed files.
Searching for `project.`, `git.` and `sys.` alone misses methods and fields on values
such as `cfg`, `intent`, `m`, `r`, `s` and `mat`. Compile-only references do not prove
behavior. Assertions below describe the boundary actually exercised; they are not a
claim to test every feature of either producer. Tests should evolve with the pins and
the uses together.

## Coordinator source map

| Verification use | Imported API and consumed members / reliance | Direct assertions |
| --- | --- | --- |
| `readiness.go` inputs, Cached, checkClean, RecordPass; `feasibility.go` Declarations/validate; `run.go` model and acceptance; `stepcheck.go` OwnStepFiles | `project.CheckIntent`, `Intent` (Slug, Title, Model, Acceptance, Feasibility), `Intent.StepFiles`; validated intent and scenarios, list of non-feature acceptance files | `TestIntentBaselineFacts` checks title, slug, acceptance, feasibility bullets, no-model and model; `TestGherkinAndConfig` checks StepFiles |
| `model.go` CheckModel, `readiness.go` modelValue/modelOutcome, `run.go` model | `project.ModelSpec` None, Path, Invariants, Seed, Samples, Steps; parsed values passed to model commands and readiness JSON | `TestIntentBaselineFacts` checks both None and a parsed model's path, invariants and numeric strings |
| `run.go` runFeature; `report.go` ScenarioRecord, Account, coverageMatches; `stepcheck.go` StepAnalysis; `readiness.go` cachedUnexercised | `project.FeaturePath`, `ParseGherkin`, `Scenario` Name, Line, Tags, Steps, Outline; step Keyword, Text, Line; outline metadata. Scenario lines identify report cases; outline examples expand | `TestIntentBaselineFacts` checks feature path through the fixture and scenario name, line and step text/keyword/line and nil outline; `TestGherkinAndConfig` checks expansion, example line, tag, outline name, line, example count and rejection |
| `run.go` Fix/Verify, `pass.go` Complete, `readiness.go` setup/RequireTools/RunnerCheck | `project.Config` Setup, Fix, Checks (Name, Run), Acceptance (Run, StepsDir), `NamedCommands` (Name, Run) | `TestGherkinAndConfig` checks ordered command names and values and configured acceptance |
| `readiness.go` inputs/RecordPass | `project.Baseline`, `Hash`, `WritePackageFacts`; baseline paths, content identity, package facts JSON | `TestIntentBaselineFacts` checks included paths, changed-content hash and emitted facts fields/hash/state |
| `readiness.go` RecordPass, `attempt.go` retain, `text.go` | `project.EncodeJSON` compact deterministic JSON, unescaped HTML | `TestIntentBaselineFacts` checks sorted keys and string format |
| `run.go` Verify; `readiness.go` inputs/Check | `git.New`, `Repo.Head`, `Tree`, `Changed`, `Materialize`, `Materialized.Dir` and `Mutations`; candidate includes working files, scratch reproduces candidate and mutations are reported | `TestCandidateMaterialization` checks a committed synthetic repo, changed and untracked content, scratch bytes, initially clean and changed mutation list and changed tree paths. Temporary directories clean up the scratch and repository. |

## Loop source map

| Verification use | Imported API and consumed members / reliance | Direct assertions |
| --- | --- | --- |
| `env.go` runStepAs, `attempt.go` run, `probe.go` Run, `concurrent.go` runCohortCheck, `readiness.go` Setup, `run.go` runLogged | `sys.NewWith`, `Session.Env`, Cwd, Getenv, RunContext; `Options.Env`, Timeout, Context, KillGroupOnExit, RefuseForeignKill; `Result.Status`, Output, TimedOut, Rule | `TestCommand` checks explicit env override, cwd, combined output, nonzero status, closed stdin, timeout and no live groups after cleanup |
| `attempt.go`, `probe.go` timeout paths | `sys.ErrTimeoutObservation` error identity | `TestInterruptAndError` checks wrapped error identity; `TestCommand` checks observed timeout result |
| `concurrent.go`, `probe.go`, `hung.go`, `env.go` | `Session.Context`, Err, Interrupt, Groups and `Interrupted.Signal`; interruption propagation and process-group ownership | `TestInterruptAndError` checks context cancellation, first interrupt wins, recorded signal and refused subsequent run; `TestCommand` checks recorded groups and no live group after timeout |
| `env.go`, `attempt.go`, `feasibility.go`, `readiness.go`, `hung.go`, `concurrent.go` | `sys.Fail`, `Error` Class, Reason, Detail, Lines, Exit, `AsError`; failure information and wrapped identity | `TestInterruptAndError` checks fields, rendered detail lines and wrapped error extraction |
| `run.go`, `readiness.go`, `sweep.go` | `sys.TmpPath` returns an unused temporary path to be created/removed by verification | `TestTmpPath` checks nonexistence and cleanup |
| `sweep.go` | `sys.Terminate` cleanup grace is referenced in a comment, not invoked | timeout cleanup is exercised by `TestCommand` through `KillGroupOnExit` |
