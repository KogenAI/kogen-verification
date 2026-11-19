Feature: Check reuse key that ignores per-attempt environment variables

  This feature runs one focused Go test in package verify against the identity code. Each scenario reads the result of one subtest.

  Scenario: Attempt variables do not change the reuse key
    When verify-check-reuse-key-ignores-attempt-env: the Go acceptance test runs in package verify
    Then verify-check-reuse-key-ignores-attempt-env: the Go acceptance subtest "attempt_variables_do_not_change_the_key" passes

  Scenario: A different tree changes the reuse key
    When verify-check-reuse-key-ignores-attempt-env: the Go acceptance test runs in package verify
    Then verify-check-reuse-key-ignores-attempt-env: the Go acceptance subtest "tree_changes_the_key" passes

  Scenario: Tools, lockfiles and host change the reuse key
    When verify-check-reuse-key-ignores-attempt-env: the Go acceptance test runs in package verify
    Then verify-check-reuse-key-ignores-attempt-env: the Go acceptance subtest "tools_lockfiles_and_host_change_the_key" passes

  Scenario: PATH changes the reuse key and identity_sha256 is unchanged
    When verify-check-reuse-key-ignores-attempt-env: the Go acceptance test runs in package verify
    Then verify-check-reuse-key-ignores-attempt-env: the Go acceptance subtest "path_changes_the_key_and_identity_hash_is_unchanged" passes
