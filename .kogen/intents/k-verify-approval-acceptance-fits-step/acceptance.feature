Feature: Approval acceptance fits the step limit and explains an overrun
  Each approval step keeps its fixed 120-second limit. When the approval's acceptance step
  exceeds its limit, the refusal names the slowest Cucumber steps that the run's own report
  recorded before the stop, with their wall times, or says that it recorded none. The
  repository's step library starts no Go command for a feature that uses none of its Go-backed
  steps. The fixtures contract the approval step bound; production keeps 120 seconds.

  Scenario: The approval step limit stays 120 seconds
    When k-verify-approval-acceptance-fits-step: an approval readiness check with its unchanged step limit runs the acceptance command "echo quick-failure; exit 1"
    Then k-verify-approval-acceptance-fits-step: the approval is refused with class "intent", reason "not_ready" and exit 1
    And k-verify-approval-acceptance-fits-step: the refusal shows the output line "quick-failure"
    And k-verify-approval-acceptance-fits-step: the refusal and its one retained approval attempt record give each approval step a limit of 120 seconds

  Scenario: An approval acceptance overrun names its slowest Cucumber steps with their wall times
    Given k-verify-approval-acceptance-fits-step: the fixture Intent's acceptance feature:
      """
      Feature: Timed fixture
        Scenario: Finished
          Given the fixture step waits 3000 ms
          When the fixture step waits 0 ms
          Then the fixture step waits 800 ms
        Scenario: Stuck
          Given the fixture step waits 200 ms
          When the fixture step waits 0 ms
          Then the fixture step waits 60000 ms
      """
    And k-verify-approval-acceptance-fits-step: the fixture's step file features/steps/fixture_steps.js:
      """
      const { BeforeAll, Given } = require('@cucumber/cucumber');
      BeforeAll(() => new Promise((resolve) => setTimeout(resolve, 1500)));
      Given('the fixture step waits {int} ms', { timeout: 120000 }, (ms) => new Promise((resolve) => setTimeout(resolve, ms)));
      """
    When k-verify-approval-acceptance-fits-step: an approval readiness check bounded at 14000 ms per step runs the real Cucumber over that fixture
    Then k-verify-approval-acceptance-fits-step: the approval is refused with step_timeout for the step "acceptance" and one retained approval attempt record
    And k-verify-approval-acceptance-fits-step: the refusal shows "Slowest Cucumber steps before the stop (from its report, slowest first):" after the output and before the steps that ran, followed by exactly these steps, slowest first:
      | step                                                            | still running | at least seconds |
      | acceptance.feature line 9: Then the fixture step waits 60000 ms | yes           | 1.0              |
      | acceptance.feature line 3: Given the fixture step waits 3000 ms | no            | 3.0              |
      | a hook at features/steps/fixture_steps.js line 2                | no            | 1.5              |
      | acceptance.feature line 5: Then the fixture step waits 800 ms   | no            | 0.8              |
      | acceptance.feature line 7: Given the fixture step waits 200 ms  | no            | 0.2              |
    And k-verify-approval-acceptance-fits-step: the refusal has no line "Its Cucumber report recorded no step times before the stop."

  Scenario: An approval acceptance overrun whose report recorded no step says so
    When k-verify-approval-acceptance-fits-step: an approval readiness check bounded at 2000 ms per step runs the acceptance command "echo features: $KOGEN_ACCEPTANCE_FEATURES; sleep 30"
    Then k-verify-approval-acceptance-fits-step: the approval is refused with step_timeout for the step "acceptance" and one retained approval attempt record
    And k-verify-approval-acceptance-fits-step: the refusal shows the output line "features: .kogen/intents/fixture/acceptance.feature"
    And k-verify-approval-acceptance-fits-step: the refusal says "Its Cucumber report recorded no step times before the stop." once, after the output and right before the steps that ran
    And k-verify-approval-acceptance-fits-step: the refusal has no line "Slowest Cucumber steps before the stop (from its report, slowest first):"

  Scenario: An overrun of another approval step gets no step-time lines
    When k-verify-approval-acceptance-fits-step: an approval readiness check bounded at 2000 ms per step runs the setup command "echo setup-marker; sleep 30"
    Then k-verify-approval-acceptance-fits-step: the approval is refused with step_timeout for the step "setup-1" and one retained approval attempt record
    And k-verify-approval-acceptance-fits-step: the refusal shows the output line "setup-marker"
    And k-verify-approval-acceptance-fits-step: the refusal has no line "Slowest Cucumber steps before the stop (from its report, slowest first):"
    And k-verify-approval-acceptance-fits-step: the refusal has no line "Its Cucumber report recorded no step times before the stop."
    And k-verify-approval-acceptance-fits-step: the refusal lists no slowest steps

  Scenario: The step library starts no Go command for a feature that uses none of its Go-backed steps
    When k-verify-approval-acceptance-fits-step: the configured acceptance command runs a feature without scenarios with a go command first on PATH that records each call
    Then k-verify-approval-acceptance-fits-step: that acceptance run exits 0
    And k-verify-approval-acceptance-fits-step: the go command was not started

  Scenario: The README tells step code to build once per run and run child processes asynchronously
    Then k-verify-approval-acceptance-fits-step: the README section "Acceptance steps" reads:
      """
      Kogen's approval runs an Intent's acceptance with only that Intent's feature file, but Cucumber still loads every step file in `features/steps`, and the run has the fixed 120-second step limit. Step code therefore does no work when it is loaded or in hooks that run for every feature. A step that needs a Go program or test binary builds it once per run, on first use, and later scenarios reuse it instead of running `go build`, `go run` or `go test` again. Child processes are started asynchronously (not with `spawnSync` or `execFileSync`), so that Cucumber's report keeps the times of finished steps when a run is stopped.
      """
