Feature: Readiness records failure phases and refuses broken setup

  Background:
    Given k-verify-failed-readiness-setup-visible: the fixture file "product.cjs":
      """
      module.exports = {};
      """
    And k-verify-failed-readiness-setup-visible: the fixture file "features/steps/fixture_steps.js":
      """
      const {Given, When, Then} = require('@cucumber/cucumber');
      const fs = require('node:fs');
      const product = require('../../product.cjs');
      Given('an empty fixture', function () {});
      Given('a seeded fixture', function () { this.seed = JSON.parse(fs.readFileSync('fixtures/seed.json', 'utf8')); });
      Given('a prepared product', function () { product.prepare(); });
      Given('a configured helper', function () { throw new TypeError('broken setup helper'); });
      When('the product starts', function () { product.start(); });
      Then('the product answers {int}', function (n) { if (product.answer() !== n) throw new Error('wrong answer'); });
      Then('the fixture is seeded', function () { if (!this.seed) throw new Error('no seed'); });
      """

  Scenario: A Given that throws on a bad fixture path is a setup failure
    Given k-verify-failed-readiness-setup-visible: the fixture file ".kogen/intents/fixture/acceptance.feature":
      """
      Feature: Fixture
        Scenario: First
          Given a seeded fixture
          Then the product answers 42
      """
    When k-verify-failed-readiness-setup-visible: readiness checks the fixture Intent
    Then k-verify-failed-readiness-setup-visible: readiness refuses with "intent/not_ready" and the refusal includes these lines in order:
      | line                                                               |
      | setup failure: First (line 2)                                      |
      | acceptance.feature line 3: Given a seeded fixture                  |
      | Error: ENOENT: no such file or directory, open 'fixtures/seed.json' |
    And k-verify-failed-readiness-setup-visible: no readiness evidence is recorded or reusable

  Scenario: A failing Background step is a setup failure
    Given k-verify-failed-readiness-setup-visible: the fixture file ".kogen/intents/fixture/acceptance.feature":
      """
      Feature: Fixture
        Background:
          Given a seeded fixture
        Scenario: First
          Then the product answers 42
      """
    When k-verify-failed-readiness-setup-visible: readiness checks the fixture Intent
    Then k-verify-failed-readiness-setup-visible: readiness refuses with "intent/not_ready" and the refusal includes these lines in order:
      | line                                                               |
      | setup failure: First (line 4)                                      |
      | acceptance.feature line 3: Given a seeded fixture                  |
      | Error: ENOENT: no such file or directory, open 'fixtures/seed.json' |
    And k-verify-failed-readiness-setup-visible: no readiness evidence is recorded or reusable

  Scenario: A failing Before hook is a setup failure
    Given k-verify-failed-readiness-setup-visible: the fixture file "features/steps/fixture_steps.js":
      """
      const {Before, Given, Then} = require('@cucumber/cucumber');
      Before({name: 'shared fixture'}, function () { throw new Error('fixture service down'); });
      Given('an empty fixture', function () {});
      Then('the product answers {int}', function (n) { throw new Error('wrong answer'); });
      """
    And k-verify-failed-readiness-setup-visible: the fixture file ".kogen/intents/fixture/acceptance.feature":
      """
      Feature: Fixture
        Scenario: First
          Given an empty fixture
          Then the product answers 42
      """
    When k-verify-failed-readiness-setup-visible: readiness checks the fixture Intent
    Then k-verify-failed-readiness-setup-visible: readiness refuses with "intent/not_ready" and the refusal includes these lines in order:
      | line                                                                 |
      | setup failure: First (line 2)                                        |
      | hook shared fixture: a hook at features/steps/fixture_steps.js line 2 |
      | Error: fixture service down                                          |
    And k-verify-failed-readiness-setup-visible: no readiness evidence is recorded or reusable

  Scenario: A Then that fails because the feature is missing is accepted as an assertion failure
    Given k-verify-failed-readiness-setup-visible: the fixture file "fixtures/seed.json":
      """
      {"seed": 1}
      """
    And k-verify-failed-readiness-setup-visible: the fixture file ".kogen/intents/fixture/acceptance.feature":
      """
      Feature: Fixture
        Scenario: First
          Given a seeded fixture
          Then the product answers 42
      """
    When k-verify-failed-readiness-setup-visible: readiness checks the fixture Intent
    Then k-verify-failed-readiness-setup-visible: readiness is ready with recorded, reusable evidence
    And k-verify-failed-readiness-setup-visible: the readiness evidence records these scenarios:
      | name  | status | phase     | step                                                 | output                                     |
      | First | failed | assertion | acceptance.feature line 4: Then the product answers 42 | TypeError: product.answer is not a function |
    And k-verify-failed-readiness-setup-visible: the readiness observations include these lines in order:
      | line                                                 |
      | Scenario: First (acceptance.feature line 2)          |
      | Failure phase: assertion                             |
      | acceptance.feature line 4: Then the product answers 42 |
      | TypeError: product.answer is not a function          |

  Scenario: A mixed Intent refuses the setup failure and names the accepted ones
    Given k-verify-failed-readiness-setup-visible: the fixture file ".kogen/intents/fixture/acceptance.feature":
      """
      Feature: Fixture
        Scenario: First
          Given an empty fixture
          Then the product answers 42
        Scenario: Seeded
          Given a seeded fixture
          Then the product answers 42
        Scenario: Later
          Given an empty fixture
          Then the product answers 42
      """
    When k-verify-failed-readiness-setup-visible: readiness checks the fixture Intent
    Then k-verify-failed-readiness-setup-visible: readiness refuses with "intent/not_ready" and the refusal includes these lines in order:
      | line                                                               |
      | setup failure: Seeded (line 5)                                     |
      | acceptance.feature line 6: Given a seeded fixture                  |
      | Error: ENOENT: no such file or directory, open 'fixtures/seed.json' |
      | accepted assertion failure: First (line 2)                         |
      | accepted assertion failure: Later (line 8)                         |
    And k-verify-failed-readiness-setup-visible: the refusal includes none of these lines:
      | line                          |
      | setup failure: First (line 2) |
      | setup failure: Later (line 8) |
    And k-verify-failed-readiness-setup-visible: no readiness evidence is recorded or reusable

  Scenario: A Given that calls a function the feature will add is accepted with phase setup
    Given k-verify-failed-readiness-setup-visible: the fixture file ".kogen/intents/fixture/acceptance.feature":
      """
      Feature: Fixture
        Scenario: First
          Given a prepared product
          Then the product answers 42
      """
    When k-verify-failed-readiness-setup-visible: readiness checks the fixture Intent
    Then k-verify-failed-readiness-setup-visible: readiness is ready with recorded, reusable evidence
    And k-verify-failed-readiness-setup-visible: the readiness evidence records these scenarios:
      | name  | status | phase | step                                              | output                                      |
      | First | failed | setup | acceptance.feature line 3: Given a prepared product | TypeError: product.prepare is not a function |
    And k-verify-failed-readiness-setup-visible: the readiness observations include these lines in order:
      | line                                              |
      | Scenario: First (acceptance.feature line 2)       |
      | Failure phase: setup                              |
      | acceptance.feature line 3: Given a prepared product |
      | TypeError: product.prepare is not a function      |

  Scenario: A setup TypeError that is not a missing function is still refused
    Given k-verify-failed-readiness-setup-visible: the fixture file ".kogen/intents/fixture/acceptance.feature":
      """
      Feature: Fixture
        Scenario: First
          Given a configured helper
          Then the product answers 42
      """
    When k-verify-failed-readiness-setup-visible: readiness checks the fixture Intent
    Then k-verify-failed-readiness-setup-visible: readiness refuses with "intent/not_ready" and the refusal includes these lines in order:
      | line                                               |
      | setup failure: First (line 2)                      |
      | acceptance.feature line 3: Given a configured helper |
      | TypeError: broken setup helper                     |
    And k-verify-failed-readiness-setup-visible: no readiness evidence is recorded or reusable

  Scenario: The evidence lists the phase and output of every failed scenario
    Given k-verify-failed-readiness-setup-visible: the fixture file "fixtures/seed.json":
      """
      {"seed": 1}
      """
    And k-verify-failed-readiness-setup-visible: the fixture file ".kogen/intents/fixture/acceptance.feature":
      """
      Feature: Fixture
        Scenario: Seeded
          Given a seeded fixture
          Then the fixture is seeded
        Scenario: Started
          Given a seeded fixture
          When the product starts
          Then the product answers 42
        Scenario: Answered
          Given a seeded fixture
          Then the product answers 42
        Scenario: Prepared
          Given a prepared product
          Then the product answers 42
      """
    When k-verify-failed-readiness-setup-visible: readiness checks the fixture Intent
    Then k-verify-failed-readiness-setup-visible: readiness is ready with recorded, reusable evidence
    And k-verify-failed-readiness-setup-visible: the readiness evidence records these scenarios:
      | name     | status | phase     | step                                                  | output                                      |
      | Seeded   | passed | -         | -                                                     | -                                           |
      | Started  | failed | action    | acceptance.feature line 7: When the product starts     | TypeError: product.start is not a function   |
      | Answered | failed | assertion | acceptance.feature line 11: Then the product answers 42 | TypeError: product.answer is not a function  |
      | Prepared | failed | setup     | acceptance.feature line 13: Given a prepared product   | TypeError: product.prepare is not a function |
    And k-verify-failed-readiness-setup-visible: the readiness observations include these lines in order:
      | line                                            |
      | Scenario: Started (acceptance.feature line 5)   |
      | Failure phase: action                           |
      | Scenario: Answered (acceptance.feature line 9)  |
      | Failure phase: assertion                        |
      | Scenario: Prepared (acceptance.feature line 12) |
      | Failure phase: setup                            |
