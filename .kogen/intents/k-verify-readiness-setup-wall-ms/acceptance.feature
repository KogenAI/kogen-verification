Feature: Readiness setup records its wall time and a skipped setup

  Scenario: Every readiness setup command result carries its wall time, also when the command fails
    When k-verify-readiness-setup-wall-ms: the setup driver runs the "failing" case
    Then k-verify-readiness-setup-wall-ms: the setup command results are:
      | run | name    | status | min_ms | max_ms |
      | 1   | setup-1 | 0      | 1000   | 3000   |
      | 1   | setup-2 | 4      | 0      | 1000   |
    And k-verify-readiness-setup-wall-ms: run 1 logs these events in order:
      """
      ["command","step_sweep","command_result","command","step_sweep","command_result"]
      """
    And k-verify-readiness-setup-wall-ms: run 1 makes these calls:
      """
      [{"call":"check","error":{"class":"environment","detail":"Setup setup-2 failed (status=4).","exit":3,"lines":[""],"reason":"setup_failed"},"progress":"kogen: running setup-1: sleep 1\nkogen: running setup-2: exit 4\n","record":null}]
      """

  Scenario: A cancelled readiness setup command still records its wall time until cancellation
    When k-verify-readiness-setup-wall-ms: the setup driver runs the "cancel" case
    Then k-verify-readiness-setup-wall-ms: the setup command results are:
      | run | name    | status | min_ms | max_ms |
      | 1   | setup-1 | -      | 500    | 3000   |
    And k-verify-readiness-setup-wall-ms: run 1 logs these events in order:
      """
      ["command","step_sweep","command_result"]
      """
    And k-verify-readiness-setup-wall-ms: run 1 makes these calls:
      """
      [{"call":"setup","error":{"text":"context deadline exceeded"},"progress":"kogen: running setup-1: sleep 30\n","reuse":false,"stamp":null}]
      """

  Scenario: Setup skipped because its stamp matches logs one setup_skipped event
    When k-verify-readiness-setup-wall-ms: the setup driver runs the "reuse" case
    Then k-verify-readiness-setup-wall-ms: the setup command results are:
      | run | name    | status | min_ms | max_ms |
      | 1   | setup-1 | 0      | 0      | 1000   |
    And k-verify-readiness-setup-wall-ms: run 1 logs these events in order:
      """
      ["command","step_sweep","command_result"]
      """
    And k-verify-readiness-setup-wall-ms: run 2 logs these events in order:
      """
      ["setup_skipped"]
      """
    And k-verify-readiness-setup-wall-ms: run 2 logs these setup_skipped events:
      """
      [{"event":"setup_skipped","reason":"already_ran","count":1}]
      """
    And k-verify-readiness-setup-wall-ms: run 1 makes these calls:
      """
      [{"call":"setup","error":null,"progress":"kogen: running setup-1: true\n","reuse":true,"stamp":"{\"changes\":\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\",\"head\":\"<head>\",\"setup\":[\"true\"]}"}]
      """
    And k-verify-readiness-setup-wall-ms: run 2 makes these calls:
      """
      [{"call":"setup","error":null,"progress":"kogen: setup already ran for this checkout state\n","reuse":true,"stamp":"{\"changes\":\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\",\"head\":\"<head>\",\"setup\":[\"true\"]}"}]
      """

  Scenario: The setup_skipped event counts every skipped setup command
    When k-verify-readiness-setup-wall-ms: the setup driver runs the "reuse-two" case
    Then k-verify-readiness-setup-wall-ms: run 2 logs these events in order:
      """
      ["setup_skipped"]
      """
    And k-verify-readiness-setup-wall-ms: run 2 logs these setup_skipped events:
      """
      [{"event":"setup_skipped","reason":"already_ran","count":2}]
      """
    And k-verify-readiness-setup-wall-ms: run 2 makes these calls:
      """
      [{"call":"setup","error":null,"progress":"kogen: setup already ran for this checkout state\n","reuse":true,"stamp":"{\"changes\":\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\",\"head\":\"<head>\",\"setup\":[\"true\",\"true\"]}"}]
      """

  Scenario: Two identical runs log the same events without their *_ms keys and keep the control records
    When k-verify-readiness-setup-wall-ms: the setup driver runs the "identical" case
    Then k-verify-readiness-setup-wall-ms: the setup command results are:
      | run | name    | status | min_ms | max_ms |
      | 1   | setup-1 | 0      | 0      | 1000   |
      | 1   | setup-1 | 0      | 0      | 1000   |
      | 1   | setup-1 | 0      | 0      | 1000   |
      | 2   | setup-1 | 0      | 0      | 1000   |
      | 2   | setup-1 | 0      | 0      | 1000   |
      | 2   | setup-1 | 0      | 0      | 1000   |
    And k-verify-readiness-setup-wall-ms: the two runs log the same events once every *_ms key is removed
    And k-verify-readiness-setup-wall-ms: every run makes these calls:
      """
      [{"call":"setup","error":null,"progress":"kogen: running setup-1: true\n","reuse":false,"stamp":"{\"changes\":\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\",\"head\":\"<head>\",\"setup\":[\"true\"]}"},{"call":"check","error":null,"progress":"kogen: running setup-1: true\n","record":"{\"acceptance_exit\":0,\"baseline\":[\".kogen/intents/fixture/intent.md\",\".kogen/intents/fixture/acceptance.feature\",\"features/steps/fixture_steps.js\",\".kogen/project.yaml\",\".kogen/models.yaml\"],\"candidate_tree\":\"33ed361d54ee28bcdf0285a1bf2aefb1db155ed1\",\"feasibility\":[],\"head\":\"<head>\",\"model\":\"none\",\"model_outcome\":\"not_applicable\",\"outcome\":\"ready\",\"scenarios\":[{\"detail\":null,\"line\":2,\"name\":\"First\",\"status\":\"passed\",\"steps\":[{\"keyword\":\"Then \",\"line\":3,\"text\":\"the candidate succeeds\"}],\"tags\":[],\"unexercised_steps\":[]},{\"detail\":null,\"line\":4,\"name\":\"Later\",\"status\":\"passed\",\"steps\":[{\"keyword\":\"Then \",\"line\":5,\"text\":\"the candidate succeeds\"}],\"tags\":[],\"unexercised_steps\":[]}],\"sha256\":\"34529c1a115bee6dc2d49f1306c64cf6700c1fd056ec19240687f33ef721fed9\",\"step_warnings\":[],\"title\":\"Fixture intent\",\"version\":5}\n"},{"call":"pass","error":null,"pass":"{\"n\":1,\"clean\":true,\"green\":true,\"tree\":\"33ed361d54ee28bcdf0285a1bf2aefb1db155ed1\",\"setup\":[{\"name\":\"setup-1\",\"command\":\"true\",\"status\":0,\"output\":\"\"}],\"acceptance\":{\"status\":0,\"output\":\"\",\"scenarios\":[{\"name\":\"First\",\"line\":2,\"tags\":[],\"steps\":[{\"keyword\":\"Then \",\"text\":\"the candidate succeeds\",\"line\":3}],\"unexercised_steps\":[],\"status\":\"passed\",\"detail\":null},{\"name\":\"Later\",\"line\":4,\"tags\":[],\"steps\":[{\"keyword\":\"Then \",\"text\":\"the candidate succeeds\",\"line\":5}],\"unexercised_steps\":[],\"status\":\"passed\",\"detail\":null}],\"problems\":[],\"binding_problems\":[],\"passed\":2,\"failed\":0},\"model\":\"none\",\"checks\":[],\"not_run\":[],\"moved\":[],\"failing\":[]}","progress":"kogen: verifying (pass 1)\nkogen: running setup-1: true\nkogen: pass 1: all checks passed\n"}]
      """

  Scenario: A readiness run without setup commands logs neither event
    When k-verify-readiness-setup-wall-ms: the setup driver runs the "empty" case
    Then k-verify-readiness-setup-wall-ms: run 1 logs these events in order:
      """
      []
      """
    And k-verify-readiness-setup-wall-ms: run 1 makes these calls:
      """
      [{"call":"check","error":null,"progress":"","record":"{\"acceptance_exit\":0,\"baseline\":[\".kogen/intents/fixture/intent.md\",\".kogen/intents/fixture/acceptance.feature\",\"features/steps/fixture_steps.js\",\".kogen/project.yaml\",\".kogen/models.yaml\"],\"candidate_tree\":\"33ed361d54ee28bcdf0285a1bf2aefb1db155ed1\",\"feasibility\":[],\"head\":\"<head>\",\"model\":\"none\",\"model_outcome\":\"not_applicable\",\"outcome\":\"ready\",\"scenarios\":[{\"detail\":null,\"line\":2,\"name\":\"First\",\"status\":\"passed\",\"steps\":[{\"keyword\":\"Then \",\"line\":3,\"text\":\"the candidate succeeds\"}],\"tags\":[],\"unexercised_steps\":[]},{\"detail\":null,\"line\":4,\"name\":\"Later\",\"status\":\"passed\",\"steps\":[{\"keyword\":\"Then \",\"line\":5,\"text\":\"the candidate succeeds\"}],\"tags\":[],\"unexercised_steps\":[]}],\"sha256\":\"34529c1a115bee6dc2d49f1306c64cf6700c1fd056ec19240687f33ef721fed9\",\"step_warnings\":[],\"title\":\"Fixture intent\",\"version\":5}\n"},{"call":"setup","error":null,"progress":"","reuse":true,"stamp":"{\"changes\":\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\",\"head\":\"<head>\",\"setup\":[]}"},{"call":"setup","error":null,"progress":"kogen: setup already ran for this checkout state\n","reuse":true,"stamp":"{\"changes\":\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\",\"head\":\"<head>\",\"setup\":[]}"}]
      """
