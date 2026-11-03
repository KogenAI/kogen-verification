Feature: Every verification step is swept of the processes it left behind

  Kogen sweeps what a project command started once the command returns, for every step that
  verification runs, not only acceptance: setup, checks and the other steps. A server that left
  the command's process group and session is stopped before the step's result is reported, by
  the same marker sweep as acceptance. Processes the step did not start keep running, the step's
  exit status and output are unchanged, and each step writes one bounded step_sweep log event
  naming it. The control run is the same command run through today's per-step guard alone.

  Scenario: A builder verification pass stops the detached servers its setup and check commands leave
    When a builder verification pass runs with setup and check command "sh -c '(setsid sleep 301 &) ; echo ok'", which starts a detached "sleep 301", next to a bystander "sleep 302" in its own session
    Then after each of the steps "setup-1, check" returned, no "sleep 301" the run started was running
    And the bystander "sleep 302" is still running
    And the steps "setup-1, check" exited 0 with output "ok\n", the same as the control run of the command
    And each of the steps "setup-1, acceptance, check" wrote exactly one "step_sweep" event naming it

  Scenario: An approval readiness check stops the detached server its setup command leaves
    When an approval readiness check runs with setup command "sh -c '(setsid sleep 301 &) ; echo ok'", which starts a detached "sleep 301", next to a bystander "sleep 302" in its own session
    Then after each of the steps "setup-1" returned, no "sleep 301" the run started was running
    And the bystander "sleep 302" is still running
    And the steps "setup-1" exited 0 with output "ok\n", the same as the control run of the command
    And each of the steps "setup-1" wrote exactly one "step_sweep" event naming it

  Scenario: A setup step that times out is swept too
    When an approval readiness check whose steps time out after 2 seconds runs with setup command "sh -c '(setsid sleep 301 &) ; echo ok; sleep 30'", which starts a detached "sleep 301", next to a bystander "sleep 302" in its own session
    Then the step "setup-1" timed out, as the control run of the command did
    And after the check returned, no "sleep 301" the run started was running
    And the bystander "sleep 302" is still running
    And each of the steps "setup-1" wrote exactly one "step_sweep" event naming it

  Scenario: Steps that leave no process write one bounded sweep line each and add under 200 ms
    When 3 builder verification passes run with setup and check command "echo ok"
    Then each pass wrote, for the steps "setup-1, acceptance, check" in this order, one "step_sweep" event each with exactly the fields "event, ms, name, stopped" and stopped 0
    And each of the steps "setup-1, check" took under 200 ms more than the control run of the command
