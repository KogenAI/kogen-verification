Feature: Verification pass output and feedback are redacted
  This feature runs a refused setup, verification passes whose failing commands print labelled secrets, a concurrent check and feedback built from stored records.

  Scenario: Setup refusal lines are masked
    When verify-pass-output-redacts-labelled-secrets: the redaction driver has run
    Then verify-pass-output-redacts-labelled-secrets: the first setup refusal line is exactly "password=[REDACTED]" and no setup refusal line contains "abc12345"

  Scenario: A pass records and logs masked check output
    When verify-pass-output-redacts-labelled-secrets: the redaction driver has run
    Then verify-pass-output-redacts-labelled-secrets: the lint record output and command_result event output are both exactly "password=[REDACTED]\n", its recorded command is exactly "echo password=abc12345; exit 1" and the failing items are exactly "lint"

  Scenario: A concurrent check is masked
    When verify-pass-output-redacts-labelled-secrets: the redaction driver has run
    Then verify-pass-output-redacts-labelled-secrets: the concurrent check result output and command_result event output are both exactly "password=[REDACTED]\n"

  Scenario: Acceptance output is masked in the problems
    When verify-pass-output-redacts-labelled-secrets: the redaction driver has run
    Then verify-pass-output-redacts-labelled-secrets: the first acceptance problem is exactly "report_missing: the acceptance command exited 2; its output:\npassword=[REDACTED]" and the acceptance feedback does not contain "abc12345"

  Scenario: Feedback masks a stored record
    When verify-pass-output-redacts-labelled-secrets: the redaction driver has run
    Then verify-pass-output-redacts-labelled-secrets: the stored-record feedback has the line "check lint (lint --token [REDACTED]): failed, exit status 1" immediately followed by the line "  login password=[REDACTED]" and contains neither "abc123" nor "abc12345"

  Scenario: Feedback masks speculative and cancelled results
    When verify-pass-output-redacts-labelled-secrets: the redaction driver has run
    Then verify-pass-output-redacts-labelled-secrets: the section feedback has the lines "vet (vet --token [REDACTED]): status 2", "  bad password=[REDACTED]", "slow (slow --token [REDACTED]): status -1" and "  partial password=[REDACTED]" and contains neither "abc123" nor "abc12345"
