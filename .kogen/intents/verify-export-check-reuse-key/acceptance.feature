Feature: Exported check reuse key

  This feature runs one focused Go test in package verify against the identity code. Each scenario reads the result of one subtest.

  Scenario: The exported key equals the logged reuse_sha256
    When verify-export-check-reuse-key: the Go acceptance test runs in package verify
    Then verify-export-check-reuse-key: the Go acceptance subtest "key_equals_logged_reuse_sha256" passes

  Scenario: Attempt variables do not change the key
    When verify-export-check-reuse-key: the Go acceptance test runs in package verify
    Then verify-export-check-reuse-key: the Go acceptance subtest "attempt_variables_do_not_change_the_key" passes

  Scenario: Command, tree and PATH each change the key
    When verify-export-check-reuse-key: the Go acceptance test runs in package verify
    Then verify-export-check-reuse-key: the Go acceptance subtest "command_tree_and_path_each_change_the_key" passes

  Scenario: identity_sha256 and reuse_sha256 equal recorded literals
    When verify-export-check-reuse-key: the Go acceptance test runs in package verify
    Then verify-export-check-reuse-key: the Go acceptance subtest "identity_and_reuse_hashes_equal_recorded_literals" passes
