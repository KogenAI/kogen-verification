Feature: Broken harnesses cannot pass readiness
  Scenario: Shared Before hook failure is a repairable refusal
    When k-verify-harness-fault-not-ready: I check the "hook" synthetic candidate
    Then k-verify-harness-fault-not-ready: the readiness turns are
      | class  | reason    | recorded | names | statuses | contains                                                |
      | intent | not_ready | no       | -     | -        | First;Later;shared fixture;broken shared fixture          |

  Scenario: A support helper throwing during fixture setup is refused
    When k-verify-harness-fault-not-ready: I check the "helper" synthetic candidate
    Then k-verify-harness-fault-not-ready: the readiness turns are
      | class  | reason    | recorded | names | statuses | contains                              |
      | intent | not_ready | no       | -     | -        | First;Later;a fixture;broken setup helper |

  Scenario: Missing product function remains valid feature red
    When k-verify-harness-fault-not-ready: I check the "missing" synthetic candidate
    Then k-verify-harness-fault-not-ready: the readiness turns are
      | class | reason | recorded | names       | statuses      | contains |
      | -     | -      | yes      | First,Later | failed,failed | -        |

  Scenario: The shaper receives a refusal and submits a fixed hook next turn
    When k-verify-harness-fault-not-ready: I check the "repair" synthetic candidate
    Then k-verify-harness-fault-not-ready: the readiness turns are
      | class  | reason    | recorded | names       | statuses      | contains                                       |
      | intent | not_ready | no       | -           | -             | First;Later;shared fixture;broken shared fixture |
      | -      | -         | yes      | First,Later | failed,failed | -                                              |

  Scenario: A stand-in implementation does not fix the shared harness
    When k-verify-harness-fault-not-ready: I check the "standin" synthetic candidate
    Then k-verify-harness-fault-not-ready: the readiness turns are
      | class  | reason    | recorded | names | statuses | contains                                       |
      | intent | not_ready | no       | -     | -        | First;Later;shared fixture;broken shared fixture |
      | intent | not_ready | no       | -     | -        | First;Later;shared fixture;broken shared fixture |

  Scenario: Fixture service absence remains an environment timeout
    When k-verify-harness-fault-not-ready: I check the "timeout" synthetic candidate
    Then k-verify-harness-fault-not-ready: the readiness turns are
      | class       | reason       | recorded | names | statuses | contains               |
      | environment | step_timeout | no       | -     | -        | fixture service absent |

  Scenario: An Error in a separate product assertion helper is valid red
    When k-verify-harness-fault-not-ready: I check the "assert-error" synthetic candidate
    Then k-verify-harness-fault-not-ready: the readiness turns are
      | class | reason | recorded | names       | statuses      | contains |
      | -     | -      | yes      | First,Later | failed,failed | -        |

  Scenario: A TypeError in a separate product assertion helper is valid red
    When k-verify-harness-fault-not-ready: I check the "assert-typeerror" synthetic candidate
    Then k-verify-harness-fault-not-ready: the readiness turns are
      | class | reason | recorded | names       | statuses      | contains |
      | -     | -      | yes      | First,Later | failed,failed | -        |
