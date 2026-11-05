Feature: The baseline guard acceptance step requires its three subtests to pass
  The k-verify-fixture-title-user-name step runs `go test -run` for
  TestBaselineGuardRunsAfterEachFixerAndAfterThePass. It must fail unless the -v or -json output
  shows that the subtests after_the_first_fixer, after_the_second_fixer and after_the_pass passed.
  Each scenario runs that Intent's own acceptance with only its own step file in a scratch copy of
  the module.

  Scenario: The step passes on the unchanged module
    Given fix-k-verify-fixture-title-user-name: a scratch copy of the module
    When fix-k-verify-fixture-title-user-name: the k-verify-fixture-title-user-name acceptance runs in the copy
    Then fix-k-verify-fixture-title-user-name: the run exits 0 and reports "1 scenario (1 passed)"

  Scenario: The step fails when the regression test is renamed and go test runs no tests
    Given fix-k-verify-fixture-title-user-name: a scratch copy of the module where "func TestBaselineGuardRunsAfterEachFixerAndAfterThePass(" in verify/verify_test.go is replaced by "func TestBaselineGuardRenamedAway("
    When fix-k-verify-fixture-title-user-name: the k-verify-fixture-title-user-name acceptance runs in the copy
    Then fix-k-verify-fixture-title-user-name: the run exits nonzero and reports "1 scenario (1 failed)"
    And fix-k-verify-fixture-title-user-name: the run output contains "TestBaselineGuardRunsAfterEachFixerAndAfterThePass"
    And fix-k-verify-fixture-title-user-name: the run output contains "go test"

  Scenario: The step fails when one subtest is renamed
    Given fix-k-verify-fixture-title-user-name: a scratch copy of the module where '{"after the pass", 3,' in verify/verify_test.go is replaced by '{"at the end", 3,'
    When fix-k-verify-fixture-title-user-name: the k-verify-fixture-title-user-name acceptance runs in the copy
    Then fix-k-verify-fixture-title-user-name: the run exits nonzero and reports "1 scenario (1 failed)"
    And fix-k-verify-fixture-title-user-name: the run output contains "TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_pass"

  Scenario: The step fails when one subtest is skipped
    Given fix-k-verify-fixture-title-user-name: a scratch copy of the module where "p.Config.Fix = tc.fix" in verify/verify_test.go is replaced by 'p.Config.Fix = tc.fix; if tc.failAt == 2 { t.Skip("disabled by the fixture") }'
    When fix-k-verify-fixture-title-user-name: the k-verify-fixture-title-user-name acceptance runs in the copy
    Then fix-k-verify-fixture-title-user-name: the run exits nonzero and reports "1 scenario (1 failed)"
    And fix-k-verify-fixture-title-user-name: the run output contains "TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_second_fixer"
