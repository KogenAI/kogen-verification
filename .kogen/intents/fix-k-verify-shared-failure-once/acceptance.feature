Feature: Count blank failing problems and strip adjacent names in verification feedback

  Scenario: An empty failing problem in the omitted tail is counted
    When fix-k-verify-shared-failure-once: the feedback for case "empty" is rendered
    Then fix-k-verify-shared-failure-once: the feedback is at most 16384 bytes and its last line is "left out 2 items, 14731 bytes"

  Scenario: A whitespace-only failing problem in the omitted tail is counted
    When fix-k-verify-shared-failure-once: the feedback for case "whitespace" is rendered
    Then fix-k-verify-shared-failure-once: the feedback is at most 16384 bytes and its last line is "left out 2 items, 14737 bytes"

  Scenario: Adjacent scenario name occurrences are stripped before grouping
    When fix-k-verify-shared-failure-once: the feedback for case "adjacent-scenarios" is rendered
    Then fix-k-verify-shared-failure-once: the feedback is:
      """
      Verification pass 1 is not green. Fix the implementation (the approved acceptance files cannot change), then call finish again.
      acceptance (stub): failed, exit status 1
        has data
        2 scenarios: a, b
      """

  Scenario: Adjacent check name occurrences are stripped before grouping
    When fix-k-verify-shared-failure-once: the feedback for case "adjacent-checks" is rendered
    Then fix-k-verify-shared-failure-once: the feedback is:
      """
      Verification pass 1 is not green. Fix the implementation (the approved acceptance files cannot change), then call finish again.
        : has data
        2 checks: one, two
      """
