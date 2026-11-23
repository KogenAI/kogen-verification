Feature: SeedIgnored reports a failed listing of a source that is not a Git repository
  This feature checks that verify/seed_test.go gains a regression test for SeedIgnored with a non-Git source, and that the test rejects wrong seeding behavior.

  Scenario: The new test passes against the current SeedIgnored
    When seed-ignored-git-list-failure: the tests newly declared in verify/seed_test.go are run against the unchanged SeedIgnored
    Then seed-ignored-git-list-failure: every new test passes

  Scenario: The new test rejects a SeedIgnored that swallows the failed listing
    When seed-ignored-git-list-failure: the tests newly declared in verify/seed_test.go are run against a SeedIgnored that "swallows the failed listing"
    Then seed-ignored-git-list-failure: at least one new test fails

  Scenario: The new test rejects a SeedIgnored that returns an unrelated error
    When seed-ignored-git-list-failure: the tests newly declared in verify/seed_test.go are run against a SeedIgnored that "returns an unrelated error"
    Then seed-ignored-git-list-failure: at least one new test fails

  Scenario: The new test rejects an error that does not identify the source
    When seed-ignored-git-list-failure: the tests newly declared in verify/seed_test.go are run against a SeedIgnored that "omits the source from the error"
    Then seed-ignored-git-list-failure: at least one new test fails

  Scenario: The new test rejects a SeedIgnored that copies despite the failed listing
    When seed-ignored-git-list-failure: the tests newly declared in verify/seed_test.go are run against a SeedIgnored that "copies the source despite the failed listing"
    Then seed-ignored-git-list-failure: at least one new test fails
