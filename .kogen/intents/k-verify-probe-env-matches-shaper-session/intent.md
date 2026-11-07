# Explain probe environment output mismatches

Slug: k-verify-probe-env-matches-shaper-session
Model: not applicable — this change adds diagnostic context to a comparison, not state transitions
Acceptance:
- .kogen/intents/k-verify-probe-env-matches-shaper-session/acceptance.feature
- features/steps/k-verify-probe-env-matches-shaper-session__steps.js

When readiness refuses declared feasibility evidence because actual probe output differs from the declaration, retain the existing expected/actual detail and also explain that probes run under a restricted environment. Name the caller-set variables omitted from that environment, with variable names only, never their values. Do not change the allowlist, probe output, evidence comparison, or acceptance of probes that already pass. Emit no additional diagnostic for passing probes. This prevents repeated recording of unrestricted-shell output without explaining the mismatch.

The additional context must remain safe wherever the refusal or probe is recorded: no dropped caller values in the refusal, run logs, or retained evidence. This is not a request to redact arbitrary program output or supplied declarations that independently contain sensitive data. Derive names from the caller session, not the ambient environment of another process. Keep names unique and sorted for deterministic output. Report omitted variables, not variables present in the effective probe environment with private or transformed values. Preserve the existing special handling of tool homes, mise, locale, HOME and temporary directories. Do not append the explanation to ProbeResult.Output or the actual check output.

Update existing delivered tests or goldens that encode the old output of the changed refusal, in the same implementation. Keep useful existing environment-isolation and passing-probe coverage. Do not turn this into an allowlist change or a broad guidance rewrite. The delivery note's builder-reported contradiction is not authority to change preserved behavior; source and tests were inspected before specifying it.

## Decisions
- Report omitted caller variable names only; do not label private HOME, TMPDIR or transformed tool-location entries as absent when their keys exist in the effective probe environment. Preserve the current probe environment exactly. (evidence: verify/probe.go; verify/evidence_test.go) (source: request)
- Exercise the real declared-evidence readiness executor through Execute, with real local shell probes and retained evidence, rather than inventing a CLI for this component. (evidence: verify/feasibility.go; verify/evidence_test.go; README.md) (source: request)
- Add context only for output mismatches and leave successful evidence free of new diagnostic text; keep existing expected/actual data intact. (source: request)
- Qualify the generated observer with known-good and deliberately wrong results; its good command prints observer good with exit zero and its bad command prints observer bad rejected with exit one. (evidence: ran `node features/steps/k-verify-probe-env-matches-shaper-session__steps.js good; a=$?; node features/steps/k-verify-probe-env-matches-shaper-session__steps.js bad; b=$?; test "$a" = 0 && test "$b" = 1`) (source: request)

## Source comparison
- addressed: Request Problem and Need — output-mismatch refusals explain the restricted environment and name dropped caller variables; outcome prose and the reporter-mismatch scenario cover the new behavior.
- addressed: Synthetic acceptance 1 — the fixture check selects reporter wording from REPORTER, the caller supplies REPORTER=0, and Execute refuses the unrestricted expected output while retaining expected/actual detail.
- addressed: Synthetic acceptance 2 — caller SECRET_TOKEN_X has a credential-shaped synthetic value; every scenario checks that the value is absent from refusal, captured probe run logs and retained evidence. The mismatch checks the variable name is present.
- addressed: Synthetic acceptance 3 — corrected restricted-environment expectations and an environment-independent passing probe remain accepted with no refusal text.
- addressed: Synthetic acceptance 4 — the supplied echo form verifies that REPORTER is still absent in the real probe environment.
- addressed: Delivery note — preservation decisions cite current probeEnv and tests, and implementation must update tests of changed refusal behavior rather than freezing the old diagnostic.
- omitted: no requested product behavior. No external provider or library capability change is involved; no network lookup is required.

## Tests
- Explain output mismatch without changing comparison detail: add focused executor regression coverage with a dropped reporter selector (regression)
- Never disclose dropped values in diagnostics or evidence: inspect refusal, real probe logger events and retained evidence with a synthetic credential (integration)
- Preserve corrected and previously passing probes: exercise both successful output cases without extra refusal text (integration)
- Preserve environment isolation: exercise a shell expansion of the dropped variable and retain existing minimal-environment tests (integration)
- Update expectations for changed diagnostics: update affected delivered tests and regenerate only deliberately changed golden outputs using the documented update flag (existing)

## Feasibility
- Observer controls accepted the known-good results and rejected deliberately wrong results. (probe 1: exit 0, 0.1 s)
- evidence: {"id":"env-observer","kind":"observer","inputs":[],"observers":["features/steps/k-verify-probe-env-matches-shaper-session__steps.js"],"checks":[{"name":"good","command":"node features/steps/k-verify-probe-env-matches-shaper-session__steps.js good","exit":0,"output":"observer good\n"},{"name":"bad","command":"node features/steps/k-verify-probe-env-matches-shaper-session__steps.js bad","exit":1,"output":"observer bad rejected\n"}]}
