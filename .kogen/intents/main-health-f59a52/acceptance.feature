Feature: The weakened-baseline main-health failure has a recorded owner and the guard stays

  This feature checks the written decision the Build leaves for the failing main-health scenarios and that the baseline guard of this repository is still enforced.

  Scenario: The written decision names the owning repository
    Given main-health-f59a52: the kogen-verification checkout is at its main head
    Then main-health-f59a52: a text file of the checkout names the owning repository

  Scenario: The written decision cites a file and a line
    Given main-health-f59a52: the kogen-verification checkout is at its main head
    Then main-health-f59a52: that text file cites a file and a line it read

  Scenario: The baseline guard of this repository still stops a pass
    When main-health-f59a52: the focused Go test "TestBaselineGuardRunsAfterEachFixerAndAfterThePass" runs
    Then main-health-f59a52: the focused Go test "TestBaselineGuardRunsAfterEachFixerAndAfterThePass" reported PASS
