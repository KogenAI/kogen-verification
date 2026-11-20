Feature: A cohort member writes a line when it ends

  Scenario: Each finished member writes its own line
    When verify-pass-lines-cohort-elapsed: the cohort runs of fake commands have run
    Then verify-pass-lines-cohort-elapsed: the "pair" cohort progress lines match:
      """
      {"names":[{"name":"ca","status":0},{"name":"cb","status":3}],"absent":[],"ordered":false}
      """

  Scenario: Lines are written in the order members finish and seconds are rounded half up
    When verify-pass-lines-cohort-elapsed: the cohort runs of fake commands have run
    Then verify-pass-lines-cohort-elapsed: the "order" cohort progress lines match:
      """
      {"names":[{"name":"quick","status":0},{"name":"slow","status":0}],"absent":[],"ordered":true,"atLeastSeconds":{"slow":2}}
      """

  Scenario: A cancelled member writes no line
    When verify-pass-lines-cohort-elapsed: the cohort runs of fake commands have run
    Then verify-pass-lines-cohort-elapsed: the "cancel" cohort progress lines match:
      """
      {"names":[{"name":"first","status":3}],"absent":["second"],"ordered":true}
      """

  Scenario: A whole verification pass of go build and go vet writes the lines of the cohort
    When verify-pass-lines-cohort-elapsed: the cohort runs of fake commands have run
    Then verify-pass-lines-cohort-elapsed: the "verify" cohort progress lines match:
      """
      {"names":[{"name":"vet","status":3},{"name":"build","status":0}],"absent":[],"ordered":true}
      """
