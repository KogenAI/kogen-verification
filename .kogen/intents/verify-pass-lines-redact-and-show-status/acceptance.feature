Feature: Verification pass command and status lines are redacted and complete
  This feature runs a real verification pass whose setup and check commands carry labelled secrets, a stopped wait on such a command, and failed-pass summaries.

  Scenario: The pass redacts the setup progress line and setup command event
    When verify-pass-lines-redact-and-show-status: the verification pass, the withheld-result wait and the pass summaries have run
    Then verify-pass-lines-redact-and-show-status: the progress line is exactly "kogen: running setup-1: true --token [REDACTED]"
    And verify-pass-lines-redact-and-show-status: stderr does not contain "abc123"
    And verify-pass-lines-redact-and-show-status: the "setup-1" command event has the command exactly "true --token [REDACTED]"

  Scenario: The pass redacts a project check command event
    When verify-pass-lines-redact-and-show-status: the verification pass, the withheld-result wait and the pass summaries have run
    Then verify-pass-lines-redact-and-show-status: the "lint" command event has the command exactly "true password=[REDACTED]"

  Scenario: The pass record keeps the configured commands
    When verify-pass-lines-redact-and-show-status: the verification pass, the withheld-result wait and the pass summaries have run
    Then verify-pass-lines-redact-and-show-status: the pass record keeps the commands "true --token abc123" and "true password=abc12345" and is complete

  Scenario: A stopped wait redacts the command
    When verify-pass-lines-redact-and-show-status: the verification pass, the withheld-result wait and the pass summaries have run
    Then verify-pass-lines-redact-and-show-status: the stop detail is exactly "acceptance had no live process for 50ms but its result never reached Kogen; stopped waiting for: true --token [REDACTED]"
    And verify-pass-lines-redact-and-show-status: the no-progress event command is exactly "true --token [REDACTED]"

  Scenario: A failing setup command shows its exit status
    When verify-pass-lines-redact-and-show-status: the verification pass, the withheld-result wait and the pass summaries have run
    Then verify-pass-lines-redact-and-show-status: the "first" summary is exactly "kogen: pass 1: setup-1 (exit 23) failed; not run because an earlier item failed: setup-2, acceptance"

  Scenario: The exit status comes from the setup entry of the same name
    When verify-pass-lines-redact-and-show-status: the verification pass, the withheld-result wait and the pass summaries have run
    Then verify-pass-lines-redact-and-show-status: the "second" summary is exactly "kogen: pass 2: setup-2 (exit 127) failed; not run because an earlier item failed: acceptance"

  Scenario: A setup item without a record shows no exit status
    When verify-pass-lines-redact-and-show-status: the verification pass, the withheld-result wait and the pass summaries have run
    Then verify-pass-lines-redact-and-show-status: the "none" summary is exactly "kogen: pass 3: setup-1 failed; not run because an earlier item failed: acceptance"
