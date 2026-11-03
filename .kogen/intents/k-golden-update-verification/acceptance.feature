Feature: Regenerate the goldens with the Go test flag -update

  The golden tests compare the code's actual output with the recorded outputs in
  verify/testdata/golden. Without the flag they fail on any drift and write nothing;
  `go test ./... -update` rewrites each drifted recorded output from the current code,
  keeps every recorded input and every unchanged byte, and a later run without the flag passes.

  Scenario: Updating goldens that already match rewrites nothing
    Given a copy of this repository
    When the whole test suite runs in the copy with the update flag
    Then the run passes, with every golden test passing
    And every golden in the copy is byte-for-byte the repository's
    When the golden tests run in the copy without the update flag
    Then the run passes, with every golden test passing
    And a program that imports the verify package, without its tests, has no "update" flag

  Scenario: A drifted bounded text is regenerated
    Given a copy of this repository
    And in the copy, the golden "text.json" has these replacements:
      | from                          | to                            | places |
      | {"in":"short","out":"short"}  | {"in":"short","out":"stale"}  | 2      |
    When the golden tests run in the copy without the update flag
    Then the run fails, and exactly these tests fail:
      | TestBoundedTextsEqualTheElixirReference |
    And the copy's golden "text.json" is unchanged since the replacements
    When the golden tests run in the copy with the update flag
    Then the run passes, with every golden test passing
    And every golden in the copy is byte-for-byte the repository's
    When the golden tests run in the copy without the update flag
    Then the run passes, with every golden test passing

  Scenario: A recorded input is kept and its recorded output follows the current code
    Given a copy of this repository
    And in the copy, the golden "text.json" has these replacements:
      | from                          | to                            | places |
      | {"in":"short","out":"short"}  | {"in":"brief","out":"short"}  | 2      |
    When the golden tests run in the copy without the update flag
    Then the run fails, and exactly these tests fail:
      | TestBoundedTextsEqualTheElixirReference |
    When the golden tests run in the copy with the update flag
    Then the run passes, with every golden test passing
    And the copy's goldens are the repository's, except that in "text.json" every '{"in":"short","out":"short"}' is '{"in":"brief","out":"brief"}'
    When the golden tests run in the copy without the update flag
    Then the run passes, with every golden test passing

  Scenario: Drifted pass feedback and verdicts are regenerated
    Given a copy of this repository
    And in the copy, the golden "passes.json" has these replacements:
      | from                    | to                      | places |
      | then call finish again. | then call finish later. | 10     |
      | "complete":true         | "complete":false        | 2      |
    When the golden tests run in the copy without the update flag
    Then the run fails, and exactly these tests fail:
      | TestPassFeedbackEqualsTheElixirFeedback                |
      | TestPassCompleteEqualsTheElixirVerdictOnEveryReference |
    And the copy's golden "passes.json" is unchanged since the replacements
    When the golden tests run in the copy with the update flag
    Then the run passes, with every golden test passing
    And every golden in the copy is byte-for-byte the repository's
    When the golden tests run in the copy without the update flag
    Then the run passes, with every golden test passing

  Scenario: Drifted feasibility readings, verdicts and texts are regenerated
    Given a copy of this repository
    And in the copy, the golden "feasibility.json" has these replacements:
      | from                                   | to                       | places |
      | "detail":"invalid feasibility evidence" | "detail":"stale evidence" | 36     |
      | "valid":true                           | "valid":false            | 6      |
      | Readiness observations                 | Stale observations       | 12     |
    When the golden tests run in the copy without the update flag
    Then the run fails, and exactly these tests fail:
      | TestDeclarationsEqualTheElixirReadingOnEveryReference |
      | TestValidEqualsTheElixirVerdictOnEveryReference       |
      | TestObservationsAndAcknowledgmentEqualTheElixirTexts  |
    And the copy's golden "feasibility.json" is unchanged since the replacements
    When the golden tests run in the copy with the update flag
    Then the run passes, with every golden test passing
    And every golden in the copy is byte-for-byte the repository's
    When the golden tests run in the copy without the update flag
    Then the run passes, with every golden test passing

  Scenario: A drifted Cucumber accounting is regenerated
    Given a copy of this repository
    And in the copy, the golden "accounts.json" has these replacements:
      | from       | to         | places |
      | "passed":2 | "passed":5 | 1      |
    When the golden tests run in the copy without the update flag
    Then the run fails, and exactly these tests fail:
      | TestAccountEqualsTheElixirAccountingOnEveryReference |
    And the copy's golden "accounts.json" is unchanged since the replacements
    When the golden tests run in the copy with the update flag
    Then the run passes, with every golden test passing
    And every golden in the copy is byte-for-byte the repository's
    When the golden tests run in the copy without the update flag
    Then the run passes, with every golden test passing

  Scenario: A drifted hash-pinned readiness record is regenerated and its historical record text is kept
    Given a copy of this repository
    And in the copy, the golden "readiness.json" has these replacements:
      | from                                              | to                                                | places |
      | "head":"e6a00722e20d6d79a98c8524f62069c14eebdc19" | "head":"0000000000000000000000000000000000000000" | 2      |
      | "acceptance_exit":1                               | "acceptance_exit":7                               | 2      |
    When the golden tests run in the copy without the update flag
    Then the run fails, and exactly these tests fail:
      | TestReadinessRecordEqualsTheElixirRecordAndReadsBack |
    And the copy's golden "readiness.json" is unchanged since the replacements
    When the golden tests run in the copy with the update flag
    Then the run passes, with every golden test passing
    And every golden in the copy is byte-for-byte the repository's
    When the golden tests run in the copy without the update flag
    Then the run passes, with every golden test passing

  Scenario: The update flag is the one documented way to regenerate the goldens
    Then the README documents "go test ./... -update" for the goldens in "verify/testdata/golden"
    And every golden in "verify/testdata/golden" is named in a comment of a Go test file in "verify"
    And the directory "verify/testdata/gen" holds no files
