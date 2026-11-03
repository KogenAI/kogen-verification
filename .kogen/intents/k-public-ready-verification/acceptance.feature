Feature: Public verification documentation
  Scenario: Public clone instructions and component identity
    Then public README matches "deterministic verification"
    And public README matches "https://github.com/KogenAI/kogen"
    And public README matches "npm ci --prefix testdata/tools/cucumber"
    And public README matches "npm ci --prefix testdata/tools/quint"
    And public README matches "go build ./.*go vet ./.*go test -race -count=1 ./"
    And public README matches "(?i)node|npm"
    And public README matches "1[.]27[.]2"
    And public README contains exactly one inquiry address "contact@kogen.dev"
    And public README excludes "(?i)GOPRIVATE|insteadOf|private KogenAI|token|private mirror"

  Scenario: Current documentation does not disclose machine paths
    Then tracked public Markdown excludes "[/](Users|home)[/][^ /\n]+|~[/](Scratch|work)[.]noindex"

  Scenario: No unavailable policy documents
    Then public policy files are absent
