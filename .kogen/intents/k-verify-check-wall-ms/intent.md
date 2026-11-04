# Record verification command wall times

Slug: k-verify-check-wall-ms
Model: not applicable — timing is observational metadata; verification states and transitions are unchanged
Acceptance:
- .kogen/intents/k-verify-check-wall-ms/acceptance.feature
- features/steps/k-verify-check-wall-ms__steps.js

Add timing only to verification log events. Every executed command_result (setup, fix, acceptance, every Quint invocation, maintained acceptance/model commands, stage checks and ordinary checks, including concurrent cohort members) gains wall_ms, a nonnegative integer number of elapsed milliseconds measured using a monotonic clock immediately before command execution through its return, cancellation or timeout. Do not substitute cohort duration or configured deadlines for actual command duration. Preserve all existing event fields. Commands that never start must not produce command_result or wall_ms. Existing cancellation/error outcomes remain unchanged; where execution ends by cancellation or timeout, retain a timed result event for that executed command even when verification cannot return a Pass.

The pass log event additionally gains checks_wall_ms: elapsed wall time from the first verification item start to the last item end, not summed command durations. Fix runs before the pass and is timed individually but excluded from checks_wall_ms. Exclude candidate materialization and post-command tree bookkeeping. Keep Pass, CommandResult records, serialization, item order, statuses, output, green/red decisions and golden files byte-identical to the control implementation. Do not put timing into Pass JSON or recorded results. No scheduler broadening or new configuration is requested.

## Decisions
- Use the exact volatile key names wall_ms and checks_wall_ms, both ending in _ms. (source: request)
- Preserve the supplied sleep 1 setup, sleep 2 check, exit 3 check and approximately one-second acceptance stub. Exercise existing Go build/vet cohort recognition with a local go executable stub; arbitrary sleep commands need not become cohort eligible. (source: request)
- Sleeping command bounds are [1000,3000) ms for one second, [2000,5000) ms for two seconds. The cohort uses two five-second commands so their sum exceeds the entire pass including setup and acceptance; bounds are [5000,11000) ms. The cancelled thirty-second sibling must return within 3000 ms of its start after the one-second failure. (source: request)

## Source comparison
- Addressed: request Problem and Need, command_result wall_ms across setup/fix/acceptance/model/check and concurrent cancellation/timeout, in outcome paragraphs and four executable scenario cases; no timing is added to Pass records.
- Addressed: Need pass checks_wall_ms, in outcome paragraph and scenario whole-pass assertions, including overlapping sum rather than summed cohort timing.
- Addressed: Synthetic acceptance 1, sleep 1 setup, sleep 2 check, exit 3 and sleep 1 acceptance, in serial scenario and submitted stub driver; assertions check exact result multiplicity and integer timing bounds.
- Addressed: Synthetic acceptance 2 and 3, in cohort and cancel scenarios using existing supported go build ./... and go vet ./... route with a synthetic executable, without changing scheduling policy.
- Addressed: Synthetic acceptance 4 control-build byte identity, in serial scenario's exact control_pass captured from unchanged Run using the same newProj fixture and commands. Existing goldens must remain unchanged.
- Explicit test scope qualification for Synthetic acceptance 4 log comparison: compare the sequential command/command_result/pass event stream after *_ms masking and scratch-cwd normalization. Existing step_sweep events contain a volatile key named ms (not *_ms), as observed in the baseline probe; the full unfiltered raw log is already nondeterministic. Do not rename or remove that existing field, change sweep behavior, or impose deterministic ordering on concurrent event delivery. The requested production change remains timing fields only.
- Addressed: Synthetic acceptance 5, serial/cancel tail is not_run with no command_result; no duration may be synthesized for it.
- Addressed: required slug, file locations, step basename and sentence prefix are retained exactly. No requested production behavior is deliberately omitted or superseded; the raw-log test qualification above preserves existing metadata rather than silently changing it.

## Tests
- Every executed verification command emits integer elapsed wall_ms without changing its result: serial/model acceptance and focused coverage for maintained/stage commands (integration)
- Concurrent commands report individual elapsed time and the pass reports elapsed span, not summed work: cohort acceptance (integration)
- Cancellation and timeout record elapsed work and never-started items emit no result: cancel acceptance plus bounded timeout regression through the existing cancellation/deadline machinery (regression)
- Pass serialization, statuses, output and green/red stay byte-identical to control: serial stub baseline-control byte comparison and existing Elixir goldens unchanged (regression)
- Volatile timing is removable via *_ms masking without other command/pass event changes: repeated sequential stub log comparison (integration)

## Feasibility
- A first scratch probe could not read private proposed files because they are not copied into probe trees (exit 1, 0.0 s); it exercised no product behavior. A focused baseline-control probe then ran TestWallControl through go test ./verify -run '^TestWallControl$' -count=1 -v (exit 0, 7.1 s), observed the serial Run record now embedded as control_pass, and observed existing step_sweep ms volatility. This was a local fixture inquiry, not a test-runner-output observer.
- evidence: {"id":"timing-observer","kind":"observer","inputs":["features/steps/k-verify-check-wall-ms__steps.js"],"observers":["features/steps/k-verify-check-wall-ms__steps.js"],"checks":[{"name":"good","command":"node features/steps/k-verify-check-wall-ms__steps.js good","exit":0,"output":"good controls accepted\n"},{"name":"bad","command":"node features/steps/k-verify-check-wall-ms__steps.js bad","exit":1,"output":"bad controls rejected\n"}]}
