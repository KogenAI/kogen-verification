Feature: k-consumes-verification: consumed dependency contracts
  Scenario: Each dependency has an executable local consumer suite
    When k-consumes-verification: I run "go test -count=1 ./consumes/kogen-coordinator ./consumes/kogen-loop" offline
    Then k-consumes-verification: the command succeeds

  Scenario: Document the complete consumption audit
    Then k-consumes-verification: the source map exists at "consumes/README.md"

  Scenario: Retain existing provided contracts
    When k-consumes-verification: I run "go test -count=1 ./contract" offline
    Then k-consumes-verification: the command succeeds

  Scenario Outline: Preserve module bytes
    Then k-consumes-verification: file "<path>" has SHA-256 "<hash>"
    Examples:
      | path | hash |
      | go.mod | 6eb5ab6850c0f23838702939276a6cb88c680675751cdbec4665e128ed145520 |
      | go.sum | 106e551880e06f9418734c3e530aa1c5bdb6d879110790413b83a602d3530792 |
