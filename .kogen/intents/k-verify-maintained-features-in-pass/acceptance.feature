Feature: Maintained features are ordinary verification items
  Scenario: Explicit features run after models and report a failing scenario
    When a verification pass receives the "pair" maintained feature list
    Then the maintained feature observations equal:
      """
      {"record.green":false,"record.maintained_features.0.path":"spec/green.feature","record.maintained_features.0.result.passed":2,"record.maintained_features.1.path":"spec/red.feature","record.maintained_features.1.result.passed":0,"record.checks":[],"record.failing":["spec/red.feature"],"trace":[".kogen/intents/fixture/acceptance.feature","model","model","spec/green.feature","spec/red.feature"]}
      """
    And maintained feature feedback contains "spec/red.feature"
    And maintained feature feedback contains "First"

  Scenario: A nonexistent candidate feature is a failed item
    When a verification pass receives the "missing" maintained feature list
    Then the maintained feature observations equal:
      """
      {"record.green":false,"record.maintained_features.0.path":"spec/missing.feature","record.failing":["spec/missing.feature"],"record.checks":[]}
      """
    And maintained feature feedback contains "spec/missing.feature"

  Scenario: Empty lists preserve the control bytes
    When a verification pass receives the "empty" maintained feature list
    Then the maintained feature observations equal:
      """
      {"record.green":true,"sameRecord":true,"sameFeedback":true,"trace":[".kogen/intents/fixture/acceptance.feature","model","model","check"]}
      """

  Scenario: Checkout movement invalidates a green feature result
    When a verification pass receives the "move" maintained feature list
    Then the maintained feature observations equal:
      """
      {"record.green":false,"record.maintained_features.0.path":"spec/green.feature","record.maintained_features.0.result.passed":2,"record.moved":["spec/green.feature"],"record.failing":[],"trace":[".kogen/intents/fixture/acceptance.feature","model","model","spec/green.feature","check"]}
      """
