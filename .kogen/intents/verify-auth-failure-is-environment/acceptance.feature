Feature: Unauthenticated model tool is an environment failure
  This feature checks that verify.EnvFailure reports the model tool authentication phrase from a failed check.

  Scenario: Authentication phrase in a failed check is reported trimmed
    When verify-auth-failure-is-environment: EnvFailure receives status 1 and output '  FAIL Bruno relevant (domain 1): Claude Code did not return a successful answer. Check authentication and model access.'
    Then verify-auth-failure-is-environment: its environment failure is true with line 'FAIL Bruno relevant (domain 1): Claude Code did not return a successful answer. Check authentication and model access.'

  Scenario: Authentication phrase with zero status is not a failure
    When verify-auth-failure-is-environment: EnvFailure receives status 0 and output '  FAIL Bruno relevant (domain 1): Claude Code did not return a successful answer. Check authentication and model access.'
    Then verify-auth-failure-is-environment: its environment failure is false with line ''

  Scenario: A failing test that quotes the phrase stays an ordinary failure
    When verify-auth-failure-is-environment: EnvFailure receives status 1 and output '--- FAIL: TestMessage (0.00s)\n    message_test.go:12: want error containing "Check authentication and model access", got nil\nFAIL\nexit status 1\n'
    Then verify-auth-failure-is-environment: its environment failure is false with line ''

  Scenario: The phrase line after an ordinary failing line is returned
    When verify-auth-failure-is-environment: EnvFailure receives status 1 and output 'ordinary failing line\nClaude Code did not return a successful answer. Check authentication and model access.\n'
    Then verify-auth-failure-is-environment: its environment failure is true with line 'Claude Code did not return a successful answer. Check authentication and model access.'

  Scenario: An earlier disk line wins over the phrase line
    When verify-auth-failure-is-environment: EnvFailure receives status 1 and output 'write /tmp/x: no space left on device\nClaude Code did not return a successful answer. Check authentication and model access.\n'
    Then verify-auth-failure-is-environment: its environment failure is true with line 'write /tmp/x: no space left on device'

  Scenario: The word authentication alone is not the phrase
    When verify-auth-failure-is-environment: EnvFailure receives status 1 and output 'Authentication failed for the deploy key'
    Then verify-auth-failure-is-environment: its environment failure is false with line ''
