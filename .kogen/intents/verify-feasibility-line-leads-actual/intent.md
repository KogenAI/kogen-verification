# Lead feasibility mismatch with actual outcome

Slug: verify-feasibility-line-leads-actual
Model: not applicable — the change formats one text line and has no state
Acceptance:
- .kogen/intents/verify-feasibility-line-leads-actual/acceptance.feature
- features/steps/verify-feasibility-line-leads-actual__steps.js

When a feasibility probe gives a different result from the recorded expectation, the mismatch line puts the long expected object first, so a reader that cuts the line at 300 characters never sees the actual exit code and output. This change makes every feasibility mismatch line start with a short summary of the actual outcome, and then carry the existing text unchanged.

The summary is `actual exit N: ` followed by the first 120 characters of the actual output with each line break replaced by one space (with `[cut]` appended directly when the output was longer than 120 characters, cut at a character boundary), then ` (expected exit M)`. Empty actual output gives `actual exit N: (no output) (expected exit M)`. One space follows the summary, then the existing text `<id>/<check>: expected <encoded expected object>; actual <encoded actual object>` unchanged, because step files assert that both `expected ` and `; actual ` are present. In shape mode, the existing prefix for a probe that timed out keeps its place before everything, including the summary. Each mismatching check gets exactly one line with exactly one summary; checks that match produce no line at all.

The change touches only `verify/feasibility.go` (the construction of the mismatch detail in Execute) and `verify/feasibility_test.go`. Out of scope: `verify/stepcheck.go`, `verify/envfailure.go`, the shaping repository and its 300-character cut, the structure of the evidence records, and all documentation. No setting, flag or environment variable is added.

## Decisions
- Every mismatch line of Execute in verify/feasibility.go starts with the summary `actual exit N: <text> (expected exit M)`, then one space, then the existing `<id>/<check>: expected ...; actual ...` text unchanged. (decision: D1, round 1) (evidence: verify/feasibility.go) (source: request)
- The text is the actual output with trailing line breaks removed, each remaining line break (`\n`, `\r\n` or `\r`) replaced by one space, cut to its first 120 characters (runes, never inside a character) with `[cut]` appended directly when it was longer; empty output (or only line breaks) gives `(no output)`. (decision: D2, round 1) (evidence: verify/feasibility.go) (assumption: trailing line breaks are dropped so that `boom: cannot open file` printed with a final newline reads `actual exit 2: boom: cannot open file (expected exit 0)`; one space separates the summary from the existing text; `[cut]` has no space before it) (source: request)
- Checks that match produce no line, and each mismatching check produces exactly one line with exactly one summary. (decision: D3, round 1) (evidence: verify/feasibility.go) (source: request)
- The shape-mode timed-out prefix keeps its place before everything else on the line. (decision: D4, round 1) (evidence: verify/feasibility.go) (source: request)
- The summary lives in one small unexported helper called where `detail` is built; its name is the Build's choice. (decision: D5, round 1) (evidence: verify/feasibility.go) (source: request)

## Source comparison
- Addressed: the current line is built in Execute as `detail := d.ID + "/" + expected.Name + ": expected " + encode(d.raw[j]) + "; actual " + encode(got)`, so its form `id/check: expected` followed by the expected object always comes first. The refusal lines `observer layout-observer good: exit 2, recorded exit 0` and `bad: exit 2, recorded exit 1` of the evidencing run showed only that expected text after the 300-character cut. After this change each such line begins with the summary and then carries that same existing text.
- Addressed: summary first, existing `expected ` and `; actual ` text kept after it, 120-character cut with `[cut]` on one line (the scenario probe prints 400 characters on several lines), `(no output)`, one line per mismatching check and none for matching checks (scenarios of acceptance.feature, each driven through the real Execute on a probe command over 200 characters with a 300-character expected output).
- Omitted by request: stepcheck.go, envfailure.go, the shaping repository's 300-character cut, evidence record structure, documentation.
- The shape-mode timed-out prefix is not reachable through the exported Execute; it stays unchanged in the code and is covered by the existing unit tests.

## Tests
- The mismatch line begins with the summary within the first 300 characters, keeps the existing text after it, cuts at 120 characters on one line, reads no output for empty output, and gives one line per mismatching check and none for matching ones: scenarios driven through Execute with the helpers of verify/evidence_test.go (scenario)
- Summary text for short output, the 120-character cut with the cut marker and line breaks as spaces, no output, an exit-code-only mismatch, and no line for matching checks: focused tests in verify/feasibility_test.go (unit)

## Feasibility
- A scratch copy with the correct change applied ran the submitted driver with `go test ./verify -run '^TestLeadsActualDriver$' -count=1`, which passed and wrote the expected summaries; the step's checks accepted that real report. (probe: scratch run, exit 0)
- evidence: {"id":"leads-actual-observer","kind":"observer","inputs":["features/steps/verify-feasibility-line-leads-actual__steps.js"],"observers":["features/steps/verify-feasibility-line-leads-actual__steps.js"],"checks":[{"name":"good","command":"node features/steps/verify-feasibility-line-leads-actual__steps.js good","exit":0,"output":"good controls accepted\n"},{"name":"bad","command":"node features/steps/verify-feasibility-line-leads-actual__steps.js bad","exit":1,"output":"bad controls rejected\n"}]}
