Feature: Durable host evidence for approval attempts
  Scenario Outline: Measure every step actually executed by readiness
    When an approval readiness attempt is "<outcome>"
    Then every executed step has retained host measurements

    Examples:
      | outcome |
      | passed  |
      | failed  |
      | timeout |
