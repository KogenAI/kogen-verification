# Reject directory pins in setup-tools

Slug: setup-tools-rejects-directory-pins
Model: not applicable — a stateless file-kind check on pinned manifests with no state transitions
Acceptance:
- .kogen/intents/setup-tools-rejects-directory-pins/acceptance.feature
- features/steps/setup-tools-rejects-directory-pins__steps.js

In cmd/setup-tools/main.go, setup validates the pinned package.json and package-lock.json of each tool before it runs npm ci. A target that exists but is not a regular file (for example a directory) makes setup return an error that names that target path, and npm is not invoked. An existing regular pinned file is kept byte for byte, and a missing pinned file is still written from the embedded files. Changing the pinned package contents or npm install behavior for valid manifests is out of scope. Scope is cmd/setup-tools/main.go and cmd/setup-tools/main_test.go.

Observed at HEAD while shaping: writeMissing already rejects a non-regular target with an error naming it, run() already returns that error before the npm ci loop, and cmd/setup-tools/main_test.go already tests this. The requested behavior is therefore already present; this Intent adds an independent acceptance observation of it and requires no production change beyond keeping that behavior intact.

## Decisions
- A pinned target that exists as a directory or any other non-regular file makes run() fail with an error containing the target path as built from testdata/tools/<tool>/<name>, before npm is invoked. (evidence: cmd/setup-tools/main.go; cmd/setup-tools/main_test.go) (source: request)
- An existing regular pinned file is never rewritten: its bytes stay exactly as found. (evidence: cmd/setup-tools/main.go; cmd/setup-tools/main_test.go) (source: request)
- A missing pinned file is still written from the embedded files and equals the repository's pinned file, so a fresh module root stays usable. (evidence: cmd/setup-tools/main.go; testdata/tools/tools.go) (source: request)
- The requested behavior is already implemented at HEAD, so the acceptance passes on the unchanged tree and the Build has no required production edit. (evidence: cmd/setup-tools/main.go; cmd/setup-tools/main_test.go) (assumption: the already-delivered behavior satisfies the request and no further change is wanted) (source: request)
- The acceptance builds the real cmd/setup-tools/main.go once into a Go test binary in a scratch module and drives it with a fake npm that touches a marker, so no real npm runs. (evidence: cmd/setup-tools/main.go; testdata/tools/tools.go) (source: request)

## Source comparison
- Addressed: directory at a pinned path gives an error naming the path before npm; existing regular files stay byte for byte; missing files are populated from the embedded files. Pinned contents and npm behavior for valid manifests are untouched.
- Superseded: the earlier Intent setup-tools-rejects-non-file-manifests already delivered the same behavior; this Intent does not edit its files.

## Tests
- A directory at a pinned file path returns an error naming it and npm is not invoked: TestRunRejectsNonRegularPinnedTarget in cmd/setup-tools/main_test.go (existing)
- Existing regular pinned files are unchanged and missing ones are copied from the embedded files: TestWriteMissingKeepsExistingAndCopiesAbsent in cmd/setup-tools/main_test.go (existing)
- The three requested outcomes through the real setup run: scenarios in acceptance.feature (scenario)

## Feasibility
- none
