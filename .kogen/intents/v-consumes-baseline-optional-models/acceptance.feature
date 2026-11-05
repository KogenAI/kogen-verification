Feature: The readiness identity contract holds whether or not the coordinator lists an absent lineup file

  The pinned kogen-coordinator always lists .kogen/models.yaml in an Intent's baseline. Its Build
  coord-baseline-optional-files-when-present leaves the file out of the baseline when it is absent, and
  its consumer contract check refused that with
  "kogen-verification TestReadinessRecordAndIdentity contract_test.go:343: identity not current".
  The "absent-file rule" coordinator below is the pinned coordinator's own source with only that rule added,
  selected through a scratch -modfile; the checkout's go.mod and go.sum are not changed.

  Scenario: The consumer contract package passes against the pinned coordinator and against one with the absent-file rule
    Given v-consumes-baseline-optional-models: go.mod has SHA-256 "6eb5ab6850c0f23838702939276a6cb88c680675751cdbec4665e128ed145520" and go.sum has SHA-256 "106e551880e06f9418734c3e530aa1c5bdb6d879110790413b83a602d3530792"
    And v-consumes-baseline-optional-models: go.mod requires "github.com/KogenAI/kogen-coordinator" at "v0.0.0-20261104010828-f15509472852"
    And v-consumes-baseline-optional-models: go.mod requires "github.com/KogenAI/kogen-loop" at "v0.0.0-20261104002337-25d87c2177c3"
    Then v-consumes-baseline-optional-models: a copy of the readiness-simple fixture has these baselines:
      | coordinator      | .kogen/models.yaml | baseline                                                                                                                                              |
      | pinned           | absent             | .kogen/intents/fixture/intent.md, .kogen/intents/fixture/acceptance.feature, features/steps/fixture_steps.js, .kogen/project.yaml, .kogen/models.yaml |
      | pinned           | present            | .kogen/intents/fixture/intent.md, .kogen/intents/fixture/acceptance.feature, features/steps/fixture_steps.js, .kogen/project.yaml, .kogen/models.yaml |
      | absent-file rule | absent             | .kogen/intents/fixture/intent.md, .kogen/intents/fixture/acceptance.feature, features/steps/fixture_steps.js, .kogen/project.yaml                     |
      | absent-file rule | present            | .kogen/intents/fixture/intent.md, .kogen/intents/fixture/acceptance.feature, features/steps/fixture_steps.js, .kogen/project.yaml, .kogen/models.yaml |
    And v-consumes-baseline-optional-models: with the "pinned" coordinator, go test of package "./contract" passes
    And v-consumes-baseline-optional-models: with the "absent-file rule" coordinator, go test of package "./contract" passes
