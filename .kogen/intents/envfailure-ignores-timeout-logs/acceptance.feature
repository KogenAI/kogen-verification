Feature: EnvFailure ignores timeout text logged by a failing test
  This feature checks that a timeout-looking line logged by a failing Go test is not an environment failure, while a real Go test timeout still is.

  Scenario: A timeout-looking line logged inside a failing test is not an environment failure
    When envfailure-ignores-timeout-logs: EnvFailure receives status 1 and output "--- FAIL: TestLog (0.00s)\n    log_test.go:9: captured output:\n    panic: test timed out after 1s\nFAIL\nexit status 1\nFAIL\texample.com/m\t0.002s\n"
    Then envfailure-ignores-timeout-logs: its environment failure is false with line ""

  Scenario: A real Go test timeout is still reported
    When envfailure-ignores-timeout-logs: EnvFailure receives status 1 and output "ok  \texample.com/m\t1.204s\npanic: test timed out after 10m0s\n\trunning tests:\n\t\tTestSlow (10m0s)\n\nFAIL\texample.com/b\t600.214s\nFAIL\n"
    Then envfailure-ignores-timeout-logs: its environment failure is true with line "panic: test timed out after 10m0s"

  Scenario: A real Go test timeout directly after a failing test's logged output is still reported
    When envfailure-ignores-timeout-logs: EnvFailure receives status 1 and output "--- FAIL: TestOne (0.00s)\n    one_test.go:5: boom\npanic: test timed out after 2s\n\trunning tests:\n\t\tTestSlow (2s)\n"
    Then envfailure-ignores-timeout-logs: its environment failure is true with line "panic: test timed out after 2s"

  Scenario: A real Go test timeout after a finished failing test is still reported
    When envfailure-ignores-timeout-logs: EnvFailure receives status 1 and output "--- FAIL: TestOne (0.00s)\n    one_test.go:5: boom\nFAIL\nFAIL\texample.com/m\t0.100s\npanic: test timed out after 1s\n\trunning tests:\n\t\tTestSlow (1s)\n"
    Then envfailure-ignores-timeout-logs: its environment failure is true with line "panic: test timed out after 1s"
