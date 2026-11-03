Feature: Probes trust the project's tool configuration in temporary directories their run creates
  A declared control that copies the project into a second temporary directory it creates and runs
  the project's tool there passes when Kogen re-runs it as a probe: the probe gives its run a private
  temporary directory and trusts tool configuration in its scratch copy and that directory only.

  Background:
    Given a project whose tool configuration the tool manager trusts only at the project's own location
    And the project has the control "bin/second-tmp" that copies the project into a temporary directory it creates and runs greet there

  Scenario: A control that runs the project's tool in a temporary directory it creates passes as a probe
    When the control "sh bin/second-tmp" runs as a probe of the project
    Then it exits 0 with the output line "hello from the project tool"

  Scenario: The control's temporary directory is inside the probe's own temporary directory, which the probe removes
    When the control "sh bin/second-tmp" runs as a probe of the project
    Then nothing the probe created is left in the caller's temporary directory
    And the control created its temporary directory directly inside a "kogen-probe-tmp-" directory of the caller's temporary directory

  Scenario: A control that genuinely fails in a temporary directory it creates still fails as a probe
    When the control "sh bin/second-tmp --loud" runs as a probe of the project
    Then it exits 2 with the output line "greet: unknown option --loud"

  Scenario: A declared observer whose good control runs in a temporary directory it creates is met
    When the declared observer "billing" whose good control "sh bin/second-tmp" expects exit 0 and the output line "hello from the project tool" is executed for the project
    Then the declared evidence is met

  Scenario: A probe trusts no tool configuration in the caller's temporary directory
    Given the project has the control "bin/caller-tmp" that runs greet in a copy of the project in the caller's temporary directory
    When the control "sh bin/caller-tmp" runs as a probe of the project
    Then it exits 1 with output containing "are not trusted."

  Scenario: A probe trusts no tool configuration outside its copy of the project
    When the control "greet" runs as a probe of the project from a copy of the project elsewhere
    Then it exits 1 with output containing "are not trusted."
