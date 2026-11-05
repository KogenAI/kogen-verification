# Count blank failures and strip adjacent names

Slug: fix-k-verify-shared-failure-once
Model: not applicable — a pure feedback rendering fix with no state transitions
Acceptance:
- .kogen/intents/fix-k-verify-shared-failure-once/acceptance.feature
- features/steps/fix-k-verify-shared-failure-once__feedback.js

Fix two defects in `groupFeedback` and `normalizeFeedback` in `verify/pass.go`, which render `Pass.Feedback` (landed by k-verify-shared-failure-once). Both were reproduced on current main through the exported `Pass.Feedback`:

1. `groupFeedback` uses `detail == ""` to mean "not a failing item". A failing problem that is empty or whitespace-only has detail `""` (the plain-problem detail is `strings.TrimSpace(problem)`), so it is rendered with count 0 and is never counted in the final `left out N items, M bytes` notice. Reproducer: a pass whose model failed with the problems `[<300-line problem>, ""]` currently ends with `left out 1 items, 14731 bytes`; it must end with `left out 2 items, 14731 bytes`. With `[<300-line problem>, " \n\t "]` it currently ends with `left out 1 items, 14737 bytes` and must end with `left out 2 items, 14737 bytes`.
2. `normalizeFeedback` removes the item name with one regexp replacement whose boundary character is consumed, so adjacent occurrences such as `a a` are only partly stripped (`a a has data` becomes `a has data`). Consequently failures that differ only by their own names are not grouped. Reproducer: scenarios `a` and `b` failing with `a a has data` and `b b has data`, or checks `one` and `two` failing with output `one one: has data` and `two two: has data`, are currently rendered as separate entries.

The fix:
- `feedbackItem` gets a separate `failing bool` field. It is true for every failing item: each acceptance/model/maintained-feature problem, each failing setup/check command, and each speculative or cancelled result with a nonzero status. It is false only for the passed (status 0) speculative/cancelled results, which stay ungrouped with count 0 as now. `groupFeedback` decides grouping and counting by `failing`, not by `detail != ""`; failing items are grouped by their (possibly empty) detail exactly like any other shared detail, so a failing item with an empty detail counts once in the omission notice.
- `normalizeFeedback` repeats the whole-word name removal until a pass leaves the text unchanged, then applies the existing line-number and whitespace normalization. The loop ends because the name is nonempty and each changing pass removes at least one occurrence of it, so the text strictly shrinks.

Nothing else changes: the 16,384-byte budget, notice format, group rendering, encounter order, five-name limit, persisted Pass records and verdicts stay as they are, and under-budget output for single, distinct and non-adjacent inputs stays byte-identical. Every existing test stays green; no golden output is expected to change.

## Decisions
- Reproduce first with a test that fails on current main, then fix with a separate `failing` flag and by looping the normalization until stable. (source: request)
- Empty and whitespace-only failing problems count once each in `left out N items`. (source: request)
- Adjacent name occurrences (`a a`) are stripped completely, so details differing only by item names group. (source: request)
- Keep every existing test green; no unrelated changes. (source: request)

## Source comparison
- Addressed request Problem "`detail==""` is treated as not failing": acceptance scenarios `empty` and `whitespace` assert `left out 2 items, 14731 bytes` and `left out 2 items, 14737 bytes`; current main renders `left out 1 items` for both (observed in a scratch copy).
- Addressed request Problem "Adjacent name occurrences (\"a a\") are only partly stripped": acceptance scenarios for scenario names `a`/`b` and check names `one`/`two` assert the exact grouped feedback; current main renders the four separate entries (observed).
- Addressed request Need "First reproduce it": the scenarios fail on current main; the reproduction held, so the code change proceeds.
- Addressed request Need "Use a separate `failing` flag. Loop the normalization until stable." and "Keep every existing test green; no unrelated changes": the fix section above.
- Where: `verify/pass.go` `groupFeedback` (and `normalizeFeedback`, which it relies on for details).

## Tests
- An empty or whitespace-only failing problem omitted from the tail is counted once in `left out N items`: a regression test in `verify/feedback_group_test.go` calling `Pass.Feedback` with model problems `[<over-budget problem>, ""]` and `[<over-budget problem>, " \n\t "]` and asserting the exact `left out 2 items, … bytes` notice (regression)
- Adjacent occurrences of an item's name are stripped until stable, so name-only differences group: a regression test in `verify/feedback_group_test.go` calling `Pass.Feedback` with scenarios `a`/`b` failing `a a has data`/`b b has data` and checks `one`/`two` with output `one one: has data`/`two two: has data`, asserting `has data` appears once with `2 scenarios: a, b` and `2 checks: one, two` (regression)
- Passed speculative/cancelled results stay uncounted and ungrouped; single, distinct and budget output unchanged: existing `TestFeedbackBudget`, `TestFeedbackGroupsCommandsAndSections`, `TestFeedbackInvariantAndSpeculativeFailures` and the Elixir golden tests (existing)

## Feasibility
- Both defects reproduced on current main in a scratch copy through the step file's Go driver: `empty` ends `left out 1 items, 14731 bytes`, `whitespace` ends `left out 1 items, 14737 bytes`, and the adjacent-name cases render four separate entries.
- evidence: {"id":"feedback-observer","kind":"observer","inputs":["features/steps/fix-k-verify-shared-failure-once__feedback.js"],"observers":["features/steps/fix-k-verify-shared-failure-once__feedback.js"],"checks":[{"name":"good","command":"node features/steps/fix-k-verify-shared-failure-once__feedback.js --control good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/fix-k-verify-shared-failure-once__feedback.js --control bad","exit":1,"output":"rejected\n"}]}
