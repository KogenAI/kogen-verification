# Prune old attempt evidence folders

Slug: k-verify-attempt-evidence-pruned
Model: not applicable — the change is a bounded directory cleanup with no interacting state
Acceptance:
- .kogen/intents/k-verify-attempt-evidence-pruned/acceptance.feature
- features/steps/k-verify-attempt-evidence-pruned__steps.js

Retaining a new attempt's evidence (`retain` in verify/attempt.go, for approval and Shape attempts, refused and passed) keeps only the newest 20 attempt folders under `.kogen/local/readiness/attempts` and removes older ones. Order is by the record's `started_at`, ties by folder name; the newest sorts last. When more than 20 exist, passed attempts are removed first (oldest first), then refused ones (oldest first), except that the newest refusal's folder is never removed. Only direct children of the attempts area that are folders holding an `attempt.json` are candidates; a stray file and a stray folder without a record survive 25 attempts and are never touched or counted. Pruning runs after the new record is written. Retained folders keep mode 0700 and records 0600, and pruning never rewrites a record.

A removal failure never changes the refusal or the pass: the refusal keeps its `Evidence: <path>` line and class. A failed removal is reported once as exactly one line in the refusal's lines, `Old evidence not removed: <folder name>: <error>`. No other folder is removed in its place, so the attempts area then holds one more than 20 folders. A passed attempt has no lines to carry the note, and returns nothing as before.

## Decisions
- The newest 20 are kept by `started_at` then name, passed-first removal, never the newest refusal (decision: D1, round 1) (evidence: verify/attempt.go) (source: request)
- A failed removal yields exactly one line `Old evidence not removed: <folder name>: <error>` in the refusal's lines and no substitute removal (decision: D2, round 1) (evidence: verify/attempt.go) (assumption: the exact note wording and the no-substitute rule are my choice; the request fixes only one one-line note naming the folder) (source: request)
- Acceptance sets attempt start times through the unexported `started` field in a same-package Go driver and makes a folder undeletable with chmod 0500 after it is retained and before the pruning attempt, so no production seam is added; this assumes a non-root Linux host (decision: D3, round 1) (evidence: verify/attempt.go; features/steps/k-verify-attempt-evidence-failed-write-removed__steps.js) (assumption: tests do not run as root) (source: request)
- The newest-refusal exception cannot be separated from passed-first removal by any attempt sequence, because any older refusal is removed only after all passes and never before a newer one; it is witnessed by the scenario where the sole, oldest refusal survives while 5 passes are removed (decision: D4, round 1) (assumption: the reviewer confirms the exception from the Build code, as no acceptance sequence isolates it) (source: request)

## Source comparison
- 25 mixed attempts, 10 attempts, stray entries surviving 25 attempts, the undeletable oldest passed folder (made undeletable after retention, before the pruning attempt) and modes are addressed in acceptance.feature; passed-first removal is an added scenario.

## Tests
- Keep newest 20, remove older, newest refusal kept: the mixed and passed-first scenarios (scenario)
- Under 20 nothing removed, records byte-identical: the ten-attempt scenario (scenario)
- Strays survive: the stray scenario (scenario)
- Removal failure leaves outcome unchanged with one note: the undeletable scenario (scenario)
- Modes preserved: the ten-attempt scenario (scenario)

## Feasibility
- evidence: {"id":"observer","kind":"observer","inputs":["features/steps/k-verify-attempt-evidence-pruned__steps.js"],"observers":["features/steps/k-verify-attempt-evidence-pruned__steps.js"],"checks":[{"name":"good","command":"node features/steps/k-verify-attempt-evidence-pruned__steps.js good","exit":0,"output":"good controls accepted\n"},{"name":"bad","command":"node features/steps/k-verify-attempt-evidence-pruned__steps.js bad","exit":1,"output":"bad controls rejected\n"}]}
