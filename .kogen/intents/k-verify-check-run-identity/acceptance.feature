Feature: k-verify-check-run-identity: reproducible private check evidence
  Scenario: k-verify-check-run-identity: distinguish material changes without changing pass records
    When k-verify-check-run-identity: I verify the synthetic candidates
    Then k-verify-check-run-identity: every identity satisfies the reproducibility and privacy contract
