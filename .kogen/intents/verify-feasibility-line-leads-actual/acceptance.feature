Feature: A feasibility mismatch line leads with the actual outcome

  Scenario: The mismatch line starts with the actual outcome so a 300-character cut still shows it
    When verify-feasibility-line-leads-actual: the feasibility checks with disagreeing probes have run
    Then verify-feasibility-line-leads-actual: the "boom" mismatch line begins with "actual exit 2: boom: cannot open file (expected exit 0)"

  Scenario: The summary is followed by the existing expected and actual text in full
    When verify-feasibility-line-leads-actual: the feasibility checks with disagreeing probes have run
    Then verify-feasibility-line-leads-actual: the "boom" mismatch line then carries the expected and actual text in full

  Scenario: A long multi-line output is shown as its first 120 characters on one line
    When verify-feasibility-line-leads-actual: the feasibility checks with disagreeing probes have run
    Then verify-feasibility-line-leads-actual: the "long" mismatch line begins with the first 120 characters of the output as one line followed by [cut]

  Scenario: Empty output reads as no output
    When verify-feasibility-line-leads-actual: the feasibility checks with disagreeing probes have run
    Then verify-feasibility-line-leads-actual: the "silent" mismatch line begins with "actual exit 3: (no output) (expected exit 0)"

  Scenario: A matching check gives no line and an exit-code-only mismatch gives one line
    When verify-feasibility-line-leads-actual: the feasibility checks with disagreeing probes have run
    Then verify-feasibility-line-leads-actual: the "match" check gives 0 mismatch lines
    And verify-feasibility-line-leads-actual: the "exitonly" check gives 1 mismatch lines
    And verify-feasibility-line-leads-actual: the "exitonly" mismatch line begins with "actual exit 4: ok (expected exit 0)"

  Scenario: Only the mismatching check of two gets a line
    When verify-feasibility-line-leads-actual: the feasibility checks with disagreeing probes have run
    Then verify-feasibility-line-leads-actual: the "mixed" check gives 1 mismatch lines
    And verify-feasibility-line-leads-actual: the "mixed" mismatch line begins with "actual exit 5: bad (expected exit 0)"
