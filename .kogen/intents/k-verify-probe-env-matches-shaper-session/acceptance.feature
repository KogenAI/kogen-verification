Feature: Explain declared probe environment mismatches
  Scenario: Explain the reporter mismatch without exposing credentials
    Given k-verify-probe-env-matches-shaper-session: the caller sets REPORTER to 0 and a synthetic SECRET_TOKEN_X
    Then k-verify-probe-env-matches-shaper-session: declaring "runs\n" for command "if [ \"${REPORTER+x}\" = x ]; then echo runs; else echo tests; fi" is refused with actual "tests\n"

  Scenario: Accept expectations recorded under the restricted environment
    Given k-verify-probe-env-matches-shaper-session: the caller sets REPORTER to 0 and a synthetic SECRET_TOKEN_X
    Then k-verify-probe-env-matches-shaper-session: declaring "tests\n" for command "if [ \"${REPORTER+x}\" = x ]; then echo runs; else echo tests; fi" is accepted with actual "tests\n"

  Scenario: Preserve an already passing probe without an extra line
    Given k-verify-probe-env-matches-shaper-session: the caller sets REPORTER to 0 and a synthetic SECRET_TOKEN_X
    Then k-verify-probe-env-matches-shaper-session: declaring "stable\n" for command "echo stable" is accepted with actual "stable\n"

  Scenario: Keep dropped variable values out of the probe
    Given k-verify-probe-env-matches-shaper-session: the caller sets REPORTER to 0 and a synthetic SECRET_TOKEN_X
    Then k-verify-probe-env-matches-shaper-session: declaring "unset\n" for command "echo \"${REPORTER:-unset}\"" is accepted with actual "unset\n"
