Feature: A failed setup step that is killed by a signal keeps its output in the setup_failed outcome

  Scenario: A setup step that writes boom to stderr and then aborts keeps boom
    Given v-setup-failed-output-tail: the setup commands:
      | command                              |
      | true                                 |
      | sh -c 'echo boom >&2; kill -ABRT $$' |
    When v-setup-failed-output-tail: readiness checks the fixture Intent without a diagnostic attempt
    Then v-setup-failed-output-tail: the outcome is "environment/setup_failed: Setup setup-2 failed (status=134)." with exit 3
    And v-setup-failed-output-tail: an outcome line contains "boom"
    And v-setup-failed-output-tail: the outcome lines are exactly:
      | line                                                                                                                                           |
      | boom                                                                                                                                           |
      | commands.setup[1]: sh -c 'echo boom >&2; kill -ABRT $$'                                                                                        |
      | next: fix commands.setup in .kogen/project.yaml (commit the change) or install what the command needs, then rerun the command that was refused |

  Scenario: With a diagnostic attempt the aborted setup step still keeps boom
    Given v-setup-failed-output-tail: the setup commands:
      | command                              |
      | true                                 |
      | sh -c 'echo boom >&2; kill -ABRT $$' |
    When v-setup-failed-output-tail: readiness checks the fixture Intent with a diagnostic attempt
    Then v-setup-failed-output-tail: the outcome is "environment/setup_failed: Setup setup-2 failed (status=134)." with exit 3
    And v-setup-failed-output-tail: an outcome line contains "boom"
    And v-setup-failed-output-tail: the outcome lines start with:
      | line |
      | boom |

  Scenario: A setup shell that aborts itself keeps its stdout and stderr in order
    Given v-setup-failed-output-tail: the setup commands:
      | command                                |
      | true                                   |
      | echo out; echo err >&2; kill -ABRT $$ |
    When v-setup-failed-output-tail: readiness checks the fixture Intent without a diagnostic attempt
    Then v-setup-failed-output-tail: the outcome is "environment/setup_failed: Setup setup-2 failed (status=134)." with exit 3
    And v-setup-failed-output-tail: the outcome lines are exactly:
      | line                                                                                                                                           |
      | out                                                                                                                                            |
      | err                                                                                                                                            |
      | commands.setup[1]: echo out; echo err >&2; kill -ABRT $$                                                                                       |
      | next: fix commands.setup in .kogen/project.yaml (commit the change) or install what the command needs, then rerun the command that was refused |

  Scenario: With a diagnostic attempt a setup shell that aborts itself keeps its stdout and stderr in order
    Given v-setup-failed-output-tail: the setup commands:
      | command                                |
      | true                                   |
      | echo out; echo err >&2; kill -ABRT $$ |
    When v-setup-failed-output-tail: readiness checks the fixture Intent with a diagnostic attempt
    Then v-setup-failed-output-tail: the outcome is "environment/setup_failed: Setup setup-2 failed (status=134)." with exit 3
    And v-setup-failed-output-tail: the outcome lines start with:
      | line |
      | out  |
      | err  |

  Scenario: An aborted setup step that wrote 30 lines keeps its last 20
    Given v-setup-failed-output-tail: the setup commands:
      | command                      |
      | true                         |
      | seq 1 30 >&2; kill -ABRT $$ |
    When v-setup-failed-output-tail: readiness checks the fixture Intent without a diagnostic attempt
    Then v-setup-failed-output-tail: the outcome is "environment/setup_failed: Setup setup-2 failed (status=134)." with exit 3
    And v-setup-failed-output-tail: the outcome lines are exactly:
      | line                                                                                                                                           |
      | 11                                                                                                                                             |
      | 12                                                                                                                                             |
      | 13                                                                                                                                             |
      | 14                                                                                                                                             |
      | 15                                                                                                                                             |
      | 16                                                                                                                                             |
      | 17                                                                                                                                             |
      | 18                                                                                                                                             |
      | 19                                                                                                                                             |
      | 20                                                                                                                                             |
      | 21                                                                                                                                             |
      | 22                                                                                                                                             |
      | 23                                                                                                                                             |
      | 24                                                                                                                                             |
      | 25                                                                                                                                             |
      | 26                                                                                                                                             |
      | 27                                                                                                                                             |
      | 28                                                                                                                                             |
      | 29                                                                                                                                             |
      | 30                                                                                                                                             |
      | commands.setup[1]: seq 1 30 >&2; kill -ABRT $$                                                                                                 |
      | next: fix commands.setup in .kogen/project.yaml (commit the change) or install what the command needs, then rerun the command that was refused |
