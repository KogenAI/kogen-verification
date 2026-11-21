Feature: A cohort of checks prints a line when each member ends

  This feature observes the end-of-command progress line of the parallel path through the two focused Go tests that already exist in the verify package.

  Scenario: The parallel path reports each member with its own seconds
    When verify-elapsed-line-parallel-cohort: the focused Go test "TestCohortMembersWriteEndedLines" runs
    Then verify-elapsed-line-parallel-cohort: the focused Go test "TestCohortMembersWriteEndedLines" reported PASS

  Scenario: A cancelled member writes no line
    When verify-elapsed-line-parallel-cohort: the focused Go test "TestCohortCancelledMemberWritesNoLine" runs
    Then verify-elapsed-line-parallel-cohort: the focused Go test "TestCohortCancelledMemberWritesNoLine" reported PASS
