Feature: Pin step analysis ordering with direct tests
  This feature adds coverage only in verify/stepcheck_test.go. Analysis and readiness stay unchanged.
  Fixtures include own JavaScript files in nonalphabetical acceptance order, other files in
  alphabetical order, and repeated texts across and within scenarios. The tests call
  StepAnalysis for the default directory and StepAnalysisIn for default and nested directories.
  Temporary production mutations test the strength of the new assertions, not new behavior.

  Background:
    Given step-analysis-order-contract: the existing step analysis test file is available

  Scenario: Own files precede sorted other files
    Then step-analysis-order-contract: its tests reject "files" while passing unchanged analysis

  Scenario: Distinct texts retain first-seen order
    Then step-analysis-order-contract: its tests reject "repeated,texts" while passing unchanged analysis

  Scenario: Cover configured nested step directories
    Then step-analysis-order-contract: its tests reject "configured" while passing unchanged analysis
