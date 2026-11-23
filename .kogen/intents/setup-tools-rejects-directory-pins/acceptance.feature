Feature: Setup validates pinned package files before npm
  This feature drives the real setup run of cmd/setup-tools with npm replaced by a marker script.

  Scenario: A directory at a pinned package file path is rejected before npm is invoked
    Given setup-tools-rejects-directory-pins: an empty working directory
    And setup-tools-rejects-directory-pins: a directory at "testdata/tools/cucumber/package.json"
    When setup-tools-rejects-directory-pins: setup runs
    Then setup-tools-rejects-directory-pins: setup fails with an error naming "testdata/tools/cucumber/package.json"
    And setup-tools-rejects-directory-pins: npm was not invoked
    And setup-tools-rejects-directory-pins: "testdata/tools/cucumber/package.json" is still a directory

  Scenario: Existing regular pinned files stay byte for byte unchanged
    Given setup-tools-rejects-directory-pins: an empty working directory
    And setup-tools-rejects-directory-pins: a regular file "testdata/tools/cucumber/package.json" containing "custom manifest"
    And setup-tools-rejects-directory-pins: a regular file "testdata/tools/quint/package-lock.json" containing "custom lock"
    When setup-tools-rejects-directory-pins: setup runs
    Then setup-tools-rejects-directory-pins: setup succeeds
    And setup-tools-rejects-directory-pins: the file "testdata/tools/cucumber/package.json" still contains "custom manifest"
    And setup-tools-rejects-directory-pins: the file "testdata/tools/quint/package-lock.json" still contains "custom lock"

  Scenario: Missing pinned files are populated from the embedded files
    Given setup-tools-rejects-directory-pins: an empty working directory
    When setup-tools-rejects-directory-pins: setup runs
    Then setup-tools-rejects-directory-pins: setup succeeds
    And setup-tools-rejects-directory-pins: npm was invoked
    And setup-tools-rejects-directory-pins: the file "testdata/tools/cucumber/package.json" equals the pinned file of the repository
    And setup-tools-rejects-directory-pins: the file "testdata/tools/cucumber/package-lock.json" equals the pinned file of the repository
    And setup-tools-rejects-directory-pins: the file "testdata/tools/quint/package.json" equals the pinned file of the repository
    And setup-tools-rejects-directory-pins: the file "testdata/tools/quint/package-lock.json" equals the pinned file of the repository
