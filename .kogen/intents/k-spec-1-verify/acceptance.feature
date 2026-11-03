Feature: Maintained specifications participate in ordinary verification

  Scenario: Both maintained models run alongside the Intent model
    When ordinary verification receives the "passing" maintained model list
    Then maintained verification has green true, checks 1, cause "" and Quint calls:
      """
      quint typecheck own.qnt
      quint run own.qnt --backend typescript --invariant Own --seed 3 --max-samples 4 --max-steps 5
      quint typecheck first.qnt
      quint run first.qnt --backend typescript --invariant A --seed 11 --max-samples 12 --max-steps 13
      quint run first.qnt --backend typescript --invariant B --seed 11 --max-samples 12 --max-steps 13
      quint typecheck second.qnt
      quint run second.qnt --backend typescript --invariant C --seed 21 --max-samples 22 --max-steps 23
      """

  Scenario Outline: A maintained failure names its model
    When ordinary verification receives the "<mode>" maintained model list
    Then maintained verification has green false, checks 0, cause "<path>" and Quint calls:
      """
      quint typecheck own.qnt
      quint run own.qnt --backend typescript --invariant Own --seed 3 --max-samples 4 --max-steps 5
      quint typecheck first.qnt
      quint run first.qnt --backend typescript --invariant A --seed 11 --max-samples 12 --max-steps 13
      quint run first.qnt --backend typescript --invariant B --seed 11 --max-samples 12 --max-steps 13
      quint typecheck <path>
      quint run <path> --backend typescript --invariant C --seed 21 --max-samples 22 --max-steps 23
      """
    Examples:
      | mode      | path         |
      | typecheck | broken.qnt   |
      | invariant | violated.qnt |

  Scenario: Empty maintained input leaves existing execution unchanged
    When ordinary verification receives the "empty" maintained model list
    Then maintained verification has green true, checks 1, cause "" and Quint calls:
      """
      quint typecheck own.qnt
      quint run own.qnt --backend typescript --invariant Own --seed 3 --max-samples 4 --max-steps 5
      """
