Feature: Run established independent checks concurrently
  Scenario: Independent expensive checks overlap and retain their own results
    When a synthetic verification pass exercises concurrent checks in mode "overlap"
    Then the concurrent pass has these exact observations:
      """
      {"green":true,"failing":[],"not_run":[],"checks":[["compile",0,"build-output\n"],["vet",0,"vet-output\n"],["tail",0,"tail\n"]],"speculative":[],"cancelled":[],"build_started":true,"vet_started":true}
      """

  Scenario: A cheap failure launches no expensive work
    When a synthetic verification pass exercises concurrent checks in mode "cheap"
    Then the concurrent pass has these exact observations:
      """
      {"green":false,"failing":["format"],"not_run":["compile","vet","tail"],"checks":[["format",7,"cheap-output\n"]],"speculative":[],"cancelled":[],"build_started":false,"vet_started":false}
      """

  Scenario: A later completed failure is evidence not the repair target
    When a synthetic verification pass exercises concurrent checks in mode "speculative"
    Then the concurrent pass has these exact observations:
      """
      {"green":false,"failing":["compile"],"not_run":["tail"],"checks":[["compile",17,"build-output\n"]],"speculative":[["vet",19,"vet-output\n"]],"cancelled":[],"build_started":true,"vet_started":true}
      """

  Scenario: A later failure waits for earlier checks instead of cancelling them
    When a synthetic verification pass exercises concurrent checks in mode "ordered"
    Then the concurrent pass has these exact observations:
      """
      {"green":false,"failing":["vet"],"not_run":["tail"],"checks":[["compile",0,"build-output\n"],["vet",19,"vet-output\n"]],"speculative":[],"cancelled":[],"build_started":true,"vet_started":true}
      """

  Scenario: Ordered failure cancels only unnecessary work and joins its descendants
    When a synthetic verification pass exercises concurrent checks in mode "cancel"
    Then the concurrent pass has these exact observations:
      """
      {"green":false,"failing":["compile"],"not_run":["tail"],"checks":[["compile",17,"build-output\n"]],"speculative":[],"cancelled":["vet"],"partial":"vet-partial","build_started":true,"vet_started":true}
      """

  Scenario: Unknown commands retain serial file handoffs
    When a synthetic verification pass exercises concurrent checks in mode "handoff"
    Then the concurrent pass has these exact observations:
      """
      {"green":true,"failing":[],"not_run":[],"checks":[["producer",0,""],["consumer",0,"payload\n"]],"speculative":[],"cancelled":[],"build_started":false,"vet_started":false}
      """
