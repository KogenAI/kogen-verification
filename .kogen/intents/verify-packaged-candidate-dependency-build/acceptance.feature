Feature: Qualify a packaged candidate with a dependency build
  This feature runs kogen verify candidate with a fixture project and a local dependency mirror, where the running kogen binary is the packaged candidate.

  Scenario: A complete scripted run lands
    Given verify-packaged-candidate-dependency-build: a fixture project with a local mirror and a candidate that completes every phase
    When verify-packaged-candidate-dependency-build: I run kogen verify candidate --project with the fixture directory
    Then verify-packaged-candidate-dependency-build: the command exits with status 0 and prints the landed line first
    And verify-packaged-candidate-dependency-build: the receipt has exactly the keys binary_sha256, project, phases and elapsed_seconds
    And verify-packaged-candidate-dependency-build: the receipt binary_sha256 is the sha256 of the packaged binary
    And verify-packaged-candidate-dependency-build: the receipt phases are install, shape, build, resume, restore, land in that order

  Scenario: A resume that loses the restore flag fails
    Given verify-packaged-candidate-dependency-build: a fixture project with a local mirror and a candidate whose Build resume loses the restore flag
    When verify-packaged-candidate-dependency-build: I run kogen verify candidate --project with the fixture directory
    Then verify-packaged-candidate-dependency-build: the command exits with status 1 and prints the line "candidate-build: failed resume" and never the landed line

  Scenario: A missing fixture is unavailable
    Given verify-packaged-candidate-dependency-build: a fixture directory that does not exist
    When verify-packaged-candidate-dependency-build: I run kogen verify candidate --project with the fixture directory
    Then verify-packaged-candidate-dependency-build: the command exits with status 2 and prints the line "candidate-build: unavailable" and never the landed line

  Scenario: Two runs of the same fixture and binary give identical phases
    Given verify-packaged-candidate-dependency-build: a fixture project with a local mirror and a candidate that completes every phase
    When verify-packaged-candidate-dependency-build: I run kogen verify candidate --project with the fixture directory twice
    Then verify-packaged-candidate-dependency-build: both runs print the same phases and the phases include install
    And verify-packaged-candidate-dependency-build: both receipts are identical except for elapsed_seconds
