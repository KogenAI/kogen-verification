Feature: Readiness record ownership
  Scenario: Current pinned coordinator
    Then k-verify-readiness-golden-unpinned: normal records pass with coordinator "pinned"

  Scenario: Coordinator main at shaping
    Then k-verify-readiness-golden-unpinned: normal records pass with coordinator "v0.0.0-20261104042648-ce1e6baa2d77"

  Scenario: Foreign golden bytes are not the contract
    Then k-verify-readiness-golden-unpinned: foreign records pass with coordinator "pinned"

  Scenario: Verification record shape still has a contract
    Then k-verify-readiness-golden-unpinned: changing the written version makes both records fail
