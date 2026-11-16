Feature: The failed pass progress line shows the exit status of failing project checks

  This feature checks Pass.Summary in the verify package for passes whose failing items are project checks with an exit status.

  Scenario: A single failing check shows its exit status
    When verify-failed-pass-line-shows-exit-status: the example pass summaries have been computed
    Then verify-failed-pass-line-shows-exit-status: the "single" summary is exactly "kogen: pass 1: test (exit 1) failed"

  Scenario: Several failing checks keep the order of Failing and each shows its exit status
    When verify-failed-pass-line-shows-exit-status: the example pass summaries have been computed
    Then verify-failed-pass-line-shows-exit-status: the "several" summary is exactly "kogen: pass 2: lint (exit 2), test (exit 1) failed"

  Scenario: A failing acceptance item without a Checks entry is written as before
    When verify-failed-pass-line-shows-exit-status: the example pass summaries have been computed
    Then verify-failed-pass-line-shows-exit-status: the "acceptance" summary is exactly "kogen: pass 3: acceptance failed (1 of 1 scenarios: A:9)"
