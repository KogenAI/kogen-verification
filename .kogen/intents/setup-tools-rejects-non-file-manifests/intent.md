# Reject non-file pinned manifests during setup

Slug: setup-tools-rejects-non-file-manifests
Model: not applicable — a stateless file-kind check with no state transitions
Acceptance:
- .kogen/intents/setup-tools-rejects-non-file-manifests/acceptance.feature
- features/steps/setup-tools-rejects-non-file-manifests__steps.js

In cmd/setup-tools/main.go, writeMissing currently skips a pinned target whenever os.Stat succeeds, so a directory at package.json or package-lock.json is treated as an already-present manifest and setup goes on to npm ci with an invalid manifest path. writeMissing must still skip an existing regular manifest file and copy an absent one, but it must return an error that names the target when the target exists as a directory or another non-regular file. Because run() returns that error before the npm ci loop, npm is not invoked. Scope is cmd/setup-tools/main.go and cmd/setup-tools/main_test.go only; embedded manifests, npm invocation and verification packages are out of scope.

## Decisions
- The error returned by writeMissing contains the target path exactly as writeMissing builds it (filepath.Join("testdata", "tools", tool, name)); run() wraps it with its existing "setup-tools: " prefix, so the path stays in the message. (evidence: cmd/setup-tools/main.go) (source: request)
- Existing targets are classified with the existing os.Stat call, so a symlink to a regular file stays skipped as today and a symlink to a directory is rejected; only regular files are skipped. (evidence: cmd/setup-tools/main.go) (assumption: symlinks are classified by what they resolve to) (source: request)
- cmd/setup-tools/main_test.go does not exist yet; the Build creates it in package main with a test that places a directory at each pinned target and runs run() with a fake npm first on PATH, and a test that an existing regular file is untouched while an absent one is copied. (evidence: cmd/setup-tools/main.go; testdata/tools/tools.go) (source: request)

## Source comparison
- Addressed: skip regular files and copy absent files unchanged; error naming the target for a directory or other non-regular file (directory and named pipe are exercised); npm not invoked on rejection. Embedded manifests, npm invocation and verification packages are untouched.

## Tests
- A directory or other non-regular file at a pinned target returns an error naming it and npm is not invoked: test in cmd/setup-tools/main_test.go running run() with a fake npm (integration)
- An existing regular pinned file is untouched and an absent one is copied: test in cmd/setup-tools/main_test.go (unit)

## Feasibility
- none
