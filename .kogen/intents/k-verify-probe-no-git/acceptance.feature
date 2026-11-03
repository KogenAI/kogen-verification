Feature: Explain Git failures in disposable probe copies
  Background:
    Given a project whose tool configuration the tool manager trusts only at the project's own location
    When the control "git init -q && git config probe.sentinel original && printf 'ready\n'" runs in the project with the caller's environment
    Then it exits 0 with the output line "ready"

  Scenario: Git failure identifies the scratch copy rather than the project
    When the control "git status --short" runs as a probe of the project
    Then it exits 128 with output containing "fatal: not a git repository"
    And it exits 128 with output containing "probe copy has no git metadata"

  Scenario: Handling the Git failure does not lose its explanation
    When the control "git status --short; exit 0" runs as a probe of the project
    Then it exits 0 with output containing "fatal: not a git repository"
    And it exits 0 with output containing "probe copy has no git metadata"

  Scenario: Git and worktree writes remain isolated
    When the control "touch scratch-only; git config probe.sentinel changed; git status --short" runs as a probe of the project
    Then it exits 128 with output containing "probe copy has no git metadata"
    When the control "test ! -e scratch-only && git config --get probe.sentinel" runs in the project with the caller's environment
    Then it exits 0 with the output line "original"

  Scenario: Unrelated successful output remains exact
    When the control "printf 'unchanged\n'" runs as a probe of the project
    Then it exits 0 with the output line "unchanged"
