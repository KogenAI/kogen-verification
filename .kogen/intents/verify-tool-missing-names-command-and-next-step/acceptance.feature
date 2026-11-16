Feature: A missing program names the command that needs it and the next step

  This feature calls RequireTools and RequireRunner in a temporary copy of the project; no configured command is ever run.

  Scenario: Check names its command and the next step
    When verify-tool-missing-names-command-and-next-step: the missing programs have been looked up in a temporary copy of the project
    Then verify-tool-missing-names-command-and-next-step: the "one-check" refusal is environment/tool_missing with exit 3, detail "nope-tool is not available" and exactly these lines:
      """
      commands.checks[cb]: nope-tool --x
      next: install nope-tool or change that command in .kogen/project.yaml (commit the change), then rerun the command that was refused
      """

  Scenario: Every command that needs the program is named in run order
    When verify-tool-missing-names-command-and-next-step: the missing programs have been looked up in a temporary copy of the project
    Then verify-tool-missing-names-command-and-next-step: the "every-command" refusal is environment/tool_missing with exit 3, detail "nope-tool is not available" and exactly these lines:
      """
      commands.setup[0]: nope-tool install
      commands.fix[0]: nope-tool fmt
      commands.checks[cb]: nope-tool test
      next: install nope-tool or change that command in .kogen/project.yaml (commit the change), then rerun the command that was refused
      """

  Scenario: A labelled secret in the command is masked
    When verify-tool-missing-names-command-and-next-step: the missing programs have been looked up in a temporary copy of the project
    Then verify-tool-missing-names-command-and-next-step: the "secret" refusal is environment/tool_missing with exit 3, detail "nope-tool is not available" and exactly these lines:
      """
      commands.checks[cb]: nope-tool --token [REDACTED]
      next: install nope-tool or change that command in .kogen/project.yaml (commit the change), then rerun the command that was refused
      """

  Scenario: The acceptance command is labelled as acceptance
    When verify-tool-missing-names-command-and-next-step: the missing programs have been looked up in a temporary copy of the project
    Then verify-tool-missing-names-command-and-next-step: the "acceptance" refusal is environment/tool_missing with exit 3, detail "definitely-not-a-tool is not available" and exactly these lines:
      """
      commands.acceptance.run: definitely-not-a-tool
      next: install definitely-not-a-tool or change that command in .kogen/project.yaml (commit the change), then rerun the command that was refused
      """

  Scenario: A missing $KOGEN_NODE says reinstall
    When verify-tool-missing-names-command-and-next-step: the missing programs have been looked up in a temporary copy of the project
    Then verify-tool-missing-names-command-and-next-step: the "kogen-node" refusal is environment/tool_missing with exit 3, detail "$KOGEN_NODE is not available" and exactly these lines:
      """
      commands.checks[ca]: "$KOGEN_NODE" --version
      next: reinstall Kogen, then rerun the command that was refused
      """

  Scenario: A missing git needs only a next step
    When verify-tool-missing-names-command-and-next-step: the missing programs have been looked up in a temporary copy of the project
    Then verify-tool-missing-names-command-and-next-step: the "git" refusal is environment/tool_missing with exit 3, detail "git is not available" and exactly these lines:
      """
      next: install git, then rerun the command that was refused
      """
