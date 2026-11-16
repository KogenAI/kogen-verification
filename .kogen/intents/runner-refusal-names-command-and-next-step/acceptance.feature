Feature: Runner refusal names the command and the next step
  This feature covers the refusal of RequireRunner when the acceptance runner check fails.

  Scenario: A failing runner with output names its command and the next step
    Given runner-refusal-names-command-and-next-step: the acceptance command is:
      """
      echo boom; exit 7
      """
    When runner-refusal-names-command-and-next-step: the runner is required
    Then runner-refusal-names-command-and-next-step: the refusal is environment/acceptance_unavailable with exit code 3 and detail "the runner check failed with status 7; fix commands.acceptance.run in .kogen/project.yaml"
    And runner-refusal-names-command-and-next-step: the refusal lines are exactly:
      """
      boom
      commands.acceptance.run: echo boom; exit 7
      next: fix commands.acceptance.run in .kogen/project.yaml (commit the change) so it exits 0 on a feature with no scenarios, then rerun the command that was refused
      """

  Scenario: A silent failing runner has no empty line
    Given runner-refusal-names-command-and-next-step: the acceptance command is:
      """
      sh -c 'exit 3'
      """
    When runner-refusal-names-command-and-next-step: the runner is required
    Then runner-refusal-names-command-and-next-step: the refusal is environment/acceptance_unavailable with exit code 3 and detail "the runner check failed with status 3; fix commands.acceptance.run in .kogen/project.yaml"
    And runner-refusal-names-command-and-next-step: the refusal lines are exactly:
      """
      commands.acceptance.run: sh -c 'exit 3'
      next: fix commands.acceptance.run in .kogen/project.yaml (commit the change) so it exits 0 on a feature with no scenarios, then rerun the command that was refused
      """

  Scenario: A missing report gets its own next step
    Given runner-refusal-names-command-and-next-step: the acceptance command is:
      """
      echo hi
      """
    When runner-refusal-names-command-and-next-step: the runner is required
    Then runner-refusal-names-command-and-next-step: the refusal is environment/acceptance_unavailable with exit code 3 and detail "the runner check wrote no report; fix commands.acceptance.run in .kogen/project.yaml"
    And runner-refusal-names-command-and-next-step: the refusal lines are exactly:
      """
      hi
      commands.acceptance.run: echo hi
      next: fix commands.acceptance.run in .kogen/project.yaml (commit the change) so it writes a Cucumber Messages report to the file named by $KOGEN_ACCEPTANCE_REPORT, then rerun the command that was refused
      """

  Scenario: A labelled secret in the command is masked
    Given runner-refusal-names-command-and-next-step: the acceptance command is:
      """
      true --token abc123 && exit 7
      """
    When runner-refusal-names-command-and-next-step: the runner is required
    Then runner-refusal-names-command-and-next-step: no refusal line contains "abc123"
    And runner-refusal-names-command-and-next-step: the refusal lines are exactly:
      """
      commands.acceptance.run: true --token [REDACTED] && exit 7
      next: fix commands.acceptance.run in .kogen/project.yaml (commit the change) so it exits 0 on a feature with no scenarios, then rerun the command that was refused
      """

  Scenario: A long output keeps its excerpt before the command and next lines
    Given runner-refusal-names-command-and-next-step: the acceptance command is:
      """
      seq 1 100; exit 7
      """
    When runner-refusal-names-command-and-next-step: the runner is required
    Then runner-refusal-names-command-and-next-step: the refusal has 53 lines and line 31 is "[... 50 lines omitted ...]"
