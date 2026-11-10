Feature: Count verbose Go test evidence
  This feature checks the feedback boundary with captured failure transcripts.

  Scenario: Failing selected test ran
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\",\"unwritten\":null}"
      """
      go test -v -run ^TestX$
      === RUN   TestX
      --- FAIL: TestX (0.00s)
      """

  Scenario: Only another test ran
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\nrequired tests that did not run (from the step's arguments and the acceptance output):\n  TestX: did not run (no run of it in the go test output)\nacceptance ran them in: go test -v -run ^TestX$\nstep definition: not reported\",\"unwritten\":[\"TestX: did not run (no run of it in the go test output)\"]}"
      """
      go test -v -run ^TestX$
      === RUN   TestY
      --- PASS: TestY (0.00s)
      """

  Scenario: Run row
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\",\"unwritten\":null}"
      """
      go test -v -run ^TestX$
      === RUN   TestX
      """

  Scenario: Pass row
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\",\"unwritten\":null}"
      """
      go test -v -run ^TestX$
      --- PASS: TestX (0.00s)
      """

  Scenario: Fail row
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\",\"unwritten\":null}"
      """
      go test -v -run ^TestX$
      --- FAIL: TestX (0.00s)
      """

  Scenario: Subtest run
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\",\"unwritten\":null}"
      """
      go test -v -run ^TestX$
      === RUN   TestX/child
      """

  Scenario: Subtest pass
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\",\"unwritten\":null}"
      """
      go test -v -run ^TestX$
          --- PASS: TestX/child (0.00s)
      """

  Scenario: Subtest fail
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\",\"unwritten\":null}"
      """
      go test -v -run ^TestX$
          --- FAIL: TestX/child (0.00s)
      """

  Scenario: Skip
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\nrequired tests that did not run (from the step's arguments and the acceptance output):\n  TestX: skipped\nacceptance ran them in: go test -v -run ^TestX$\nstep definition: not reported\",\"unwritten\":null}"
      """
      go test -v -run ^TestX$
      --- SKIP: TestX (0.00s)
      """

  Scenario: Subtest skip
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\nrequired tests that did not run (from the step's arguments and the acceptance output):\n  TestX: skipped\nacceptance ran them in: go test -v -run ^TestX$\nstep definition: not reported\",\"unwritten\":null}"
      """
      go test -v -run ^TestX$
          --- SKIP: TestX/child (0.00s)
      """

  Scenario: Reported diagnostic test
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\",\"unwritten\":null}"
      """
      go test -v -run ^TestDiagnosticDataIsBoundedOriginalUTF8$
      === RUN   TestDiagnosticDataIsBoundedOriginalUTF8
      --- PASS: TestDiagnosticDataIsBoundedOriginalUTF8 (0.00s)
      """

  Scenario: JSON remains supported
    Then verification-go-test-v-runs-count: transcript yields "{\"seen\":true,\"block\":\"\",\"unwritten\":null}"
      """
      go test -v -run ^TestX$
      {"Action": "fail", "Package": "example/p", "Test": "TestX"}
      """

