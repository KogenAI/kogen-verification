Feature: Producer-owned consumer contracts
  Scenario: Contracts join the ordinary gate and execute offline
    When I discover Go packages using the ordinary pattern "./..."
    Then the discovered packages include "github.com/KogenAI/kogen-verification/contract"
    When I run the producer contract package "./contract" offline
    Then the contract package executes passing tests without skips
