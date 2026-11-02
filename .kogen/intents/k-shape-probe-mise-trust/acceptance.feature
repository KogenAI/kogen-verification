Feature: Probes trust the project's tool configuration in their scratch copy
  A declared control that exits 0 in the project, where the caller's tool manager trusts the
  project's tool configuration, exits 0 when Kogen re-runs it as a probe in its scratch copy.
  A control that genuinely fails still fails, and the refusal names the control's own output.

  Background:
    Given a project whose tool configuration the tool manager trusts only at the project's own location

  Scenario: A control that passes in the project passes as a probe
    When the control "greet" runs in the project with the caller's environment
    Then it exits 0 with the output line "hello from the project tool"
    When the control "greet" runs in a copy of the project elsewhere with the caller's environment
    Then it exits 1 with output containing "are not trusted."
    When the control "greet" runs as a probe of the project
    Then it exits 0 with the output line "hello from the project tool"

  Scenario: A probe trusts no tool configuration outside its copy of the project
    When the control "greet" runs as a probe of the project from a copy of the project elsewhere
    Then it exits 1 with output containing "are not trusted."

  Scenario: A declared observer whose good control passes in the project is met
    When the declared observer "greeting" whose good control "greet" expects exit 0 and the output line "hello from the project tool" is executed for the project
    Then the declared evidence is met

  Scenario: A control that genuinely fails still fails as a probe
    When the control "greet --loud" runs in the project with the caller's environment
    Then it exits 2 with the output line "greet: unknown option --loud"
    When the control "greet --loud" runs as a probe of the project
    Then it exits 2 with the output line "greet: unknown option --loud"

  Scenario: The refusal of a genuinely failing observer control names the control's own error output
    When the declared observer "greeting" whose good control "greet --loud" expects exit 0 and the output line "hello from the project tool" is executed for the project
    Then the declared evidence is refused with "declared feasibility evidence failed"
    And the declared evidence is refused with "greeting/good"
    And the declared evidence is refused with "greet: unknown option --loud"
