# Reject symlinks at setup-tools pin paths

Slug: setup-tools-rejects-symlink-pins
Model: not applicable — the change only classifies a filesystem entry and preserves the existing setup phases
Acceptance:
- .kogen/intents/setup-tools-rejects-symlink-pins/acceptance.feature
- features/steps/setup-tools-rejects-symlink-pins__steps.js

Fix ev-3a9d6e7c: `writeMissing` currently follows a symlink with `os.Stat` and can mistake it for a regular pinned file. Reject a symlink at `package.json` or `package-lock.json` for either Cucumber or Quint, even if it points to a regular file. The setup command must report the offending link path on stderr, exit 1, and not invoke npm. Existing regular pinned files remain untouched, and absent files are still copied from the embedded pins. Limit implementation and Go test changes to `cmd/setup-tools/main.go` and `cmd/setup-tools/main_test.go`. Do not change pinned contents or npm installation behavior for valid regular files.

## Decisions
- A pinned entry that is a symlink is refused even when its referent is a regular file. (evidence: cmd/setup-tools/main.go) (source: request)
- Preserve the command’s error interface: no arguments, exit 1 on refusal, and a `setup-tools: ` diagnostic on stderr containing the offending path relative to the working directory, not the symlink referent. Diagnostic wording beyond that is not fixed. (evidence: cmd/setup-tools/main.go; cmd/setup-tools/main_test.go) (source: request)
- npm is not invoked if any pinned manifest is a symlink. Keep pin preparation ahead of both installs; when preparation succeeds the command exits 0 if both `npm ci --prefix` calls succeed, with Cucumber before Quint as today. (evidence: cmd/setup-tools/main.go) (source: request)
- Keep existing regular files without rewriting them and copy absent files byte for byte from the same embedded manifests. Keep the current directory and pipe refusals. (evidence: cmd/setup-tools/main.go; cmd/setup-tools/main_test.go; testdata/tools/tools.go) (source: request)
- Drive the compiled command through its CLI in an isolated working directory. Build it once on first use with `go build -o <temporary binary path> ./cmd/setup-tools` from the module root, using Go 1.27.2. Run it without arguments with only the recording stub on PATH; it appends tab-delimited argument records to `npm-calls` using `/bin/sh`, avoiding real npm and network access in the scenarios. The configured Cucumber runner uses Node and loads the Intent's bindings. (evidence: README.md; go.mod; .kogen/project.yaml; cmd/setup-tools/main.go; cmd/setup-tools/main_test.go) (source: request)

## Source comparison
- Addressed: ev-3a9d6e7c and acceptance 1 map to the four symlink scenarios in `acceptance.feature`, each using a regular referent. Acceptance 2 maps to the exit status, stderr path, and no-npm assertions in each of those scenarios, including the Quint lockfile case that detects an early Cucumber install.
- Addressed: acceptance 3 maps to the two successful CLI scenarios, which assert byte preservation and byte-for-byte copying, plus the existing Go tests named below. The successful scenarios also check the original npm argument lists and order. `controls.json` checks that following the link, omitting its path, invoking npm early, rejecting or overwriting regular files, and skipping absent copies fail the corresponding assertions.
- Superseded: `os.Stat` following the final pinned entry in `cmd/setup-tools/main.go` is replaced by entry inspection. Omitted as out of scope: changes to the embedded pins, installation semantics on valid inputs, or production paths outside the two requested files.

## Tests
- A symlink to a regular file at either manifest name for either tool is refused, the error names the symlink path, and npm is not invoked: extend `TestRunRejectsNonRegularPinnedTarget` with regular-referent symlink cases for those paths in `cmd/setup-tools/main_test.go`, reusing the isolated npm marker fixture (regression)
- Refusal status, diagnostic path, and absence of npm calls through the actual command: the four symlink scenarios in `acceptance.feature` (scenario)
- Existing regular pins remain untouched and missing pins still come from the embedded files: `TestWriteMissingKeepsExistingAndCopiesAbsent` in `cmd/setup-tools/main_test.go` (existing)
- On valid inputs the CLI keeps regular pins, copies absent pins, and invokes npm with the unchanged arguments and order: the two successful scenarios in `acceptance.feature` (scenario)

## Feasibility
- The local Go 1.27.2 and Node v24.21.0 toolchain built the CLI and passed `go test ./cmd/setup-tools`; the unchanged CLI exited 0 with a regular-referent symlink and the fake npm recorded both `ci --prefix testdata/tools/cucumber` and `ci --prefix testdata/tools/quint`. (baseline probe: exit 0, 0.6 s)
- The good observer fixture exits 1 and names the path without invoking npm; the bad fixture also exits 1 but hides the path and invokes the recording stub. The checks below exercise both masked assertions independently of the baseline CLI’s exit 0. (observer probes: exit 0 and exit 1 respectively, 0.1 s each)
- The scratch overlay generator’s initial whitespace assertion failed and emitted no artifact; the corrected generator captured `controls.json` successfully. (generator probes: exit 1 and exit 0 respectively, 0.1 s each)
- evidence: {"id":"refusal-observer","kind":"observer","inputs":[],"observers":["features/steps/setup-tools-rejects-symlink-pins__steps.js"],"checks":[{"name":"good","command":"node features/steps/setup-tools-rejects-symlink-pins__steps.js good","exit":0,"output":"refusal observations accepted\n"},{"name":"bad","command":"node features/steps/setup-tools-rejects-symlink-pins__steps.js bad","exit":1,"output":"stderr does not name testdata/tools/quint/package-lock.json\nnpm was invoked before refusal\n"}]}
