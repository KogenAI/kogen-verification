Feature: Render shared failures once without changing evidence
  Scenario Outline: Feedback preserves evidence and renders the requested case
    Then k-verify-shared-failure-once: feedback satisfies "<case>"
    Examples:
      | case       |
      | shared     |
      | distinct   |
      | bounded    |
      | normalized |
      | single     |
