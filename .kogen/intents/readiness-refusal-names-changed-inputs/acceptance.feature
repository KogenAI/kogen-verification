Feature: A readiness refusal for changed inputs names the changed inputs and the next step

  This feature drives RecordPass after a readiness check of a fixture Intent whose inputs then change.

  Scenario: An unrelated new file changes only the candidate tree
    When readiness-refusal-names-changed-inputs: RecordPass runs after "an unrelated new file" changed the checkout
    Then readiness-refusal-names-changed-inputs: the refusal has class "intent", reason "not_ready", exit 1 and detail "the Intent is not ready to build"
    And readiness-refusal-names-changed-inputs: no readiness record is published
    And readiness-refusal-names-changed-inputs: the refusal lines are:
      """
      ["readiness inputs changed during checking or publication","changed: candidate tree","next: stop whatever changed the checkout while Kogen was checking, then rerun the command that was refused"]
      """

  Scenario: A moved HEAD is named alone
    When readiness-refusal-names-changed-inputs: RecordPass runs after "an empty commit" changed the checkout
    Then readiness-refusal-names-changed-inputs: the refusal has class "intent", reason "not_ready", exit 1 and detail "the Intent is not ready to build"
    And readiness-refusal-names-changed-inputs: no readiness record is published
    And readiness-refusal-names-changed-inputs: the refusal lines are:
      """
      ["readiness inputs changed during checking or publication","changed: HEAD","next: stop whatever changed the checkout while Kogen was checking, then rerun the command that was refused"]
      """

  Scenario: Several changed inputs are listed in order
    When readiness-refusal-names-changed-inputs: RecordPass runs after "an extra scenario in the feature file" changed the checkout
    Then readiness-refusal-names-changed-inputs: the refusal has class "intent", reason "not_ready", exit 1 and detail "the Intent is not ready to build"
    And readiness-refusal-names-changed-inputs: no readiness record is published
    And readiness-refusal-names-changed-inputs: the refusal lines are:
      """
      ["readiness inputs changed during checking or publication","changed: baseline contents, candidate tree","next: stop whatever changed the checkout while Kogen was checking, then rerun the command that was refused"]
      """

  Scenario: A nil readiness result keeps today's refusal
    When readiness-refusal-names-changed-inputs: RecordPass runs with no readiness result
    Then readiness-refusal-names-changed-inputs: the refusal has class "intent", reason "not_ready", exit 1 and detail "the Intent is not ready to build"
    And readiness-refusal-names-changed-inputs: the refusal lines are:
      """
      ["readiness inputs changed during checking or publication"]
      """
