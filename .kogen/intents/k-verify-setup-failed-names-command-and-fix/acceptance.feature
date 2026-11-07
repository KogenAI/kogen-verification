Feature: A failed setup command names its commands.setup entry and the next step

  The environment/setup_failed refusal keeps its first line, its exit code 3 and the command's
  output tail, then adds the failing command as written in commands.setup and what to do next.
  Shaping, a Build and a readiness check (preflight) all refuse through the same setup.

  Scenario Outline: A setup program that is not found, run by <entry>, names the command and the fix
    Given k-verify-setup-failed-names-command-and-fix: the setup commands:
      | command                      |
      | definitely-not-a-program --x |
    When k-verify-setup-failed-names-command-and-fix: <entry> runs the setup
    Then k-verify-setup-failed-names-command-and-fix: the refusal is "environment/setup_failed: Setup setup-1 failed (status=127)." with exit 3
    And k-verify-setup-failed-names-command-and-fix: the refusal has 3 detail lines
    And k-verify-setup-failed-names-command-and-fix: detail line 1 contains "definitely-not-a-program"
    And k-verify-setup-failed-names-command-and-fix: detail line 1 contains "not found"
    And k-verify-setup-failed-names-command-and-fix: detail line 2 is "commands.setup[0]: definitely-not-a-program --x"
    And k-verify-setup-failed-names-command-and-fix: detail line 3 is "next: the program was not found; fix commands.setup in .kogen/project.yaml (commit the change) or install what the command needs, then rerun the command that was refused"
    And k-verify-setup-failed-names-command-and-fix: the printed refusal has the detail line "commands.setup[0]: definitely-not-a-program --x"
    And k-verify-setup-failed-names-command-and-fix: the progress lines are exactly:
      | line                                                  |
      | kogen: running setup-1: definitely-not-a-program --x |

    Examples:
      | entry             |
      | shaping           |
      | a Build           |
      | a readiness check |

  Scenario Outline: A later setup command that exits 1, run by <entry>, keeps its output tail before the added lines
    Given k-verify-setup-failed-names-command-and-fix: the setup commands:
      | command                                   |
      | true                                      |
      | echo first; echo setup-broke >&2; exit 1 |
    When k-verify-setup-failed-names-command-and-fix: <entry> runs the setup
    Then k-verify-setup-failed-names-command-and-fix: the refusal is "environment/setup_failed: Setup setup-2 failed (status=1)." with exit 3
    And k-verify-setup-failed-names-command-and-fix: the detail lines are exactly:
      | line                                                                                                                                         |
      | first                                                                                                                                        |
      | setup-broke                                                                                                                                  |
      | commands.setup[1]: echo first; echo setup-broke >&2; exit 1                                                                                 |
      | next: fix commands.setup in .kogen/project.yaml (commit the change) or install what the command needs, then rerun the command that was refused |
    And k-verify-setup-failed-names-command-and-fix: the printed refusal has the detail line "commands.setup[1]: echo first; echo setup-broke >&2; exit 1"
    And k-verify-setup-failed-names-command-and-fix: the progress lines are exactly:
      | line                                                               |
      | kogen: running setup-1: true                                       |
      | kogen: running setup-2: echo first; echo setup-broke >&2; exit 1 |

    Examples:
      | entry             |
      | shaping           |
      | a Build           |
      | a readiness check |

  Scenario: With a diagnostic attempt the added lines follow the output and precede the step summary
    Given k-verify-setup-failed-names-command-and-fix: the setup commands:
      | command                                   |
      | true                                      |
      | echo first; echo setup-broke >&2; exit 1 |
    When k-verify-setup-failed-names-command-and-fix: a readiness check with a diagnostic attempt runs the setup
    Then k-verify-setup-failed-names-command-and-fix: the refusal is "environment/setup_failed: Setup setup-2 failed (status=1)." with exit 3
    And k-verify-setup-failed-names-command-and-fix: the detail lines start with:
      | line                                                                                                                                         |
      | first                                                                                                                                        |
      | setup-broke                                                                                                                                  |
      | commands.setup[1]: echo first; echo setup-broke >&2; exit 1                                                                                 |
      | next: fix commands.setup in .kogen/project.yaml (commit the change) or install what the command needs, then rerun the command that was refused |
    And k-verify-setup-failed-names-command-and-fix: detail line 5 starts with "Steps that ran, with wall time"
    And k-verify-setup-failed-names-command-and-fix: the last detail line starts with "Evidence: "

  Scenario Outline: A passing setup command, run by <entry>, prints none of the new lines
    Given k-verify-setup-failed-names-command-and-fix: the setup commands:
      | command |
      | true    |
    When k-verify-setup-failed-names-command-and-fix: <entry> runs the setup
    Then k-verify-setup-failed-names-command-and-fix: the setup passes
    And k-verify-setup-failed-names-command-and-fix: the progress lines are exactly:
      | line                         |
      | kogen: running setup-1: true |
    And k-verify-setup-failed-names-command-and-fix: nothing printed contains "commands.setup"
    And k-verify-setup-failed-names-command-and-fix: nothing printed contains ".kogen/project.yaml"
    And k-verify-setup-failed-names-command-and-fix: nothing printed contains "next:"

    Examples:
      | entry   |
      | shaping |
      | a Build |
