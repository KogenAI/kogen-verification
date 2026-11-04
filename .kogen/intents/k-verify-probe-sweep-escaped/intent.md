# Sweep escaped processes after probes

Slug: k-verify-probe-sweep-escaped
Model: not applicable — wire the existing tested command sweep into probes; no new state machine or process-selection policy
Acceptance:
- .kogen/intents/k-verify-probe-sweep-escaped/acceptance.feature
- features/steps/k-verify-probe-sweep-escaped__steps.js

Apply the existing marker-file/environment sweep to every command executed by Probe.Run in verify/probe.go, including commands that time out or are cancelled. Complete cleanup before returning and before removing the scratch directories. Reuse the existing safety rules: only the current user's marked processes and descendants, never self or ancestors, never unrelated bystanders. Preserve the probe's status, output, wall accounting, InputChanges and error semantics; do not substitute ordinary step timeout/watching semantics for the probe runner. Keep KillGroupOnExit and RefuseForeignKill. Do not add an unbounded wait. The existing runStepAs behavior in verify/env.go is the mechanism to reuse, not a new process-management design.

Expose optional Probe.Log Logger, and log exactly one bounded step_sweep event naming "probe" for each executed probe through it (event, name, stopped, ms and optional bounded error, like ordinary steps). Wire actual probe callers with their existing logger so real probe commands produce this event too, without duplicating events. RunProbe's existing signature remains compatible. Nil logging remains valid. Pre-execution refusals do not count as executed commands. Sweep failures must not overwrite the command result or error. Measure the existing result wall before sweep overhead so its meaning is unchanged. Quiet probes must add less than 200 ms wall overhead.

## Decisions
- Sweep probes as other project command steps, including escaped sessions, timeout and cancellation; preserve bystanders and results. (source: request)
- Emit one bounded step_sweep naming the probe, including quiet probes. (source: request)
- Build on current main and preserve consumer compatibility except the explicitly requested new probe sweep event. (source: request)

## Source comparison
- Addressed: request Problem and Need, verify/probe.go Run versus verify/env.go runStepAs: the complete contract above replaces group-only cleanup with the existing marker sweep without replacing probe execution semantics.
- Addressed: synthetic command `python3 -c 'import os,time\nif os.fork()==0:\n os.setsid(); time.sleep(120)' & sleep 1; echo launched` in acceptance.feature normal scenario. The harness adds an inert unique argv token to identify only its own escaped child; cleanup always kills its own survivors after observation. The bystander is independently session-isolated.
- Addressed: synthetic cases 1–4 in the four executable scenarios, including exact status/output, cancellation, timeout, bounded logging and quiet overhead. Full InputChanges and wall preservation need focused implementation regression coverage in addition to the harness's unchanged-input assertion.
- Addressed: retry observer failure through final-byte good/bad controls declared below; no prior readiness is reused.
- Addressed: consumer refusal kogen-build TestBuildRequestBudgetOff at build_request_budget_test.go:335, log line 34 byte 45. Do not change unrelated event fields, order, budget behavior or logs. The new probe step_sweep is deliberate; if that consumer pins the complete old log sequence it should stop pinning absence of this event, not lose its existing budget assertions. Preserve all other consumer expectations and explain any necessary consumer-first update in delivery summary. The consumer repository is not present here, so do not claim it passed locally.
- Omitted: none of the requested product behavior. No new settings, dependencies or unrelated cleanup are authorized.

## Tests
- Escaped setsid sleeper is dead on return while unrelated session survives: normal synthetic probe acceptance plus implementation regression (regression)
- Timeout and caller cancellation both sweep without changing their result/error semantics: timeout and cancel synthetic probes (integration)
- Quiet command produces exactly one bounded probe step_sweep and less than 200 ms extra wall time: quiet acceptance (integration)
- Status 0 and launched output remain identical; wall and InputChanges retain existing semantics including changed inputs: normal acceptance and focused Probe.Run implementation regression comparing pre-sweep accounting and changed-input reports (regression)
- Production probe entry points forward logging without unrelated consumer log drift: caller integration tests and existing full Go suite; inspect TestBuildRequestBudgetOff compatibility when consumer is available (integration)

## Feasibility
- evidence: {"id":"sweep-observer","kind":"observer","inputs":["features/steps/k-verify-probe-sweep-escaped__steps.js"],"observers":["features/steps/k-verify-probe-sweep-escaped__steps.js"],"checks":[{"name":"good","command":"node features/steps/k-verify-probe-sweep-escaped__steps.js good","exit":0,"output":"controls accepted\n"},{"name":"bad","command":"node features/steps/k-verify-probe-sweep-escaped__steps.js bad","exit":1,"output":"controls rejected\n"}]}
