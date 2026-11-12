Feature: A failed attempt evidence write leaves nothing behind

  This feature covers the retained evidence of a refused approval attempt when the write fails.

  Scenario: A failing write removes the new folder and record
    When k-verify-attempt-evidence-failed-write-removed: the evidence of refused attempts has been retained with injected failures
    Then k-verify-attempt-evidence-failed-write-removed: the "write-failure" case leaves exactly these entries:
      """
      ["attempts dir 700","attempts/EARLIER dir 700","attempts/EARLIER/attempt.json file 600"]
      """
    And k-verify-attempt-evidence-failed-write-removed: the "write-failure" case leaves the earlier attempt untouched
    And k-verify-attempt-evidence-failed-write-removed: the "write-failure" refusal has one "Evidence not retained" line naming "file too large"

  Scenario: A successful write keeps one new folder with one parseable private record and no temporary file
    When k-verify-attempt-evidence-failed-write-removed: the evidence of refused attempts has been retained with injected failures
    Then k-verify-attempt-evidence-failed-write-removed: the "success" case leaves exactly these entries:
      """
      ["attempts dir 700","attempts/EARLIER dir 700","attempts/EARLIER/attempt.json file 600","attempts/NEW dir 700","attempts/NEW/attempt.json file 600"]
      """
    And k-verify-attempt-evidence-failed-write-removed: the "success" case record parses as JSON

  Scenario: A failure to create the folder leaves nothing behind
    When k-verify-attempt-evidence-failed-write-removed: the evidence of refused attempts has been retained with injected failures
    Then k-verify-attempt-evidence-failed-write-removed: the "folder-failure" case leaves exactly these entries:
      """
      ["readiness dir","readiness/attempts file"]
      """
    And k-verify-attempt-evidence-failed-write-removed: the "folder-failure" refusal has one "Evidence not retained" line naming "attempts"
