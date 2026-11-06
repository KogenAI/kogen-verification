Feature: The wall-time deadline test's clock starts at the first setup command

  TestWallTimeDeadlineAndNeverStarted in verify/wall_time_test.go runs in verify test binaries
  built with a go build overlay of one product variant each; the checkout is not edited.

  Scenario: The deadline test passes 300 times when the work before setup takes most of the old budget
    Given k-verify-wall-time-test-clock: the "slow-pre-setup" product variant is built
    When k-verify-wall-time-test-clock: TestWallTimeDeadlineAndNeverStarted runs 300 times against it
    Then k-verify-wall-time-test-clock: every run passes

  Scenario: The deadline test fails against a product that ignores the deadline
    Given k-verify-wall-time-test-clock: the "ignore-deadline" product variant is built
    When k-verify-wall-time-test-clock: TestWallTimeDeadlineAndNeverStarted runs 1 time against it
    Then k-verify-wall-time-test-clock: the test fails

  Scenario: The deadline test fails at its fallback deadline when the first setup command never starts
    Given k-verify-wall-time-test-clock: the "never-start" product variant is built
    When k-verify-wall-time-test-clock: TestWallTimeDeadlineAndNeverStarted runs 1 time against it
    Then k-verify-wall-time-test-clock: the test fails at its 30-second fallback deadline
