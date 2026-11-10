Feature: Name failing acceptance scenarios in progress
  This feature exposes progress hidden by identical acceptance failure summaries.

  Scenario: Two of seven
    When verification-summary-names-failing-scenarios: I summarize this pass:
      """
      {"model":"not_run","n":6,"failing":["acceptance"],"not_run":["model","checks"],"acceptance":{"scenarios":[{"name":"Alpha","line":6,"status":"passed"},{"name":"Beta","line":12,"status":"failed"},{"name":"Gamma","line":18,"status":"passed"},{"name":"Delta","line":24,"status":"skipped"},{"name":"Epsilon","line":30,"status":"passed"},{"name":"Zeta","line":36,"status":"passed"},{"name":"Eta","line":42,"status":"passed"}]}}
      """
    Then verification-summary-names-failing-scenarios: the summary is "kogen: pass 6: acceptance failed (2 of 7 scenarios: Beta:12, Delta:24); not run because an earlier item failed: model, checks"

  Scenario: Five failures truncate after three
    When verification-summary-names-failing-scenarios: I summarize this pass:
      """
      {"model":"not_run","n":1,"failing":["acceptance"],"acceptance":{"scenarios":[{"name":"Zebra","line":3,"status":"failed"},{"name":"Ant","line":7,"status":"failed"},{"name":"Yak","line":11,"status":"failed"},{"name":"Bee","line":15,"status":"failed"},{"name":"Fox","line":19,"status":"failed"}]}}
      """
    Then verification-summary-names-failing-scenarios: the summary is "kogen: pass 1: acceptance failed (5 of 5 scenarios: Zebra:3, Ant:7, Yak:11, ...)"

  Scenario: Acceptance did not run
    When verification-summary-names-failing-scenarios: I summarize this pass:
      """
      {"model":"not_run","n":2,"failing":["compile"],"not_run":["acceptance","model"],"acceptance":"not_run"}
      """
    Then verification-summary-names-failing-scenarios: the summary is "kogen: pass 2: compile failed; not run because an earlier item failed: acceptance, model"
