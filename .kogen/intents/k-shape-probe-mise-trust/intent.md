# Trust the project's tool configuration in probes

Slug: k-shape-probe-mise-trust
Model: not applicable — one environment variable added to each probe's environment; no state or interacting rules
Acceptance:
- .kogen/intents/k-shape-probe-mise-trust/acceptance.feature
- features/steps/probe_trust_steps.js
- features/steps/probetrust.go

Shaping's self-check re-runs each declared check (observer `good`/`bad`, capability `support`) as a probe (`verify.Probe.Run`, SHP-10) in a scratch copy `<os.TempDir()>/kogen-probe-<hex>` with an allowlisted environment and a fresh private HOME. A tool manager that trusts project configuration by location (mise: `.mise.toml` is trusted through the caller's `MISE_TRUSTED_CONFIG_PATHS` or through trust state under the caller's real HOME) does not trust the copy, because the copy's path is random and the probe drops both the variable and the caller's HOME. A control that exits 0 for the model in the project then exits 1 in the self-check ("Config files in /tmp/kogen-probe-.../.mise.toml are not trusted").

After this change the probe trusts the project tool configuration of its own scratch copy: `Probe.Run` sets `MISE_TRUSTED_CONFIG_PATHS` in the probe's environment to the scratch copy's path (the same `scratch` folder the command runs in, as Run creates it), followed by `:` and the caller session's `MISE_TRUSTED_CONFIG_PATHS` value when the caller has a nonempty one. Nothing else in the environment changes: PATH and the other allowlisted variables (`probeEnvKeys`) stay as now, HOME stays the probe's private empty folder, HEX_HOME/MIX_HOME stay as now, and no other caller variable is passed on, so the probe's isolation from the user's real home and scratch state (SHP-10) is unchanged. Trust is not widened beyond the copy: the probe does not trust `/` or any configuration outside its copy that the caller does not trust. A control that genuinely fails still fails the check with its own status and combined output.

The declared-evidence refusal of this package (`verify.Execute`: intent/not_ready "declared feasibility evidence failed" with lines `<id>/<check>: expected {...}; actual {...}`) already carries the failed control's actual exit and combined output, its own error output included; that stays. The shaping refusal text "observer <id> good: exit 1, recorded exit 0" is not produced in this repository; making that message carry the control's output is a follow-up item for the repository that renders it. No CLI command, flag or setting is added.

The acceptance harness `features/steps/probetrust.go` is a `main` package (built by the steps with `go build ./features/steps`) that calls `verify.Probe{Root, Command}.Run` and `verify.Execute` with its own process environment as the caller's; the Build keeps `verify.Probe`, `ProbeResult`, `verify.Execute` and `verify.Tools` usable as that harness uses them.

## Decisions
- The self-check keeps running controls in its scratch copy (not in the working tree) and makes the copy's tool configuration trusted there, so the control runs with the same project tool-configuration trust and the same PATH the model had in the project. (source: request)
- A genuinely failing control still fails the check, with its own exit status and output in the refusal. (source: request)
- The probe's isolation from the user's real home and scratch state (SHP-10) stays intact: HOME stays private and the environment stays allowlisted. (source: request)
- No new CLI commands or flags. (source: request)

## Source comparison
- Problem ("observer <id> good: exit 1, recorded exit 0" when the model's run exited 0; mise refuses `/tmp/kogen-probe-.../.mise.toml` as untrusted): addressed by `MISE_TRUSTED_CONFIG_PATHS=<scratch>[:<caller value>]` in `Probe.Run`; scenarios "A control that passes in the project passes as a probe" and "A declared observer whose good control passes in the project is met".
- Need "same project tool configuration trust, same PATH": addressed (PATH is already inherited and stays so; trust as above). The alternative "or in the working tree" is not chosen, because running in the working tree would give up the scratch isolation the request keeps.
- Need "A genuinely failing control still fails the check": scenario "A control that genuinely fails still fails as a probe" and the refusal scenario.
- Research addition "a refusal that names the control's own error output": in this package the `verify.Execute` refusal already names it, kept and exercised by scenario "The refusal of a genuinely failing observer control names the control's own error output". The shaping message "observer <id> good: exit 1, recorded exit 0" lives outside kogen-verification; per the repository split it is a follow-up item there, not built here.
- Constraint "Synthetic regression test only (a fixture project whose control needs a tool-manager config that is trusted only at its real location); no dependency on Ruby, mise or the AoR tasks": the acceptance fixture is a generated project with `.mise.toml` and a fake `greet` shim on PATH that trusts the config only under an entry of `MISE_TRUSTED_CONFIG_PATHS`, which the caller sets to the project's real location; the Go regression test follows the same pattern. Neither uses Ruby, mise or AoR tasks.
- Constraint "Keep the probe's isolation from the user's real home and scratch state (SHP-10) intact": kept; the existing `TestShapeProbeMinimalEnvironment` keeps holding.
- Research addendum "the probe environment drops the trust setting and the scratch path is random": both addressed by naming the scratch path itself and keeping the caller's value after it.
- Measured host evidence (8/12 Opus cells refused; MISE_TRUSTED_CONFIG_PATHS=/ made the replay pass; 6/12 Intents worked around it with `mise trust -q`): historical evidence, not re-measured. On this shaping host (mise 2026.10.15, macOS), a session-shell check outside the repository showed mise refusing an untrusted `.mise.toml` under a fresh HOME and accepting it when `MISE_TRUSTED_CONFIG_PATHS` named the copy's lexical `/tmp/...` path; this is not a Kogen probe record. Trusting `/` (as in the replay) is not chosen, because it trusts configuration the caller does not; scenario "A probe trusts no tool configuration outside its copy of the project" distinguishes it.

## Tests
- A probe's environment sets `MISE_TRUSTED_CONFIG_PATHS` to its scratch copy, followed by `:` and the caller's value when nonempty, and otherwise keeps the allowlisted environment and private HOME: update `TestShapeProbeMinimalEnvironment` in `verify/evidence_test.go` to assert the variable's value for a caller without it (exactly the scratch path the probe ran in) and with it (scratch path, `:`, caller value), next to its existing isolation assertions (integration)
- A control that exits 0 in a fixture project whose tool-manager config is trusted only at its real location exits 0 as a probe and its declared observer is met by `Execute`: new Go test in `verify/evidence_test.go` with a generated fake shim on PATH like the acceptance fixture, which fails on the unfixed probe with the "not trusted" output (regression)
- Probe trust does not extend outside the scratch copy; a genuinely failing control keeps its own status and output, and the `Execute` refusal names that output: acceptance scenarios through `features/steps/probetrust.go` (scenario)
- The probe's isolation from the caller's home, credentials and other variables (SHP-10) is unchanged: `TestShapeProbeMinimalEnvironment` and `TestShapeProbeMinimalEnvironmentHomeIsRemovedOnEveryReturn` (existing)

## Feasibility
- none
