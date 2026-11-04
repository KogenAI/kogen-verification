Feature: Record tool paths under the materialized candidate relative to it

  Scenario: An empty PATH entry finds a tool at the candidate root
    When fix-k-verify-check-run-identity: two identical passes run with the PATH entry "" after an absolute tool folder and an executable node stub committed at "node"
    Then fix-k-verify-check-run-identity: both passes are green and record the node tool path "node" with status "ok" and version "stub node v1"
    And fix-k-verify-check-run-identity: both passes record the git tool at its absolute path in the absolute tool folder
    And fix-k-verify-check-run-identity: no recorded tool path names the scratch folder
    And fix-k-verify-check-run-identity: the "acceptance" and "proof" commands have the same identity_sha256 in both passes

  Scenario: A relative PATH entry finds a tool in a candidate folder
    When fix-k-verify-check-run-identity: two identical passes run with the PATH entry "tools" after an absolute tool folder and an executable node stub committed at "tools/node"
    Then fix-k-verify-check-run-identity: both passes are green and record the node tool path "tools/node" with status "ok" and version "stub node v1"
    And fix-k-verify-check-run-identity: both passes record the git tool at its absolute path in the absolute tool folder
    And fix-k-verify-check-run-identity: no recorded tool path names the scratch folder
    And fix-k-verify-check-run-identity: the "acceptance" and "proof" commands have the same identity_sha256 in both passes
