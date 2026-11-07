# Diagnose broken Kogen installs before verification

Slug: broken-kogen-install-blamed-on-intent
Model: not applicable — install validation is a stateless filesystem predicate and early refusal, not a lifecycle
Acceptance:
- .kogen/intents/broken-kogen-install-blamed-on-intent/acceptance.feature
- features/steps/broken-kogen-install-blamed-on-intent__install.js

Validate Kogen's own installation once before acceptance, step analysis or model work, including model-free Intents. Refuse with environment/tool_missing, exit 3, and a reinstall Kogen instruction instead of blaming project steps or Intent readiness. Keep verify.Tools.Require and add RequireInstall as intended by the request. Node precedes Cucumber, which precedes conditional Quint. Do not change successful verification, model results, acceptance reporting or project tool lookup.

Resolve node-path to a trimmed executable regular-file target. Never expose an unreadable node-path file as Node. Distinguish missing, unreadable, empty, target missing, target not regular, and target not executable; diagnostics name node-path and any known target. Mode 000 must be diagnosed as unreadable even under privileged testing. Cucumber requires the @cucumber/cucumber package under Tools.Cucumber, not merely its parent directory. Quint is required only with an Intent model. Update delivered tests encoding superseded behavior, including the unreadable-file fallback assertion in verify/tools_test.go. Update synthetic existing fixtures to provide valid install tools where newly necessary, without weakening their original assertions. No provider, installer or configuration feature is added.

## Decisions
- Choose the simplest placement and wording: validate at the verification boundary before tool-dependent work, and use stable plain diagnostic causes with the existing reinstall Kogen suffix. (source: request)
- Preserve direct Tools.Require's Node-then-Quint contract and missing-tool wording separately from the broader install gate, strengthening its Node rule to executable regular file. (evidence: verify/env.go; verify/tools_test.go) (source: request)
- Keep successful model-free readiness's accounted scenarios and acceptance-exit behavior unchanged. (evidence: verify/readiness_test.go; verify/helper_project_test.go) (source: request)

## Source comparison
- Addressed: the Problem and Need paragraphs are implemented by the early install gate, path diagnostics, Cucumber package check and conditional Quint requirement above; this supersedes the model-only gate in verify/readiness.go and unreadable-path fallback in verify/env.go.
- Addressed: synthetic acceptance cases are retained in acceptance.feature, including complete model-free installs, mode 000, non-executable and directory targets, incomplete Cucumber, and Node-first precedence. Additional requested missing-target and model cases remain required regression tests.
- Addressed: paired-consumer delivery requires retaining the executable-node verify.Tools.Require rule and RequireInstall, not reverting to old consumer expectations. The protected-baseline delivery note is respected by preserving the current direct Require contract rather than requiring Cucumber there.
- Addressed: request's no-more-questions decision selects simplest wording and placement without additional caller questions. Replaces k-verify-tools-node-path-resolved and k-verify-tools-cucumber-required as requested; no unrelated historical work is resumed.

## Tests
- Executable Node and distinct node-path failures: add filesystem regression tests and update TestToolsFromInstallResolveNodeAndTheBundledTools (regression)
- Model-free early refusal and Node/Cucumber/Quint priority: add readiness integration tests proving no acceptance command starts (integration)
- Complete installs preserve trimmed KOGEN_NODE and successful readiness: exercise the synthetic install through readiness (integration)
- Quint remains conditional and existing model results are unchanged: retain existing model coverage and add complete-install model readiness coverage (regression)
- Direct Tools.Require compatibility: update focused Tools tests for the executable-node rule, preserving other behavior (regression)

## Feasibility
- none
