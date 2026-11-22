Feature: Setup rejects a pinned manifest that is not a regular file
  This feature covers writeMissing of cmd/setup-tools through the real setup run, with npm replaced by a marker script.

  Scenario Outline: A pinned target that is a directory or another non-regular file is rejected before npm
    Given setup-tools-rejects-non-file-manifests: an empty working directory
    When setup-tools-rejects-non-file-manifests: setup runs with a <kind> at "<target>"
    Then setup-tools-rejects-non-file-manifests: setup fails with an error naming "<target>"
    And setup-tools-rejects-non-file-manifests: npm was not invoked
    And setup-tools-rejects-non-file-manifests: the <kind> is still at "<target>"

    Examples:
      | kind      | target                                     |
      | directory | testdata/tools/cucumber/package.json       |
      | directory | testdata/tools/cucumber/package-lock.json  |
      | directory | testdata/tools/quint/package.json          |
      | fifo      | testdata/tools/cucumber/package-lock.json  |

  Scenario Outline: An existing regular pinned file is kept and an absent one is copied
    Given setup-tools-rejects-non-file-manifests: an empty working directory
    And setup-tools-rejects-non-file-manifests: a regular file "<existing>" containing "custom manifest"
    When setup-tools-rejects-non-file-manifests: setup writes the missing pinned files of tool "<tool>"
    Then setup-tools-rejects-non-file-manifests: setup succeeds
    And setup-tools-rejects-non-file-manifests: the file "<existing>" still contains "custom manifest"
    And setup-tools-rejects-non-file-manifests: the file "<absent>" equals the pinned file of the repository

    Examples:
      | tool     | existing                                  | absent                                 |
      | quint    | testdata/tools/quint/package.json         | testdata/tools/quint/package-lock.json |
      | cucumber | testdata/tools/cucumber/package-lock.json | testdata/tools/cucumber/package.json   |

  Scenario: The repository tests of cmd/setup-tools exist and pass
    Given setup-tools-rejects-non-file-manifests: an empty working directory
    Then setup-tools-rejects-non-file-manifests: the repository tests of cmd/setup-tools exist and pass
