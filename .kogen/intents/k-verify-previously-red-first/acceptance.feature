Feature: Retry previously red verification items first
  Scenario: Stop on C without paying for A or B
    When k-verify-previously-red-first: I verify the "red" stub candidate
    Then k-verify-previously-red-first: the result is
      """
      {"trace":["C"],"checks":["C"],"green":false,"complete":false,"failing":["C"],"execution_order":["C"],"pulled_forward":["C"]}
      """
    Then k-verify-previously-red-first: the still-red pass saves the earlier stub wall
    When k-verify-previously-red-first: I verify the "default" stub candidate
    Then k-verify-previously-red-first: the control takes at least 0.8 seconds longer

  Scenario: A repaired C does not skip any earlier green item
    When k-verify-previously-red-first: I verify the "green" stub candidate
    Then k-verify-previously-red-first: the result is
      """
      {"trace":["C","A","B"],"checks":["C","A","B"],"green":true,"complete":true,"failing":[],"execution_order":["C","acceptance","A","B"],"pulled_forward":["C"]}
      """

  Scenario: A repaired C does not hide B becoming red
    When k-verify-previously-red-first: I verify the "b-red" stub candidate
    Then k-verify-previously-red-first: the result is
      """
      {"trace":["C","A","B"],"checks":["C","A","B"],"green":false,"complete":false,"failing":["B"],"execution_order":["C","acceptance","A","B"],"pulled_forward":["C"]}
      """

  Scenario: Setup remains a prerequisite even for priority work
    When k-verify-previously-red-first: I verify the "setup" stub candidate
    Then k-verify-previously-red-first: the result is
      """
      {"trace":["setup-1","C","A","B"],"checks":["C","A","B"],"green":true,"complete":true,"failing":[],"execution_order":["setup-1","C","acceptance","A","B"],"pulled_forward":["C"]}
      """

  Scenario Outline: Legacy scheduling and serialized records remain unchanged
    When k-verify-previously-red-first: I verify the "<mode>" stub candidate
    Then k-verify-previously-red-first: the result is
      """
      {"trace":["A","B","C"],"checks":["A","B","C"],"green":false,"complete":false,"failing":["C"],"identical":true}
      """
    Examples:
      | mode    |
      | default |
      | unknown |
