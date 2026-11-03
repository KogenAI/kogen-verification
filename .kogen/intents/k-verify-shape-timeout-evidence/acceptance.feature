Feature: Evidence for a Shape acceptance timeout
  A bounded Shape readiness check (no caller attempt) whose acceptance command exceeds its bound
  keeps its intent/not_ready "acceptance timed out" refusal and also reports the measured wall
  time, the command's output before the stop, the host load with its caveat and the path of
  retained private evidence. The fixtures contract the bound; production keeps 120 seconds.

  Scenario: A Shape acceptance timeout keeps its refusal and explains the stop
    When a bounded Shape readiness check without a caller attempt runs the acceptance command "echo partial-marker; sleep 30" with a 1000 ms bound
    Then the check is refused with class "intent", reason "not_ready" and exit 1
    And the refusal detail is "acceptance timed out"
    And the first refusal line is "acceptance timed out: command exceeds the 120-second limit"
    And the refusal and its one retained private Shape attempt record report the stopped acceptance with its measured wall time, its output "partial-marker", the labeled host load with its caveat and the evidence path

  Scenario: A silent Shape acceptance timeout says it wrote no output
    When a bounded Shape readiness check without a caller attempt runs the acceptance command "sleep 30" with a 1000 ms bound
    Then the check is refused with class "intent", reason "not_ready" and exit 1
    And the refusal detail is "acceptance timed out"
    And the first refusal line is "acceptance timed out: command exceeds the 120-second limit"
    And the refusal and its one retained private Shape attempt record report the stopped acceptance with its measured wall time, that it wrote no output, the labeled host load with its caveat and the evidence path

  Scenario: Acceptance that passes in time leaves no retained evidence
    When a bounded Shape readiness check without a caller attempt runs the fixture's passing acceptance command with a 60000 ms bound
    Then the check is ready with acceptance exit 0
    And no attempt evidence is retained and the result shows no evidence or host load line

  Scenario: Acceptance whose failed scenario is accounted for is unchanged
    When a bounded Shape readiness check without a caller attempt runs the acceptance command "echo actual-case-red; exit 1" after copying the fixture's failed report, with a 60000 ms bound
    Then the check is ready with acceptance exit 1
    And no attempt evidence is retained and the result shows no evidence or host load line

  Scenario: Acceptance that fails normally keeps its unchanged refusal
    When a bounded Shape readiness check without a caller attempt runs the acceptance command "echo plain-failure; exit 1" with a 60000 ms bound
    Then the check is refused with class "intent", reason "not_ready" and exit 1
    And the refusal detail is "the Intent is not ready to build"
    And the refusal lines are exactly:
      """
      report_missing: the acceptance command exited 1; its output:
      plain-failure
      """
    And no attempt evidence is retained and the result shows no evidence or host load line

  Scenario: A caller's own approval attempt keeps its single record
    When a bounded Shape readiness check with a caller approval attempt bounded at 1000 ms runs the acceptance command "echo partial-marker; sleep 30"
    Then the check is refused with class "environment", reason "step_timeout" and exit 3
    And the approval refusal shows the output "partial-marker" and names its single retained approval attempt record
