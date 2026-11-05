Feature: The checks_wall_ms review finding does not reproduce with fast commands

  Scenario: A serial Run of true and echo commands keeps checks_wall_ms non-negative and every command result
    When fix-k-verify-check-wall-ms: the verification passes of true and echo commands have run
    Then fix-k-verify-check-wall-ms: the "serial" pass log matches:
      """
      {"wall":"nonnegative","ordered":true,"results":["fix-1","setup-1","setup-2","acceptance","t","e","red"],"not_run":["tail"]}
      """

  Scenario: A stage of true and echo checks keeps checks_wall_ms non-negative and every command result
    When fix-k-verify-check-wall-ms: the verification passes of true and echo commands have run
    Then fix-k-verify-check-wall-ms: the "stage" pass log matches:
      """
      {"wall":"nonnegative","ordered":true,"results":["stage-one-1","stage-one-2"],"not_run":[]}
      """

  Scenario: A pass in which no item starts reports checks_wall_ms 0
    When fix-k-verify-check-wall-ms: the verification passes of true and echo commands have run
    Then fix-k-verify-check-wall-ms: the "empty-stage" pass log matches:
      """
      {"wall":"zero","ordered":true,"results":[],"not_run":[]}
      """

  Scenario: A pass that stops at a fast red setup keeps checks_wall_ms non-negative
    When fix-k-verify-check-wall-ms: the verification passes of true and echo commands have run
    Then fix-k-verify-check-wall-ms: the "setup-red" pass log matches:
      """
      {"wall":"nonnegative","ordered":true,"results":["setup-1"],"not_run":["setup-2","acceptance","t","e","red","tail"]}
      """

  Scenario: A cohort of fast go build and go vet checks keeps checks_wall_ms non-negative and both results
    When fix-k-verify-check-wall-ms: the verification passes of true and echo commands have run
    Then fix-k-verify-check-wall-ms: the "cohort" pass log matches:
      """
      {"wall":"nonnegative","ordered":false,"results":["acceptance","compile","vet"],"not_run":[]}
      """
