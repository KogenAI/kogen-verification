Feature: A fresh clone prepares and checks the Cucumber its tests need

  Scenario: Without Cucumber the Cucumber-dependent tests fail with the one named message
    Given k-verify-fresh-clone-cucumber: an empty folder "verify" to run the compiled verification tests in
    And k-verify-fresh-clone-cucumber: KOGEN_CUCUMBER is not set
    When k-verify-fresh-clone-cucumber: the compiled verification tests named below run in that folder
      | TestRealQuintTypecheckFailureIsNamedWithItsStatusAndOutput                               |
      | TestRealDeclaredCucumberFailFastKeepsFailedAndSkippedCasesRedWhileCompleteExitZeroIsGreen |
      | TestNamedFeedbackMissingTests                                                            |
      | TestUnusedStepWarnReadiness                                                              |
      | TestUnusedStepWarnReadinessRefusals                                                      |
      | TestRedactorMasksKnownAndLabeledSecrets                                                  |
      | TestRedactionPrecedesTheBounds                                                           |
    Then k-verify-fresh-clone-cucumber: exactly these tests failed
      | TestRealQuintTypecheckFailureIsNamedWithItsStatusAndOutput                               |
      | TestRealDeclaredCucumberFailFastKeepsFailedAndSkippedCasesRedWhileCompleteExitZeroIsGreen |
      | TestNamedFeedbackMissingTests                                                            |
      | TestUnusedStepWarnReadiness                                                              |
      | TestUnusedStepWarnReadinessRefusals                                                      |
    And k-verify-fresh-clone-cucumber: every failure message is exactly "missing prerequisite: Cucumber is not installed; run the setup command: go run github.com/KogenAI/kogen-verification/cmd/setup-tools"
    And k-verify-fresh-clone-cucumber: these tests passed
      | TestRedactorMasksKnownAndLabeledSecrets |
      | TestRedactionPrecedesTheBounds          |

  Scenario: A KOGEN_CUCUMBER folder without Cucumber does not stand in for it
    Given k-verify-fresh-clone-cucumber: an empty folder "verify" to run the compiled verification tests in
    And k-verify-fresh-clone-cucumber: KOGEN_CUCUMBER names an existing folder that holds no Cucumber
    When k-verify-fresh-clone-cucumber: the compiled verification tests named below run in that folder
      | TestRealQuintTypecheckFailureIsNamedWithItsStatusAndOutput |
      | TestUnusedStepWarnReadinessRefusals                        |
      | TestRedactorMasksKnownAndLabeledSecrets                    |
    Then k-verify-fresh-clone-cucumber: exactly these tests failed
      | TestRealQuintTypecheckFailureIsNamedWithItsStatusAndOutput |
      | TestUnusedStepWarnReadinessRefusals                        |
    And k-verify-fresh-clone-cucumber: every failure message is exactly "missing prerequisite: Cucumber is not installed; run the setup command: go run github.com/KogenAI/kogen-verification/cmd/setup-tools"
    And k-verify-fresh-clone-cucumber: these tests passed
      | TestRedactorMasksKnownAndLabeledSecrets |

  Scenario: A Cucumber found through KOGEN_CUCUMBER is not reported missing
    Given k-verify-fresh-clone-cucumber: an empty folder "verify" to run the compiled verification tests in
    And k-verify-fresh-clone-cucumber: KOGEN_CUCUMBER names a folder holding a stand-in Cucumber
    When k-verify-fresh-clone-cucumber: the compiled verification tests named below run in that folder
      | TestRealQuintTypecheckFailureIsNamedWithItsStatusAndOutput |
    Then k-verify-fresh-clone-cucumber: these tests did not fail
      | TestRealQuintTypecheckFailureIsNamedWithItsStatusAndOutput |
    And k-verify-fresh-clone-cucumber: the output does not show "missing prerequisite"

  Scenario: A consumer module without Cucumber fails its test with the same message
    Given k-verify-fresh-clone-cucumber: a consumer module that requires this repository and whose test asks prereq.Cucumber for the install
    When k-verify-fresh-clone-cucumber: the consumer tests run offline
    Then k-verify-fresh-clone-cucumber: the consumer test failed with the message "missing prerequisite: Cucumber is not installed; run the setup command: go run github.com/KogenAI/kogen-verification/cmd/setup-tools"

  Scenario: A consumer module with its own install finds it
    Given k-verify-fresh-clone-cucumber: a consumer module that requires this repository and whose test asks prereq.Cucumber for the install
    And k-verify-fresh-clone-cucumber: the consumer has a stand-in Cucumber in its own install folder
    When k-verify-fresh-clone-cucumber: the consumer tests run offline
    Then k-verify-fresh-clone-cucumber: the consumer test passed and found the consumer's own install folder

  Scenario: The setup command installs the pinned Cucumber and Quint with npm ci
    Given k-verify-fresh-clone-cucumber: a stand-in npm that records each call and the files it finds under the prefix
    And k-verify-fresh-clone-cucumber: an empty folder to run the setup program in
    When k-verify-fresh-clone-cucumber: the setup program built from "./cmd/setup-tools" runs there
    Then k-verify-fresh-clone-cucumber: the setup program exits with status zero
    And k-verify-fresh-clone-cucumber: the stand-in npm was called exactly
      | ci --prefix testdata/tools/cucumber manifest=yes lock=yes |
      | ci --prefix testdata/tools/quint manifest=yes lock=yes    |
    And k-verify-fresh-clone-cucumber: that folder holds the pinned package.json and package-lock.json of cucumber and quint

  Scenario: A failing npm makes the setup command stop with a failure
    Given k-verify-fresh-clone-cucumber: a stand-in npm that records each call and the files it finds under the prefix
    And k-verify-fresh-clone-cucumber: the stand-in npm exits with status 7
    And k-verify-fresh-clone-cucumber: an empty folder to run the setup program in
    When k-verify-fresh-clone-cucumber: the setup program built from "./cmd/setup-tools" runs there
    Then k-verify-fresh-clone-cucumber: the setup program exits with a nonzero status
    And k-verify-fresh-clone-cucumber: the stand-in npm was called exactly
      | ci --prefix testdata/tools/cucumber manifest=yes lock=yes |
    And k-verify-fresh-clone-cucumber: the setup output names "npm ci --prefix testdata/tools/cucumber"

  Scenario: The README lists the prerequisites and the one setup command
    Then k-verify-fresh-clone-cucumber: the README has a Prerequisites section that names Go, Node.js and npm and holds the setup command "go run github.com/KogenAI/kogen-verification/cmd/setup-tools"
    And k-verify-fresh-clone-cucumber: the setup command "go run github.com/KogenAI/kogen-verification/cmd/setup-tools" appears once in the README
