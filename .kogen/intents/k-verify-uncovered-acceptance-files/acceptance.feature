Feature: Declared acceptance suite coverage
  Scenario Outline: Partial reports leave sorted informational coverage
    When an acceptance coverage pass uses "<mode>"
    Then acceptance coverage observations are:
      """
      {"green":true,"uncovered":["features/ch01.feature","features/ch02.feature"],"count":2,"lines":1,"bounded":true}
      """
    Examples:
      | mode |
      | partial |
      | glob |

  Scenario: Feedback stays bounded for 200 uncovered files
    When an acceptance coverage pass uses "many"
    Then acceptance coverage observations are:
      """
      {"green":true,"generatedCount":200,"count":200,"lines":1,"bounded":true}
      """

  Scenario: Required coverage fails naming both files
    When an acceptance coverage pass uses "strict"
    Then acceptance coverage observations are:
      """
      {"green":false,"uncovered":["features/ch01.feature","features/ch02.feature"],"count":2,"lines":1,"bounded":true,"failureNames":["features/ch01.feature","features/ch02.feature"]}
      """

  Scenario: Reports naming all three files leave no feedback
    When an acceptance coverage pass uses "all"
    Then acceptance coverage observations are:
      """
      {"green":true,"uncovered":[],"count":0,"lines":0,"bounded":true}
      """

  Scenario: No declaration matches the control pass
    When an acceptance coverage pass uses "none"
    Then acceptance coverage observations are:
      """
      {"control":true}
      """

  Scenario: Missing directory is a refusal
    When an acceptance coverage pass uses "missing"
    Then acceptance coverage observations are:
      """
      {"errorContains":"missing-features/"}
      """

  Scenario: Success without reported file execution is not coverage
    When an acceptance coverage pass uses "silent"
    Then acceptance coverage observations are:
      """
      {"green":true,"uncovered":["features/ch01.feature","features/ch02.feature","features/ch04.feature"],"count":3,"lines":1,"bounded":true}
      """
