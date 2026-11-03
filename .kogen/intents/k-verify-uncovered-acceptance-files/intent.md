# Report uncovered acceptance suite files

Slug: k-verify-uncovered-acceptance-files
Model: not applicable — coverage is a deterministic set difference within one pass, not a lifecycle or state machine
Acceptance:
- .kogen/intents/k-verify-uncovered-acceptance-files/acceptance.feature
- features/steps/uncovered_steps.js
- features/steps/uncovered_observer.cjs
- features/steps/testdata/uncovered/driver.go

Report which declared acceptance files were not executed by this verification pass. Preserve ordinary pass semantics unless full coverage is required. This is the verification component's general mechanism, not a new suite runner: never execute uncovered files automatically.

## Decisions
- Coverage is informational by default; requiring full coverage makes uncovered files a pass failure. No declaration preserves record and feedback exactly. (source: request)
- Feedback contains one bounded coverage line, count and first few sorted paths; no line when coverage is complete. (source: request)
- Missing declared directories are refusals naming the location, never empty suites. (source: request)

Technical interface: add optional `Input.AcceptanceSuite *AcceptanceSuite`, with exported `AcceptanceSuite` fields `Location string` and `RequireFullCoverage bool`. As with existing `Input.MaintainedFeatures`, the assembling caller supplies project declarations to this component. No changes to this repository's protected `.kogen/project.yaml`, and no coordinator YAML schema changes are part of this component request. `Location` is a repository-relative directory (recursively enumerate regular `.feature` files) or filepath.Glob-compatible glob. Expand against the materialized candidate, normalize to slash-separated repository-relative paths, deduplicate and sort lexically. A directory that does not exist must return an error naming it. An absent declaration does not activate any of this mechanism.

For each actually executed configured check provide a fresh, distinct `KOGEN_CHECK_REPORT` path. The check may write a JSON object `{"executed_features":["features/ch04.feature"]}` there. Only entries from that check's own report count, never command text, an exit code, or a directory name. Missing reports contribute no executed files. Also count the feature URIs with completed test-case execution in the existing acceptance command's Cucumber Messages report (including maintained acceptance runs). Normalize report paths to the same candidate-relative representation. Do not count a feature from a Gherkin document declaration alone, or from a check which never ran. Deduplicate across reports. No additional report protocol or dependency is needed.

For a declared suite persist `uncovered_acceptance` (sorted JSON array, including empty `[]`) and `uncovered_acceptance_count` (integer) on Pass, preserving both through JSON round trips. Omit both when there is no declaration. Compute coverage as declared files minus files reported executed in this pass. Informational coverage must not alter Green, Failing, NotRun or the existing execution sequence. Requiring full coverage adds a failure naming every uncovered file and makes Green false; do not truncate the persisted list or full failure diagnostic. `Pass.Complete` must not reuse strict incomplete coverage as green proof. Keep old records without these fields readable.

The coverage feedback line starts `Acceptance coverage:` and is at most 512 UTF-8 bytes excluding newline, displays the total and up to three first paths, with an omission indicator if needed. Clip unusually long paths as necessary to maintain the bound. Strict failures still retain their full diagnostic separately.

## Source comparison
- Addressed: request Problem and Need — the interface and record rules above expose partial versus full configured execution without auto-running additional files.
- Addressed: synthetic cases 1–6 — acceptance scenarios exercise features/ch01.feature, features/ch02.feature, features/ch04.feature, 200 uncovered files, strict failure, all-reported, no-declaration control, and missing-features/ refusal.
- Addressed: directory or glob and reports-only execution in Need — glob and silent-report scenarios plus implementation integration tests cover those distinctions and actual acceptance report wiring.
- No requested behavior is intentionally omitted or superseded. Project declarations are consumed via the component's Input API, consistent with its existing explicit maintained-suite inputs; host configuration parsing is outside this repository. Non-secret literals and original synthetic filenames are retained.

## Tests
- Declared files minus check-reported files is sorted, unique and informational: add focused set-difference and Pass serialization tests plus partial directory/glob scenarios (integration)
- Feedback is absent for empty coverage and otherwise one line bounded at 512 bytes with total and first paths: add focused formatter tests at 511, 512, 513 bytes and scenarios for two and 200 uncovered files (unit)
- Strict uncovered coverage fails and names all files: add strict pass and Complete regression tests plus strict scenario (regression)
- All reported files leave an empty recorded list and no feedback line: add all-reported scenario (integration)
- No declaration preserves record and feedback: compare actual Verify calls with and without absent declaration, and preserve historical golden compatibility (integration)
- Missing declared directory refuses naming it: add missing directory scenario (integration)
- Only reports from executed checks and completed acceptance test cases count: add integration tests for absent reports, acceptance reports naming suite files, document-only URIs and checks not run after an earlier failure (integration)

## Feasibility
- The pinned coordinator Config exposes no suite or per-check report fields; inspected its installed source in a scratch probe (exit 0). The component-local Input declaration and check report environment avoid an upstream schema dependency.
- A scratch attempt to access private proposal files failed because those files are not copied into probes; its no-tests-to-run output is not driver evidence.
- evidence: {"id":"coverage-observer","kind":"observer","inputs":["features/steps/uncovered_observer.cjs"],"observers":["features/steps/uncovered_observer.cjs"],"checks":[{"name":"good","command":"node features/steps/uncovered_observer.cjs good","exit":0,"output":"accepted\n"},{"name":"bad","command":"node features/steps/uncovered_observer.cjs bad","exit":1,"output":"rejected\n"}]}
