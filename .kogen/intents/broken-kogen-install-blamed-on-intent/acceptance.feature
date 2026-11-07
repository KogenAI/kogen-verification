Feature: Diagnose Kogen installation failures
  Scenario Outline: Model-free readiness validates its installation first
    Given broken-kogen-install-blamed-on-intent: a synthetic installation case "<case>"
    Then broken-kogen-install-blamed-on-intent: readiness reports "<cause>" before acceptance
    Examples:
      | case               | cause                         |
      | complete           | ready                         |
      | absent             | node-path is missing          |
      | unreadable         | node-path is unreadable       |
      | empty              | node-path is empty            |
      | missing-target     | node target is missing        |
      | non-executable     | node target is not executable |
      | directory          | node target is not regular    |
      | cucumber-absent    | cucumber                      |
      | cucumber-empty     | cucumber                      |
      | both-absent        | node-path is missing          |
