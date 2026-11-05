Feature: Verification notices maintained specifications the candidate did not update
  A verification input can name maintained specification paths and the implementation paths
  they describe. The synthetic repository commits src/a.go, spec/model.qnt,
  spec/features/a.feature and docs/notes.md as the base the candidate starts from; unless a
  case says otherwise, src/a.go is declared as implementation and spec/model.qnt and
  spec/features/a.feature as maintained specifications, in that order, and the one check
  "lint" passes.

  Scenario: Only an implementation file changed: the pass stays green and is flagged once
    When k-verify-maintained-spec-unchanged-notice: the "implementation" candidate is verified
    Then k-verify-maintained-spec-unchanged-notice: the observations include:
      """
      {"declarable":true,"error":"","green":true,"failing":[],
       "record.spec_update":{"implementation_changed_count":1,"implementation_changed":["src/a.go"],"specs_changed_count":0,"specs_changed":[],"specs_unchanged":["spec/model.qnt","spec/features/a.feature"],"specs_not_updated":true},
       "resultsNotices":["specs not updated: implementation files changed: 1 (src/a.go); maintained specifications unchanged: spec/model.qnt, spec/features/a.feature"]}
      """

  Scenario: The feedback of a pass that is red for another reason carries the flag as one line
    When k-verify-maintained-spec-unchanged-notice: the "red-check" candidate is verified
    Then k-verify-maintained-spec-unchanged-notice: the observations include:
      """
      {"declarable":true,"error":"","green":false,"failing":["lint"],
       "record.spec_update.specs_not_updated":true,
       "feedbackIncludes":"lint-broke",
       "feedbackNotices":["specs not updated: implementation files changed: 1 (src/a.go); maintained specifications unchanged: spec/model.qnt, spec/features/a.feature"]}
      """

  Scenario: Implementation and a specification changed: both counts, no flag
    When k-verify-maintained-spec-unchanged-notice: the "both" candidate is verified
    Then k-verify-maintained-spec-unchanged-notice: the observations include:
      """
      {"declarable":true,"error":"","green":true,"failing":[],
       "record.spec_update":{"implementation_changed_count":1,"implementation_changed":["src/a.go"],"specs_changed_count":1,"specs_changed":["spec/features/a.feature"],"specs_unchanged":["spec/model.qnt"],"specs_not_updated":false},
       "resultsNotices":[]}
      """

  Scenario: Only a specification changed: no flag
    When k-verify-maintained-spec-unchanged-notice: the "spec" candidate is verified
    Then k-verify-maintained-spec-unchanged-notice: the observations include:
      """
      {"declarable":true,"error":"","green":true,"failing":[],
       "record.spec_update":{"implementation_changed_count":0,"implementation_changed":[],"specs_changed_count":1,"specs_changed":["spec/model.qnt"],"specs_unchanged":["spec/features/a.feature"],"specs_not_updated":false},
       "resultsNotices":[]}
      """

  Scenario: A changed file under no declared path counts as neither
    When k-verify-maintained-spec-unchanged-notice: the "docs" candidate is verified
    Then k-verify-maintained-spec-unchanged-notice: the observations include:
      """
      {"declarable":true,"error":"","green":true,"failing":[],
       "record.spec_update":{"implementation_changed_count":0,"implementation_changed":[],"specs_changed_count":0,"specs_changed":[],"specs_unchanged":["spec/model.qnt","spec/features/a.feature"],"specs_not_updated":false},
       "resultsNotices":[]}
      """

  Scenario: Require spec update makes the flagged pass red, naming the files and the unchanged specifications
    When k-verify-maintained-spec-unchanged-notice: the "require" candidate is verified
    Then k-verify-maintained-spec-unchanged-notice: the observations include:
      """
      {"declarable":true,"error":"","green":false,
       "failing":["specs not updated: implementation files changed: 1 (src/a.go); maintained specifications unchanged: spec/model.qnt, spec/features/a.feature"],
       "record.green":false,
       "record.spec_update.specs_not_updated":true,
       "feedbackNotices":["specs not updated: implementation files changed: 1 (src/a.go); maintained specifications unchanged: spec/model.qnt, spec/features/a.feature"]}
      """

  Scenario: A declared path that does not exist is refused by name
    When k-verify-maintained-spec-unchanged-notice: the "missing" candidate is verified
    Then k-verify-maintained-spec-unchanged-notice: the observations include:
      """
      {"declarable":true,"errorIncludes":"maintained specification path does not exist in the candidate: spec/missing.qnt"}
      """

  Scenario: 300 changed implementation files keep a bounded list and state the total
    When k-verify-maintained-spec-unchanged-notice: the "many" candidate is verified
    Then k-verify-maintained-spec-unchanged-notice: the observations include:
      """
      {"declarable":true,"error":"","green":true,"failing":[],
       "record.spec_update":{"implementation_changed_count":300,"implementation_changed":["src/gen/f000.go","src/gen/f001.go","src/gen/f002.go","src/gen/f003.go","src/gen/f004.go","src/gen/f005.go","src/gen/f006.go","src/gen/f007.go","src/gen/f008.go","src/gen/f009.go","src/gen/f010.go","src/gen/f011.go","src/gen/f012.go","src/gen/f013.go","src/gen/f014.go","src/gen/f015.go","src/gen/f016.go","src/gen/f017.go","src/gen/f018.go","src/gen/f019.go"],"specs_changed_count":0,"specs_changed":[],"specs_unchanged":["spec/model.qnt","spec/features/a.feature"],"specs_not_updated":true},
       "resultsNotices":["specs not updated: implementation files changed: 300 (src/gen/f000.go, src/gen/f001.go, src/gen/f002.go, src/gen/f003.go, src/gen/f004.go, src/gen/f005.go, src/gen/f006.go, src/gen/f007.go, src/gen/f008.go, src/gen/f009.go, src/gen/f010.go, src/gen/f011.go, src/gen/f012.go, src/gen/f013.go, src/gen/f014.go, src/gen/f015.go, src/gen/f016.go, src/gen/f017.go, src/gen/f018.go, src/gen/f019.go, and 280 more); maintained specifications unchanged: spec/model.qnt, spec/features/a.feature"]}
      """

  Scenario: Nothing declared: record, feedback and reviewer material equal the control
    When k-verify-maintained-spec-unchanged-notice: the "control" candidate is verified
    Then k-verify-maintained-spec-unchanged-notice: the observations include:
      """
      {"declarable":true,"error":"","green":true,"sameRecord":true,"sameFeedback":true,"sameResults":true,"resultsNotices":[]}
      """
