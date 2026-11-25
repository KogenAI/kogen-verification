@setup-tools-rejects-symlink-pins
Feature: Reject symlinks at pinned setup-tools paths
  This feature runs the built setup-tools command in a temporary working directory with a recording npm instead of installing tools.

  Background:
    Given setup-tools-rejects-symlink-pins: an empty working directory with a recording npm

  Scenario: Refuse a symlink at the Cucumber manifest
    Given setup-tools-rejects-symlink-pins: "testdata/tools/cucumber/package.json" is a symlink to a regular file
    When setup-tools-rejects-symlink-pins: the setup-tools command runs
    Then setup-tools-rejects-symlink-pins: setup refuses with exit status 1
    And setup-tools-rejects-symlink-pins: the error on stderr names "testdata/tools/cucumber/package.json"
    And setup-tools-rejects-symlink-pins: npm was not invoked

  Scenario: Refuse a symlink at the Cucumber lockfile
    Given setup-tools-rejects-symlink-pins: "testdata/tools/cucumber/package-lock.json" is a symlink to a regular file
    When setup-tools-rejects-symlink-pins: the setup-tools command runs
    Then setup-tools-rejects-symlink-pins: setup refuses with exit status 1
    And setup-tools-rejects-symlink-pins: the error on stderr names "testdata/tools/cucumber/package-lock.json"
    And setup-tools-rejects-symlink-pins: npm was not invoked

  Scenario: Refuse a symlink at the Quint manifest
    Given setup-tools-rejects-symlink-pins: "testdata/tools/quint/package.json" is a symlink to a regular file
    When setup-tools-rejects-symlink-pins: the setup-tools command runs
    Then setup-tools-rejects-symlink-pins: setup refuses with exit status 1
    And setup-tools-rejects-symlink-pins: the error on stderr names "testdata/tools/quint/package.json"
    And setup-tools-rejects-symlink-pins: npm was not invoked

  Scenario: Refuse a symlink at the Quint lockfile
    Given setup-tools-rejects-symlink-pins: "testdata/tools/quint/package-lock.json" is a symlink to a regular file
    When setup-tools-rejects-symlink-pins: the setup-tools command runs
    Then setup-tools-rejects-symlink-pins: setup refuses with exit status 1
    And setup-tools-rejects-symlink-pins: the error on stderr names "testdata/tools/quint/package-lock.json"
    And setup-tools-rejects-symlink-pins: npm was not invoked

  Scenario: Keep regular manifests and copy absent lockfiles
    Given setup-tools-rejects-symlink-pins: the only existing pinned files are regular files containing "custom manifest"
      | path                                 |
      | testdata/tools/cucumber/package.json |
      | testdata/tools/quint/package.json    |
    When setup-tools-rejects-symlink-pins: the setup-tools command runs
    Then setup-tools-rejects-symlink-pins: setup succeeds
    And setup-tools-rejects-symlink-pins: the existing pinned files are still regular files containing "custom manifest"
      | path                                 |
      | testdata/tools/cucumber/package.json |
      | testdata/tools/quint/package.json    |
    And setup-tools-rejects-symlink-pins: the absent pinned files were copied from the embedded pins
      | path                                      |
      | testdata/tools/cucumber/package-lock.json |
      | testdata/tools/quint/package-lock.json    |
    And setup-tools-rejects-symlink-pins: npm received these invocations in order
      | command | flag     | prefix                  |
      | ci      | --prefix | testdata/tools/cucumber |
      | ci      | --prefix | testdata/tools/quint    |

  Scenario: Keep regular lockfiles and copy absent manifests
    Given setup-tools-rejects-symlink-pins: the only existing pinned files are regular files containing "custom manifest"
      | path                                      |
      | testdata/tools/cucumber/package-lock.json |
      | testdata/tools/quint/package-lock.json    |
    When setup-tools-rejects-symlink-pins: the setup-tools command runs
    Then setup-tools-rejects-symlink-pins: setup succeeds
    And setup-tools-rejects-symlink-pins: the existing pinned files are still regular files containing "custom manifest"
      | path                                      |
      | testdata/tools/cucumber/package-lock.json |
      | testdata/tools/quint/package-lock.json    |
    And setup-tools-rejects-symlink-pins: the absent pinned files were copied from the embedded pins
      | path                                 |
      | testdata/tools/cucumber/package.json |
      | testdata/tools/quint/package.json    |
    And setup-tools-rejects-symlink-pins: npm received these invocations in order
      | command | flag     | prefix                  |
      | ci      | --prefix | testdata/tools/cucumber |
      | ci      | --prefix | testdata/tools/quint    |
