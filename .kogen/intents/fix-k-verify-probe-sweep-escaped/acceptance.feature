Feature: The timed-out escaped probe test checks the probe sweep
  TestProbeRealTimeoutEscaped runs in verify test binaries built with overlays that break the
  probe's process cleanup in a named way. It must pass on the unchanged code and on code that
  still sweeps, and fail on each broken variant.

  Scenario: The test fails when the probe sweep is removed
    When fix-k-verify-probe-sweep-escaped: TestProbeRealTimeoutEscaped runs with the "unchanged" variant
    Then fix-k-verify-probe-sweep-escaped: the test passes
    When fix-k-verify-probe-sweep-escaped: TestProbeRealTimeoutEscaped runs with the "no-sweep" variant
    Then fix-k-verify-probe-sweep-escaped: the test fails

  Scenario: The test fails when the escaped child survives
    When fix-k-verify-probe-sweep-escaped: TestProbeRealTimeoutEscaped runs with the "no-reaper-stop" variant
    Then fix-k-verify-probe-sweep-escaped: the test passes
    When fix-k-verify-probe-sweep-escaped: TestProbeRealTimeoutEscaped runs with the "event-only-no-reaper-stop" variant
    Then fix-k-verify-probe-sweep-escaped: the test fails

  Scenario: The test file is built only on Linux and macOS
    Then fix-k-verify-probe-sweep-escaped: the file "verify/probe_timeout_sweep_test.go" starts with the line "//go:build linux || darwin"

  Scenario: Existing probe and sweep tests stay green
    When fix-k-verify-probe-sweep-escaped: these existing tests run with the "unchanged" variant:
      """
      TestProbeSweepsEscapedChildAndPreservesAccounting
      TestProbeRefusalsDoNotLogSweep
      TestProbeDeadlineStopsTheProbeAndReportsTimedOut
      TestContractedProbeDeadlineIsRestored
      TestProbeCancelledContextStopsTheCustodyWait
      TestProbeTimeoutObservationFailureIsNotATimedOutResult
      TestStepThatTimesOutIsSwept
      TestStepStopsDetachedServers
      """
    Then fix-k-verify-probe-sweep-escaped: each of them passes
