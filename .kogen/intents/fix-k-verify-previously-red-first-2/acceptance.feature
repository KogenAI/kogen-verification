Feature: Sound dependency scheduling in a verification pass
  Scenario: Dependencies that join no two checks keep independent Go checks concurrent
    When fix-k-verify-previously-red-first-2: the "cohort-control" case is verified
    Then fix-k-verify-previously-red-first-2: the observations include:
      """
      {"green":true,"checks":["build=0","vet=0"],"speculative":[],"cancelled":[],"not_run":[],"failing":[]}
      """
    When fix-k-verify-previously-red-first-2: the "cohort-acceptance-dependency" case is verified
    Then fix-k-verify-previously-red-first-2: the observations include:
      """
      {"green":true,"checks":["build=0","vet=0"],"speculative":[],"cancelled":[],"not_run":[],"failing":[]}
      """

  Scenario: A declared dependency between two checks keeps them sequential
    When fix-k-verify-previously-red-first-2: the "cohort-check-dependency" case is verified
    Then fix-k-verify-previously-red-first-2: the observations include:
      """
      {"green":false,"checks":["build=90"],"speculative":[],"cancelled":[],"not_run":["vet"],"failing":["build"]}
      """

  Scenario: A dependency cycle runs every item instead of dropping it
    When fix-k-verify-previously-red-first-2: the "cycle" case is verified
    Then fix-k-verify-previously-red-first-2: the observations include:
      """
      {"trace":["C","A","B"],"checks":["C=0","A=0","B=3"],"green":false,"failing":["B"],"not_run":[]}
      """

  Scenario: A constructed pass with pulled-forward work records an empty execution order
    When fix-k-verify-previously-red-first-2: the "record-constructed" case is verified
    Then fix-k-verify-previously-red-first-2: the observations include:
      """
      {"execution_order_present":true,"execution_order":[],"pulled_forward":[]}
      """

  Scenario: A decoded pass without an execution order re-records it as empty
    When fix-k-verify-previously-red-first-2: the "record-decoded" case is verified
    Then fix-k-verify-previously-red-first-2: the observations include:
      """
      {"execution_order_present":true,"execution_order":[],"pulled_forward":["C"]}
      """
