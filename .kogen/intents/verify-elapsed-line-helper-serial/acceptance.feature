Feature: A serial verification pass prints a line when each command ends

  This feature observes the end-of-command progress line through the two focused Go tests that already exist in the verify package.

  Scenario: The line helper rounds half up and reports the exit status
    When verify-elapsed-line-helper-serial: the focused Go test "TestEndLine" runs
    Then verify-elapsed-line-helper-serial: the focused Go test "TestEndLine" reported PASS

  Scenario: A serial pass reports the commands that ran in order and none that did not
    When verify-elapsed-line-helper-serial: the focused Go test "TestSerialPassPrintsALineWhenEachCommandEnds" runs
    Then verify-elapsed-line-helper-serial: the focused Go test "TestSerialPassPrintsALineWhenEachCommandEnds" reported PASS
