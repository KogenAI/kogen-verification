Feature: Truthful approval timeout output
  Scenario: Retain ordinary partial output
    When acceptance times out with observation "normal" and output "partial-marker"
    Then the timeout output evidence is truthful

  Scenario: Distinguish unreadable output from silence
    When acceptance times out with observation "unknown" and output "partial-marker"
    Then the timeout output evidence is truthful

  Scenario: Preserve the genuinely silent timeout message
    When acceptance times out with observation "normal" and output ""
    Then the timeout output evidence is truthful
