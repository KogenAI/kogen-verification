# Explain missing Git metadata in probes

Slug: k-verify-probe-no-git
Model: not applicable — this is a result annotation, with no new state or lifecycle
Acceptance:
- .kogen/intents/k-verify-probe-no-git/acceptance.feature
- features/steps/probe_trust_steps.js
- features/steps/probetrust.go

Keep CopyTree's deliberate exclusion of .git. In verify/probe.go only, annotate Probe.Run's returned combined output when it contains Git's `fatal: not a git repository` diagnostic: append a newline-delimited explanatory line containing the exact phrase `probe copy has no git metadata`, explaining that this is scratch-copy isolation, not evidence that the source project lacks a repository. Preserve the original command output as a prefix, its exit status and timeout flag. Do not refuse commands by parsing shell syntax, copy Git metadata, initialize a synthetic repository, or route Git back to the real project. Commands without that diagnostic retain their output unchanged, including successful commands. Annotation applies even when the shell subsequently exits successfully.

Implementation scope is CopyTree/Probe.Run in verify/probe.go, plus focused implementation regression tests. Do not change probeEnv, private temporary directory behavior, dependencies, runner configuration or unrelated probe behavior. Existing timeout, cleanup and evidence accounting remain intact.

## Decisions
- Select the explicit diagnostic alternative, retaining the intentional metadata exclusion and absolute isolation of the real repository rather than copying a potentially linked Git directory (source: request).
- Preserve the actual Git failure and explain its scratch-copy context rather than pretending Git succeeded (source: request).

## Source comparison
- Addressed: request Need's two alternatives are settled on diagnostic output; the complete contract above and acceptance scenarios require `probe copy has no git metadata` while retaining real command status/output and source isolation. Usable copied Git state is deliberately not selected.
- Addressed: Evidence's historical verify/probe.go:148-166 at 587f67d was re-read at head: CopyTree explicitly excludes .git at lines 73-85 and Probe.Run copies at 170. Historical coordinator counts (3 of 200 retained cells, none terminal: aorctl-st2 kamal r3, dsscreen kamal g1, aorclaude6-lm entropy; climb/coordinator/LANE.md git state errors row) remain context, not an expanded reliability claim or executable dependency.
- Addressed: Independence's X-V2 model-free reproduction gate was run locally through the existing real Probe.Run harness: a fresh initialized repository yields status 128 and `fatal: not a git repository (or any of the parent directories): .git\n` in the probe. SHELF-BATCH-20261103.md is not present in this tree; no additional unpublished experiment requirements are invented. Acceptance repeats that reproducer. Existing Rails/Bundler and second-temp/environment work is preserved; file-level delivery should queue after K-PROBE-RAILS-BUNDLER if necessary.
- Addressed: exact requested slug and Intent paths are used. README testing commands and docs/testing-rules.md's integration/regression requirements are retained; no external protocol or library change requires documentation research.

## Tests
- Git's missing-repository diagnostic is contextualized, without dropping original output or exit status: real initialized source repository probed with git status (regression).
- A shell that handles the Git failure still receives the explanation: real probe with final exit 0 (integration).
- Scratch Git writes cannot mutate the source repository and scratch worktree writes stay disposable: source Git config and file absence checks after probe (integration).
- Output of commands without the diagnostic is unchanged: successful non-Git probe with exact output (integration).

## Feasibility
- Model-free X-V2 reproduction: `go build -o /tmp/kogen-no-git-harness ./features/steps` followed by the existing harness's `probe` route on a fresh `git init -q` directory returned JSON {"output":"fatal: not a git repository (or any of the parent directories): .git\n","status":128,"timed_out":false}. Probe exit 0, 1.4 seconds. This establishes the reported misleading result, not exhaustive isolation proof. Acceptance reuses existing observers without generating a new protected driver.
