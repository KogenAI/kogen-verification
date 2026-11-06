Feature: Dependency-ordered pass evidence survives a reload
  Scenario: A pass reordered only by declared dependencies stays complete after reload
    When fix-k-verify-previously-red-first: the "dependency-ordered" pass is recorded and reloaded
    Then fix-k-verify-previously-red-first: the observations include:
      """
      {"green":true,"trace":["B","A"],"checks":["B=0","A=0"],"complete":true,"record_dependency_reordered":true,"reloaded_complete":true,"rerecorded_identical":true}
      """

  Scenario: A pass without dependencies still needs configuration order after reload
    When fix-k-verify-previously-red-first: the "config-ordered" pass is recorded and reloaded
    Then fix-k-verify-previously-red-first: the observations include:
      """
      {"green":true,"trace":["A","B"],"checks":["A=0","B=0"],"complete":true,"record_dependency_reordered":"absent","reloaded_complete":true,"rerecorded_identical":true,"swapped_reloaded_complete":false}
      """
