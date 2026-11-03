# Report unreadable timeout output honestly

Slug: k-verify-unknown-timeout-output
Model: not applicable — this changes diagnostic representation of a completed timeout observation, not process lifecycle or approval state transitions
Acceptance:
- .kogen/intents/k-verify-unknown-timeout-output/acceptance.feature
- features/steps/unknown_timeout_steps.js
- features/steps/unknown_timeout_observer.js
- features/steps/testdata/unknown_timeout/driver.go

Correct the general approval-attempt timeout diagnostic in verify/attempt.go. When process-group disappearance cannot be observed after a timed-out command is stopped, its result remains unknown and output collection is unavailable. Say "Its output could not be read." rather than asserting silence. Retain an explicit `output_unavailable: true` on that AttemptStep. An absent/empty `output` alone must never represent this state. Ordinary collected output retains its existing representation.

If partial combined stdout/stderr is available, preserve it in the step's `output` and display it using the existing timeout output heading, redaction, cap and diagnostic formatting, even when collection is incomplete. The unreadable-output notice and unavailability marker still apply in that case. Do not invent partial output when the runner returned none. Preserve genuinely silent ordinary timeouts' existing sentence, "It wrote no output before it was stopped."

Do not change exit status (environment/step_timeout, exit 3), the historical 120-second per-step bound, process-group signaling, observation or teardown, or any other refusal line. In particular retain command, step list with wall times, Not run where there are unreached planned steps, load line, and evidence path. Preserve unknown-result wording, absent exit status for unknown steps, and retained evidence privacy. No new configuration, production timeout setting, dependency change, or production process abstraction is required.

## Decisions
- Distinguish unavailable output from observed silence in both refusal text and retained evidence; retain any available partial output (source: request).
- Preserve ordinary partial-output and truly silent timeout behavior, and all unrelated refusal diagnostics and lifecycle semantics (source: request).

## Source comparison
- Addressed: request Problem and Need replace the false silence claim in verify/attempt.go's unknown-observation path with an explicit unreadability notice and `output_unavailable: true`; the prose above and unknown-output scenario define the replacement.
- Addressed: synthetic acceptance 1 uses `partial-marker` followed by `sleep 30 & wait` with a contracted one-second bound; normal scenario asserts refusal and retained output. Synthetic acceptance 2 uses the same command with a scratch-only Go overlay of the pinned Linux timeoutGroupAlive observer returning an error; unknown scenario checks unreadability, explicit retained unavailability, unknown exit and no silence claim.
- Addressed: synthetic acceptance 3 preserves the normal silent timeout sentence. Synthetic acceptance 4 is asserted in all three cases by the shared observer, including a planned unreached `check: later` so Not run is meaningful.
- Addressed: Need's conditional partial-output preservation is also a required focused regression below; the current pinned sys runner returns a zero Result on observation failure, so the unknown subprocess fixture does not pretend it supplies partial bytes.
- Addressed: README and testing rules require scoped regression coverage and normal Go checks; acceptance follows the existing isolated Go-driver pattern and invokes real bounded command execution and Attempt.Refuse on a synthetic project. This is a verification library, not an installed CLI repository. The synthetic plan explicitly contains acceptance then an unreached check; it does not claim Readiness.Check normally plans checks after acceptance.
- Omitted: no requested behavior or supplied non-secret literal is intentionally omitted. Superseded: only the old inference that empty unavailable output means the command wrote nothing. No roadmap or unrelated historical work changes.

## Tests
- Unknown observation must report unreadability and retain explicit unavailability rather than silence: synthetic unknown-observation acceptance plus focused Attempt regression (regression).
- Available partial output must be shown and retained even with unavailable collection: add a focused regression feeding an unknown timeout with captured partial-marker through Refuse and inspecting its retained record; preserve redaction and capping (regression).
- Ordinary timeout with partial-marker retains and displays it: normal subprocess acceptance case through bounded approval command execution and refusal (integration).
- Truly silent ordinary timeout retains the silence sentence: normal silent subprocess acceptance case (regression).
- Exit status, per-step bound, group handling and other refusal lines remain unchanged: shared acceptance observer for status and lines, existing TestAttemptBoundsEachStepAndKeepsEvidence and full existing checks for lifecycle behavior (existing).

## Feasibility
- Inspected the pinned kogen-loop sys implementation locally: observation failure returns ErrTimeoutObservation with no Result output; the existing observer is Linux-specific and can be contracted with a scratch-only Go overlay without production edits. Local source inspection probes exited 0. A probe trying to read retained proposals from a scratch checkout failed because private shaping storage is not copied; it supplies no qualifying evidence.
- evidence: {"id":"timeout-output-observer","kind":"observer","inputs":["features/steps/unknown_timeout_observer.js","features/steps/testdata/unknown_timeout/driver.go","features/steps/unknown_timeout_steps.js"],"observers":["features/steps/unknown_timeout_observer.js"],"checks":[{"name":"good","command":"node features/steps/unknown_timeout_observer.js good","exit":0,"output":"observer accepted\n"},{"name":"bad","command":"node features/steps/unknown_timeout_observer.js bad","exit":1,"output":"observer rejected\n"}]}
