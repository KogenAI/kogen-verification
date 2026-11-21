Feature: A step self-check refusal names a remedy that fits the wrapper
  This feature covers the refusal of a step definition that asserts an exit code but obtains it
  through a wrapper that changes exit codes.

  Scenario: npm run is refused with a fitting remedy
    Given verify-exit-wrapper-names-fitting-remedy: a step definition whose body is "run('npm run build'); assert.equal(r.status, 0)"
    When verify-exit-wrapper-names-fitting-remedy: the step self-check analyses the definition
    Then verify-exit-wrapper-names-fitting-remedy: the definition is refused once
    And verify-exit-wrapper-names-fitting-remedy: the refusal contains "npm run"
    And verify-exit-wrapper-names-fitting-remedy: the refusal contains "directly"
    And verify-exit-wrapper-names-fitting-remedy: the refusal does not contain "go build"

  Scenario: npx is refused with a fitting remedy
    Given verify-exit-wrapper-names-fitting-remedy: a step definition whose body is "run('npx astro build'); assert.equal(r.status, 0)"
    When verify-exit-wrapper-names-fitting-remedy: the step self-check analyses the definition
    Then verify-exit-wrapper-names-fitting-remedy: the definition is refused once
    And verify-exit-wrapper-names-fitting-remedy: the refusal contains "npx"
    And verify-exit-wrapper-names-fitting-remedy: the refusal does not contain "go build"

  Scenario: go run keeps its refusal exactly
    Given verify-exit-wrapper-names-fitting-remedy: a step definition whose body is "run('go run ./cmd/tool'); assert.equal(r.status, 0)"
    When verify-exit-wrapper-names-fitting-remedy: the step self-check analyses the definition
    Then verify-exit-wrapper-names-fitting-remedy: the refusal is exactly "step definition the candidate runs asserts an exit code but obtains it through go run, which changes exit codes; build the binary (go build) and run it instead"

  Scenario: several wrappers give one refusal naming the first
    Given verify-exit-wrapper-names-fitting-remedy: a step definition whose body is "run('npm run build'); run('go run ./cmd/tool'); assert.equal(r.status, 0)"
    When verify-exit-wrapper-names-fitting-remedy: the step self-check analyses the definition
    Then verify-exit-wrapper-names-fitting-remedy: the definition is refused once
    And verify-exit-wrapper-names-fitting-remedy: the refusal contains "npm run"
    And verify-exit-wrapper-names-fitting-remedy: the refusal does not contain "go run"

  Scenario: npm run without an exit code is not refused
    Given verify-exit-wrapper-names-fitting-remedy: a step definition whose body is "run('npm run build'); assert.ok(r.stdout)"
    When verify-exit-wrapper-names-fitting-remedy: the step self-check analyses the definition
    Then verify-exit-wrapper-names-fitting-remedy: the definition is not refused
