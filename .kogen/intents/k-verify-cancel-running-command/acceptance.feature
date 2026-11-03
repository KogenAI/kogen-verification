Feature: Bind verification command launch and lifetime to caller cancellation
  A readiness marker precedes a 0.6 second delayed second marker. The caller
  cancels only after readiness in the running case. Parent, child and grandchild
  liveness is inspected before fixture cleanup, and a separately owned sleep
  remains alive. The fixture waits another 0.8 seconds before checking writes.

  Scenario Outline: Cancel a running command through each execution route
    When the cancellation fixture uses the "<route>" route with ordering "running"
    Then the cancellation fixture reports these observations:
      """
      {"error":"canceled","status":0,"output":"","timed_out":false,"ready":true,"second":false,"live":0,"bystander":true}
      """
    Examples:
      | route    |
      | probe    |
      | ordinary |
      | approval |

  Scenario Outline: Cancel before launch and on both sides of start registration
    When the cancellation fixture uses the "<route>" route with ordering "<mode>"
    Then the cancellation fixture reports these observations:
      """
      {"error":"canceled","status":0,"output":"","timed_out":false,"second":false,"live":0,"bystander":true,"handoff":<handoff>}
      """
    Examples:
      | route    | mode     | handoff |
      | probe    | before   | 0       |
      | ordinary | before   | 0       |
      | approval | before   | 0       |
      | probe    | enter    | 1       |
      | ordinary | enter    | 1       |
      | approval | enter    | 1       |
      | probe    | starting | 1       |
      | ordinary | starting | 1       |
      | approval | starting | 1       |
      | probe    | started  | 1       |
      | ordinary | started  | 1       |
      | approval | started  | 1       |

  Scenario Outline: Preserve original uncancelled status and combined output
    When the cancellation fixture uses the "<route>" route with ordering "<mode>"
    Then the cancellation fixture reports these observations:
      """
      {"error":"none","status":<status>,"output":"original\n","timed_out":false,"ready":false,"second":false,"live":0,"bystander":true}
      """
    Examples:
      | route    | mode    | status |
      | probe    | success | 0      |
      | ordinary | success | 0      |
      | approval | success | 0      |
      | probe    | nonzero | 7      |
      | ordinary | nonzero | 7      |
      | approval | nonzero | 7      |

  Scenario Outline: Keep timeout bounds and classification distinct from cancellation
    When the cancellation fixture uses the "<route>" route with ordering "timeout"
    Then the cancellation fixture reports these observations:
      """
      {"error":"<error>","timed_out":true,"ready":true,"second":false,"live":0,"bystander":true,"probe_limit_seconds":300,"approval_limit_seconds":120}
      """
    Examples:
      | route    | error     |
      | probe    | none      |
      | approval | timed_out |

  Scenario Outline: Preserve session interrupt results and precedence
    When the cancellation fixture uses the "<route>" route with ordering "<mode>"
    Then the cancellation fixture reports these observations:
      """
      {"error":"SIGINT","second":false,"live":0,"bystander":true,"ready":<ready>}
      """
    Examples:
      | route    | mode              | ready |
      | probe    | interrupt-before  | false |
      | ordinary | interrupt-before  | false |
      | approval | interrupt-before  | false |
      | probe    | interrupt-running | true  |
      | ordinary | interrupt-running | true  |
      | approval | interrupt-running | true  |
