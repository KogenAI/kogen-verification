Feature: Record elapsed verification time only in logs
  Scenario: Preserve the serial control record while timing commands
    When k-verify-check-wall-ms: I run the "serial" verification stub
    Then k-verify-check-wall-ms: the timing evidence satisfies:
      """
      {"sleep_min":1000,"sleep_max":3000,"check_min":2000,"check_max":5000,"cohort_min":5000,"cohort_max":11000,"cancel_max":3000,"control_pass":"{\"n\":1,\"clean\":true,\"green\":false,\"tree\":\"33ed361d54ee28bcdf0285a1bf2aefb1db155ed1\",\"setup\":[{\"name\":\"setup-1\",\"command\":\"sleep 1\",\"status\":0,\"output\":\"\"}],\"acceptance\":{\"status\":0,\"output\":\"\",\"scenarios\":[{\"name\":\"First\",\"line\":2,\"tags\":[],\"steps\":[{\"keyword\":\"Then \",\"text\":\"the candidate succeeds\",\"line\":3}],\"unexercised_steps\":[],\"status\":\"passed\",\"detail\":null},{\"name\":\"Later\",\"line\":4,\"tags\":[],\"steps\":[{\"keyword\":\"Then \",\"text\":\"the candidate succeeds\",\"line\":5}],\"unexercised_steps\":[],\"status\":\"passed\",\"detail\":null}],\"problems\":[],\"binding_problems\":[],\"passed\":2,\"failed\":0},\"model\":\"none\",\"checks\":[{\"name\":\"slow\",\"command\":\"sleep 2\",\"status\":0,\"output\":\"\"},{\"name\":\"red\",\"command\":\"exit 3\",\"status\":3,\"output\":\"\"}],\"not_run\":[\"tail\"],\"moved\":[],\"failing\":[\"red\"]}"}
      """

  Scenario Outline: Time concurrent cancellation and model work
    When k-verify-check-wall-ms: I run the "<mode>" verification stub
    Then k-verify-check-wall-ms: the timing evidence satisfies:
      """
      {"sleep_min":1000,"sleep_max":3000,"check_min":2000,"check_max":5000,"cohort_min":5000,"cohort_max":11000,"cancel_max":3000}
      """
    Examples:
      | mode   |
      | cohort |
      | cancel |
      | model  |
