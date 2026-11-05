Feature: A verification pass that stops with an error ends with one pass_aborted event

  Scenario: A runner failure on the second check ends the pass with one runner_error pass_aborted event
    When k-verify-pass-end-event-on-error: the pass driver runs the "runner" case
    Then k-verify-pass-end-event-on-error: the pass logs exactly these events once masked:
      """
      [{"event":"check_identity"},{"command":"if grep -qx red app.txt; then cp '<tmp>/<n>/red.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"; echo actual-case-red; exit 1; fi; cp '<tmp>/<n>/green.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"","event":"command","name":"acceptance"},{"event":"step_sweep","name":"acceptance","stopped":0},{"event":"command_result","name":"acceptance","output":"","status":0},{"command":"sleep 1","cwd":"<tmp>/<n>/kogen-verify-<scratch>","event":"command","name":"first"},{"event":"step_sweep","name":"first","stopped":0},{"event":"command_result","name":"first","output":"","status":0},{"command":"true","cwd":"<tmp>/<n>/kogen-verify-<scratch>","event":"command","name":"second"},{"event":"pass_aborted","pass":1,"cause":"runner_error","item":"second","completed":["acceptance","first"]}]
      """
    And k-verify-pass-end-event-on-error: the last event has an integer checks_wall_ms from 1000 to below 3000
    And k-verify-pass-end-event-on-error: the pass returns exactly this outcome once masked:
      """
      {"error":{"text":"open <tmp>/<n>/missing/kogen-acceptance-marker-<scratch>: no such file or directory","type":"*fs.PathError"},"pass":"{\"n\":0,\"clean\":false,\"green\":false,\"tree\":\"\",\"setup\":[],\"acceptance\":\"not_run\",\"model\":\"not_run\",\"checks\":[],\"not_run\":[],\"moved\":[],\"failing\":[]}","progress":"kogen: verifying (pass 1)\n"}
      """
    And k-verify-pass-end-event-on-error: no scratch directory of the pass remains

  Scenario: Cancelling the context during the first check ends the pass with a cancelled pass_aborted event
    When k-verify-pass-end-event-on-error: the pass driver runs the "cancel" case
    Then k-verify-pass-end-event-on-error: the pass logs exactly these events once masked:
      """
      [{"event":"check_identity"},{"command":"if grep -qx red app.txt; then cp '<tmp>/<n>/red.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"; echo actual-case-red; exit 1; fi; cp '<tmp>/<n>/green.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"","event":"command","name":"acceptance"},{"event":"step_sweep","name":"acceptance","stopped":0},{"event":"command_result","name":"acceptance","output":"","status":0},{"command":"sleep 1","cwd":"<tmp>/<n>/kogen-verify-<scratch>","event":"command","name":"first"},{"event":"step_sweep","name":"first","stopped":0},{"event":"command_result","name":"first","output":"","status":0},{"event":"pass_aborted","pass":1,"cause":"cancelled","item":"first","completed":["acceptance"]}]
      """
    And k-verify-pass-end-event-on-error: the last event has an integer checks_wall_ms from 300 to below 3000
    And k-verify-pass-end-event-on-error: the pass returns exactly this outcome once masked:
      """
      {"error":{"text":"context canceled","type":"*errors.errorString"},"pass":"{\"n\":0,\"clean\":false,\"green\":false,\"tree\":\"\",\"setup\":[],\"acceptance\":\"not_run\",\"model\":\"not_run\",\"checks\":[],\"not_run\":[],\"moved\":[],\"failing\":[]}","progress":"kogen: verifying (pass 1)\n"}
      """
    And k-verify-pass-end-event-on-error: no scratch directory of the pass remains

  Scenario: A check that exceeds its step bound ends the pass with a timeout pass_aborted event
    When k-verify-pass-end-event-on-error: the pass driver runs the "timeout" case
    Then k-verify-pass-end-event-on-error: the pass logs exactly these events once masked:
      """
      [{"event":"check_identity"},{"command":"if grep -qx red app.txt; then cp '<tmp>/<n>/red.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"; echo actual-case-red; exit 1; fi; cp '<tmp>/<n>/green.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"","event":"command","name":"acceptance"},{"event":"step_sweep","name":"acceptance","stopped":0},{"event":"command_result","name":"acceptance","output":"","status":0},{"command":"sleep 1","cwd":"<tmp>/<n>/kogen-verify-<scratch>","event":"command","name":"first"},{"event":"step_sweep","name":"first","stopped":0},{"event":"command_result","name":"first","output":"","status":143},{"event":"pass_aborted","pass":1,"cause":"timeout","item":"first","completed":["acceptance"]}]
      """
    And k-verify-pass-end-event-on-error: the last event has an integer checks_wall_ms from 500 to below 3000
    And k-verify-pass-end-event-on-error: the pass returns exactly this outcome once masked:
      """
      {"error":{"text":"step command timed out","type":"*verify.stepTimeout"},"pass":"{\"n\":0,\"clean\":false,\"green\":false,\"tree\":\"\",\"setup\":[],\"acceptance\":\"not_run\",\"model\":\"not_run\",\"checks\":[],\"not_run\":[],\"moved\":[],\"failing\":[]}","progress":"kogen: verifying (pass 1)\n"}
      """
    And k-verify-pass-end-event-on-error: no scratch directory of the pass remains

  Scenario: A baseline guard refusal after the checks ends the pass with a baseline_changed pass_aborted event
    When k-verify-pass-end-event-on-error: the pass driver runs the "baseline" case
    Then k-verify-pass-end-event-on-error: the pass logs exactly these events once masked:
      """
      [{"event":"check_identity"},{"command":"if grep -qx red app.txt; then cp '<tmp>/<n>/red.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"; echo actual-case-red; exit 1; fi; cp '<tmp>/<n>/green.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"","event":"command","name":"acceptance"},{"event":"step_sweep","name":"acceptance","stopped":0},{"event":"command_result","name":"acceptance","output":"","status":0},{"command":"sleep 1","cwd":"<tmp>/<n>/kogen-verify-<scratch>","event":"command","name":"first"},{"event":"step_sweep","name":"first","stopped":0},{"event":"command_result","name":"first","output":"","status":0},{"command":"true","cwd":"<tmp>/<n>/kogen-verify-<scratch>","event":"command","name":"second"},{"event":"step_sweep","name":"second","stopped":0},{"event":"command_result","name":"second","output":"","status":0},{"event":"pass_aborted","pass":1,"cause":"baseline_changed","item":"","completed":["acceptance","first","second"]}]
      """
    And k-verify-pass-end-event-on-error: the last event has an integer checks_wall_ms from 1000 to below 3000
    And k-verify-pass-end-event-on-error: the pass returns exactly this outcome once masked:
      """
      {"error":{"class":"candidate","detail":"the Build changed acceptance files: features/steps/fixture_steps.js","exit":1,"reason":"baseline_changed","same_as_guard_refusal":true,"text":"candidate/baseline_changed: the Build changed acceptance files: features/steps/fixture_steps.js","type":"*sys.Error"},"pass":"{\"n\":0,\"clean\":false,\"green\":false,\"tree\":\"\",\"setup\":[],\"acceptance\":\"not_run\",\"model\":\"not_run\",\"checks\":[],\"not_run\":[],\"moved\":[],\"failing\":[]}","progress":"kogen: verifying (pass 1)\n"}
      """
    And k-verify-pass-end-event-on-error: no scratch directory of the pass remains

  Scenario: A tree-read failure before any item ends the pass with a tree_error pass_aborted event
    When k-verify-pass-end-event-on-error: the pass driver runs the "tree" case
    Then k-verify-pass-end-event-on-error: the pass logs exactly these events once masked:
      """
      [{"event":"pass_aborted","pass":1,"cause":"tree_error","item":"","completed":[]}]
      """
    And k-verify-pass-end-event-on-error: the last event has an integer checks_wall_ms from 0 to below 1
    And k-verify-pass-end-event-on-error: the pass returns exactly this outcome once masked:
      """
      {"error":{"text":"git read-tree 0000000000000000000000000000000000000000 failed (status 128): fatal: failed to unpack tree object 0000000000000000000000000000000000000000","type":"*git.CommandError"},"pass":"{\"n\":0,\"clean\":false,\"green\":false,\"tree\":\"\",\"setup\":[],\"acceptance\":\"not_run\",\"model\":\"not_run\",\"checks\":[],\"not_run\":[],\"moved\":[],\"failing\":[]}","progress":"kogen: verifying (pass 1)\n"}
      """
    And k-verify-pass-end-event-on-error: no scratch directory of the pass remains

  Scenario: A normal green pass writes only its unchanged pass event
    When k-verify-pass-end-event-on-error: the pass driver runs the "green" case
    Then k-verify-pass-end-event-on-error: the pass logs exactly these events once masked:
      """
      [{"event":"check_identity"},{"command":"if grep -qx red app.txt; then cp '<tmp>/<n>/red.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"; echo actual-case-red; exit 1; fi; cp '<tmp>/<n>/green.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"","event":"command","name":"acceptance"},{"event":"step_sweep","name":"acceptance","stopped":0},{"event":"command_result","name":"acceptance","output":"","status":0},{"command":"sleep 1","cwd":"<tmp>/<n>/kogen-verify-<scratch>","event":"command","name":"first"},{"event":"step_sweep","name":"first","stopped":0},{"event":"command_result","name":"first","output":"","status":0},{"command":"true","cwd":"<tmp>/<n>/kogen-verify-<scratch>","event":"command","name":"second"},{"event":"step_sweep","name":"second","stopped":0},{"event":"command_result","name":"second","output":"","status":0},{"event":"pass","failing":[],"files_changed_while_checks_ran":[],"green":true,"not_run":[],"pass":1}]
      """
    And k-verify-pass-end-event-on-error: the last event has an integer checks_wall_ms from 1000 to below 3000
    And k-verify-pass-end-event-on-error: the pass returns exactly this outcome once masked:
      """
      {"error":null,"pass":"{\"n\":1,\"clean\":true,\"green\":true,\"tree\":\"33ed361d54ee28bcdf0285a1bf2aefb1db155ed1\",\"setup\":[],\"acceptance\":{\"status\":0,\"output\":\"\",\"scenarios\":[{\"name\":\"First\",\"line\":2,\"tags\":[],\"steps\":[{\"keyword\":\"Then \",\"text\":\"the candidate succeeds\",\"line\":3}],\"unexercised_steps\":[],\"status\":\"passed\",\"detail\":null},{\"name\":\"Later\",\"line\":4,\"tags\":[],\"steps\":[{\"keyword\":\"Then \",\"text\":\"the candidate succeeds\",\"line\":5}],\"unexercised_steps\":[],\"status\":\"passed\",\"detail\":null}],\"problems\":[],\"binding_problems\":[],\"passed\":2,\"failed\":0},\"model\":\"none\",\"checks\":[{\"name\":\"first\",\"command\":\"sleep 1\",\"status\":0,\"output\":\"\"},{\"name\":\"second\",\"command\":\"true\",\"status\":0,\"output\":\"\"}],\"not_run\":[],\"moved\":[],\"failing\":[]}","progress":"kogen: verifying (pass 1)\nkogen: pass 1: all checks passed\n"}
      """
    And k-verify-pass-end-event-on-error: no scratch directory of the pass remains

  Scenario: A normal red pass writes only its unchanged pass event
    When k-verify-pass-end-event-on-error: the pass driver runs the "red" case
    Then k-verify-pass-end-event-on-error: the pass logs exactly these events once masked:
      """
      [{"event":"check_identity"},{"command":"if grep -qx red app.txt; then cp '<tmp>/<n>/red.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"; echo actual-case-red; exit 1; fi; cp '<tmp>/<n>/green.ndjson' \"$KOGEN_ACCEPTANCE_REPORT\"","event":"command","name":"acceptance"},{"event":"step_sweep","name":"acceptance","stopped":0},{"event":"command_result","name":"acceptance","output":"actual-case-red\n","status":1},{"event":"pass","failing":["acceptance"],"files_changed_while_checks_ran":[],"green":false,"not_run":["first","second"],"pass":1}]
      """
    And k-verify-pass-end-event-on-error: the last event has an integer checks_wall_ms from 0 to below 1000
    And k-verify-pass-end-event-on-error: the pass returns exactly this outcome once masked:
      """
      {"error":null,"pass":"{\"n\":1,\"clean\":true,\"green\":false,\"tree\":\"5029e8e261ce64760462abffe6154aebf18a30ff\",\"setup\":[],\"acceptance\":{\"status\":1,\"output\":\"actual-case-red\\n\",\"scenarios\":[{\"name\":\"First\",\"line\":2,\"tags\":[],\"steps\":[{\"keyword\":\"Then \",\"text\":\"the candidate succeeds\",\"line\":3}],\"unexercised_steps\":[],\"status\":\"failed\",\"detail\":\"acceptance.feature line 3: Then the candidate succeeds\",\"phase\":\"assertion\"},{\"name\":\"Later\",\"line\":4,\"tags\":[],\"steps\":[{\"keyword\":\"Then \",\"text\":\"the candidate succeeds\",\"line\":5}],\"unexercised_steps\":[],\"status\":\"failed\",\"detail\":\"acceptance.feature line 5: Then the candidate succeeds\",\"phase\":\"assertion\"}],\"problems\":[\"failed: First (line 2)\\nacceptance.feature line 3: Then the candidate succeeds\",\"failed: Later (line 4)\\nacceptance.feature line 5: Then the candidate succeeds\"],\"binding_problems\":[],\"passed\":0,\"failed\":2},\"model\":\"none\",\"checks\":[],\"not_run\":[\"first\",\"second\"],\"moved\":[],\"failing\":[\"acceptance\"]}","progress":"kogen: verifying (pass 1)\nkogen: pass 1: acceptance failed; not run because an earlier item failed: first, second\n"}
      """
    And k-verify-pass-end-event-on-error: no scratch directory of the pass remains
