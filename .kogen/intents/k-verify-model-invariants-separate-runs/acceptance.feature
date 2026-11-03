Feature: Check declared model invariants separately
  Scenario: Run each declared name separately and in order
    When the synthetic invariant model is checked with:
      """
      {"Names":["A","B","C"]}
      """
    Then the invariant evidence is:
      """
      {"names":["A","B","C"],"state":"ok"}
      """

  Scenario: A violation belongs only to B and does not stop C
    When the synthetic invariant model is checked with:
      """
      {"Names":["A","B","C"],"Violate":"B"}
      """
    Then the invariant evidence is:
      """
      {"names":["A","B","C"],"state":"failed","problem":"^model\\.qnt: invariant B violated \\(seed 17\\)\\n\\[violation\\]\\n?$","lines":2}
      """

  Scenario Outline: Refuse malformed declarations before starting any checker
    When the synthetic invariant model is checked with:
      """
      {"Names":["A","<declaration>","C"]}
      """
    Then the invariant evidence is:
      """
      {"names":null,"state":"failed","problem":"<problem>","lines":1}
      """
    Examples:
      | declaration | problem |
      | A,B         | A,B     |
      | A B         | A B     |
      | A\u0009B    | A.*B    |
      | A\u000aB    | A.*B    |

  Scenario: Suppress duplicates without changing first-declaration order
    When the synthetic invariant model is checked with:
      """
      {"Names":["A","B","B","C","A"]}
      """
    Then the invariant evidence is:
      """
      {"names":["A","B","C"],"state":"ok"}
      """

  Scenario: An empty declaration list retains the typecheck-only control
    When the synthetic invariant model is checked with:
      """
      {"Names":[]}
      """
    Then the invariant evidence is:
      """
      {"names":[],"state":"ok"}
      """
