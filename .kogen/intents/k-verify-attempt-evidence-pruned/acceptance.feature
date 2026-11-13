Feature: Old attempt evidence folders are pruned

  This feature covers retaining attempt evidence in temporary checkouts with a stub project.

  Scenario: 25 mixed attempts keep the newest 20
    When k-verify-attempt-evidence-pruned: attempts have been retained in temporary checkouts
    Then k-verify-attempt-evidence-pruned: the "mixed" case keeps exactly the attempts numbered 5 to 24, 0 being the oldest

  Scenario: The newest refusal record is kept after 25 mixed attempts
    When k-verify-attempt-evidence-pruned: attempts have been retained in temporary checkouts
    Then k-verify-attempt-evidence-pruned: the "mixed" case keeps the newest refusal record

  Scenario: Records and modes of retained folders are preserved
    When k-verify-attempt-evidence-pruned: attempts have been retained in temporary checkouts
    Then k-verify-attempt-evidence-pruned: the "mixed" case keeps every record byte-identical to when it was retained
    And k-verify-attempt-evidence-pruned: the "mixed" case keeps folders at 0700 and records at 0600

  Scenario: The oldest attempt, the only refusal and so the newest refusal, survives while 5 older passes go
    When k-verify-attempt-evidence-pruned: attempts have been retained in temporary checkouts
    Then k-verify-attempt-evidence-pruned: the "passed-first" case keeps exactly these attempts, 0 being the oldest: "0,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24"

  Scenario: 10 attempts all remain unchanged
    When k-verify-attempt-evidence-pruned: attempts have been retained in temporary checkouts
    Then k-verify-attempt-evidence-pruned: the "ten" case keeps exactly the attempts numbered 0 to 9, 0 being the oldest
    And k-verify-attempt-evidence-pruned: the "ten" case keeps every record byte-identical to when it was retained
    And k-verify-attempt-evidence-pruned: the "ten" case keeps folders at 0700 and records at 0600

  Scenario: A stray file and a stray folder survive 25 attempts
    When k-verify-attempt-evidence-pruned: attempts have been retained in temporary checkouts
    Then k-verify-attempt-evidence-pruned: the "strays" case keeps the stray file and the stray folder

  Scenario: Strays are not counted among the newest 20 of 25 attempts
    When k-verify-attempt-evidence-pruned: attempts have been retained in temporary checkouts
    Then k-verify-attempt-evidence-pruned: the "strays" case keeps exactly the attempts numbered 5 to 24, 0 being the oldest

  Scenario: An undeletable old folder does not change the outcome
    When k-verify-attempt-evidence-pruned: attempts have been retained in temporary checkouts
    Then k-verify-attempt-evidence-pruned: the "undeletable" case still refuses with its evidence and one note naming the undeletable folder

  Scenario: An undeletable old folder is not replaced by another removal
    When k-verify-attempt-evidence-pruned: attempts have been retained in temporary checkouts
    Then k-verify-attempt-evidence-pruned: the "undeletable" case keeps all 21 folders
