# Group shared verification failures once

Slug: k-verify-shared-failure-once
Model: not applicable — pure feedback rendering has no meaningful state transition
Acceptance:
- .kogen/intents/k-verify-shared-failure-once/acceptance.feature
- features/steps/k-verify-shared-failure-once__feedback.js

Change Pass.Feedback in verify/pass.go, not pass accounting or persisted evidence. Red passes currently repeat full problem text indefinitely. Render textually shared failure details once, with count and bounded names, and bound the complete feedback. Apply this mechanism to failing items across acceptance, maintained features, models and command results, retaining section context. Do not group unrelated statuses or erase meaningful message differences. No new settings or dependencies.

## Decisions
- Use 16,384 UTF-8 bytes including the omission notice; show first five names in encounter order and total membership. Under-budget single and distinct failure output remains byte-identical. (source: answer 1)
- Compare trimmed failure details ignoring item names and diagnostic line numbers; preserve meaningful message text. Emit each group at its first member's position, with distinct entries in original order. Render the first normalized detail once, then the count (`12 scenarios` for the reproducer) and bounded names. (source: request)
- Tail truncation retains complete lines only and reserves space for one final line containing `left out N items` and the number of UTF-8 bytes omitted from the unbounded rendered tail. Count original failing items represented in omitted content, including partially omitted items, once each. Full per-item records, results, statuses and verdicts remain unchanged. Document the fixed budget and counting semantics beside the API. (source: request)

## Source comparison
- Addressed request Problem and Need: grouping, encounter order and whole-feedback cap replace unbounded repetition only in Feedback; persisted Pass JSON and verdict calculation remain intact.
- Addressed synthetic examples 1–6 in acceptance: 12 identical `no such file: out.txt` plus one different, 13 distinct, 400 distinct 200-byte details, name/line-only variations and single-item identity. The driver constructs a stub Acceptance and invokes the real exported Pass.Feedback; before/after JSON proves record stability including green/red.
- Addressed answer 1: 16 KiB, five names, compatibility below budget. No requested behavior is intentionally omitted or superseded.

## Tests
- Shared failure grouping and bounded first-five names: shared stub regression (regression)
- Name/line normalization without merging different text: normalized stub and focused normalization cases (unit)
- Record and verdict preservation: JSON before/after every fixture plus existing pass accounting tests (integration)
- Distinct and single-item compatibility: distinct and single stubs against legacy rendering (regression)
- Whole-feedback line-boundary budget and omission counts: bounded stub plus unit tests at 16,383, 16,384 and 16,385 bytes, including multibyte output and exact omitted item/byte arithmetic (unit)
- General mechanism across existing feedback sections: focused Pass.Feedback unit tests for model, maintained feature, command and mixed-section output (unit)

## Feasibility
- evidence: {"id":"feedback-observer","kind":"observer","inputs":["features/steps/k-verify-shared-failure-once__feedback.js"],"observers":["features/steps/k-verify-shared-failure-once__feedback.js"],"checks":[{"name":"good","command":"node features/steps/k-verify-shared-failure-once__feedback.js --control good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/k-verify-shared-failure-once__feedback.js --control bad","exit":1,"output":"rejected\n"}]}
