Feature: No green without verification proof
  Scenario Outline: Every protected assertion needs exactly one final result
    When verification accounts for a real passing report altered by "<alteration>"
    Then the proof scenario is "<status>"

    Examples:
      | alteration       | status         |
      | complete         | passed         |
      | omit-test-step   | report_invalid |
      | omit-pickle-step | report_invalid |
      | omit-source-step | report_invalid |
      | duplicate-result | report_invalid |

  Scenario Outline: Valid model test names cannot suppress false assertions
    When verification checks the model run "<name>" asserting n equals <value>
    Then the model proof is "<state>"

    Examples:
      | name                     | value | state  |
      | TestRejectsBrokenBehavior | 1     | failed |
      | RejectTestBrokenBehavior | 1     | failed |
      | RejectBrokenBehaviorTest | 1     | failed |
      | TestRejectsBrokenBehavior | 0     | ok     |
      | RejectTestBrokenBehavior | 0     | ok     |
      | RejectBrokenBehaviorTest | 0     | ok     |
