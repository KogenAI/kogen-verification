Feature: Darwin procargs2 marker parser
  This feature checks that the parser of kern.procargs2 data used by the Darwin process sweep matches only an exact environment entry and tolerates malformed data.

  Scenario: A marker held by the environment matches
    When darwin-process-marker-parser-tests: the parser is given the procargs2 data "environment holds the marker" and the marker entry "KOGEN_MARK=run-1"
    Then darwin-process-marker-parser-tests: the parser reports a match

  Scenario: A marker that appears only in an argument does not match
    When darwin-process-marker-parser-tests: the parser is given the procargs2 data "only an argument holds the marker" and the marker entry "KOGEN_MARK=run-1"
    Then darwin-process-marker-parser-tests: the parser reports no match and does not panic

  Scenario Outline: A marker that is only a substring of an environment entry does not match
    When darwin-process-marker-parser-tests: the parser is given the procargs2 data "<data>" and the marker entry "KOGEN_MARK=run-1"
    Then darwin-process-marker-parser-tests: the parser reports no match and does not panic

    Examples:
      | data                                 |
      | environment entry extends the marker |
      | environment entry has a longer name  |

  Scenario Outline: Truncated or malformed procargs2 data does not match
    When darwin-process-marker-parser-tests: the parser is given the procargs2 data "<data>" and the marker entry "KOGEN_MARK=run-1"
    Then darwin-process-marker-parser-tests: the parser reports no match and does not panic

    Examples:
      | data                                 |
      | empty data                           |
      | two bytes                            |
      | argument count only                  |
      | unterminated executable path         |
      | unterminated argument                |
      | argument count exceeds the arguments |

  Scenario: The new Darwin test file covers the parser and passes
    When darwin-process-marker-parser-tests: the tests declared in "verify/sweep_darwin_test.go" are run
    Then darwin-process-marker-parser-tests: every declared test passes and the file is built only on darwin
