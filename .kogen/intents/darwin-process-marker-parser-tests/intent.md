# Add Darwin procargs2 marker parser tests

Slug: darwin-process-marker-parser-tests
Model: not applicable — the parser is a pure function of its input bytes and keeps no state
Acceptance:
- .kogen/intents/darwin-process-marker-parser-tests/acceptance.feature
- features/steps/darwin-process-marker-parser-tests__steps.js

This change gives the Darwin process sweep a deterministic test seam for parsing kern.procargs2 data and covers it with a new Darwin-only test file. `procMarked` in `verify/sweep_darwin.go` keeps its behavior and signature; it reads the data with `procargs2(pid)` and hands it to a new function `procargs2Marked(data []byte, entry string) bool` holding the parsing logic that exists today. `procargs2Marked` reports true only when `entry` equals, byte for byte, one whole NUL-separated entry of the environment block, which follows the executable path and the argc arguments. A marker that appears only in an argument or only as a part of a longer environment entry does not match. Truncated or malformed data returns false and never panics. The new file `verify/sweep_darwin_test.go` (build constraint `darwin`) tests `procargs2Marked` with built fixtures: an exact environment entry matches, an argument-only marker does not, a marker that is a substring of an environment entry does not, and truncated or malformed data does not match and does not panic. Out of scope: process selection rules, Linux process attribution and any other behavior change.

## Decisions
- The seam is the package-level function `procargs2Marked(data []byte, entry string) bool` in `verify/sweep_darwin.go`; `procMarked` only reads the data and calls it, and the existing parsing rules move into it unchanged. (evidence: verify/sweep_darwin.go) (source: request)
- Matching is exact: the marker matches only when it equals a whole environment entry, never when it occurs in an argument or as a substring of an environment entry. (evidence: verify/sweep_darwin.go) (source: request)
- Truncated or malformed data returns no match without panicking. (evidence: verify/sweep_darwin.go) (source: request)
- Acceptance observes the seam without relying on test names the Build must invent: the step file compiles the `verify` test binary once with a Go build overlay adding a private driver test that calls `procargs2Marked`, and runs it per fixture; a separate scenario discovers the `Test` functions declared in `verify/sweep_darwin_test.go` at run time and requires each to pass. (evidence: verify/sweep_test.go) (assumption: the acceptance host is darwin, because the code under test is built only there) (source: request)
- Seam is package-level procargs2Marked(data []byte, entry string) bool; procMarked reads data and delegates (decision: D1, round 1) (constraint: parsing rules unchanged) (constraint: process selection untouched) (evidence: verify/sweep_darwin.go) (source: request)
- Exact whole-entry environment match; argument-only and substring markers do not match (decision: D2, round 1) (evidence: verify/sweep_darwin.go) (source: request)
- Malformed or truncated data returns no match without panic (decision: D3, round 1) (evidence: verify/sweep_darwin.go) (source: request)
- Acceptance uses a go build overlay driver and run-time discovery of test functions in the new test file (decision: D4, round 1) (evidence: verify/sweep_test.go) (assumption: Acceptance host must be darwin; scratch run on darwin passed 11/11 scenarios with the correct overlay and failed the targeted scenarios for each wrong overlay.) (source: request)

## Source comparison
- Request scope `verify/sweep_darwin.go` and new `verify/sweep_darwin_test.go`: addressed by the seam and the new test file; acceptance items 1-3 map to the scenarios on an exact environment entry and an argument-only marker, on substring entries, and on truncated or malformed data.
- Out of scope (process selection rules, Linux attribution): untouched; `verify/sweep.go` and `verify/sweep_linux.go` are not edited.

## Tests
- Exact environment-entry matching and rejection of an argument-only marker: `TestProcargs2MarkedExactEntry` in `verify/sweep_darwin_test.go` (unit)
- A marker that is only a substring of an environment entry does not match: `TestProcargs2MarkedExactEntry` in `verify/sweep_darwin_test.go` (unit)
- Truncated or malformed data returns no match without panicking: `TestProcargs2MarkedMalformed` in `verify/sweep_darwin_test.go` (unit)
- The seam is reachable and behaves as stated through the compiled package: the acceptance scenarios drive `procargs2Marked` through a Go build overlay (integration)

## Feasibility
- none
