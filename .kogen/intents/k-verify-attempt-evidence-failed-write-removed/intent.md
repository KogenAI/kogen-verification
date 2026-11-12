# Remove failed attempt evidence writes

Slug: k-verify-attempt-evidence-failed-write-removed
Model: not applicable — the change is a file-write sequence with no interacting state
Acceptance:
- .kogen/intents/k-verify-attempt-evidence-failed-write-removed/acceptance.feature
- features/steps/k-verify-attempt-evidence-failed-write-removed__steps.js

Retaining a refused attempt's evidence (`retain` in verify/attempt.go) must not leave a partial record. The record is written to a temporary name in the attempt's new folder and renamed to `attempt.json` only after a successful write and close. When creating the folder, writing, closing or renaming fails, the temporary file, `attempt.json` and the folder created for this attempt are removed (never an earlier attempt's folder or the attempts area that existed before), and the refusal contains exactly one `Evidence not retained: <error>` line whose text names the underlying error. Successful writes give the same folder, file name `attempt.json`, modes (folder 0700, file 0600) and bytes as before, and no temporary file remains.

No production seam is added. Acceptance injects a write failure with a file-size resource limit (the write fails with "file too large") and a folder-creation failure with a regular file standing where the attempts area would be. A failing close shares the same cleanup path; the Build covers it with its own unit test.

## Decisions
- Cleanup removes only a folder this call created, so a folder that already existed is not removed (evidence: verify/attempt.go) (source: request)
- Failures are injected through the filesystem (file-size limit, blocking file) with no production seam; close failure is covered by the Build's own unit test rather than acceptance (evidence: verify/attempt.go) (source: request)
- Cleanup removes only a folder this call created (decision: D2, round 1) (evidence: verify/attempt.go) (source: request)
- Failures are injected through the filesystem (file-size limit, blocking file) with no production seam; close failure is covered by the Build's own unit test (decision: D3, round 1) (evidence: verify/attempt.go) (assumption: RLIMIT_FSIZE injection assumes a Linux host; close failure is not observed in acceptance.) (revises: D1 because an invented seam symbol made the acceptance driver fail to compile on the unchanged tree; the driver now runs and observes baseline red) (source: request)
- Failures are injected through the filesystem (file-size limit, blocking file) with no production seam; close failure is covered by the Build's own unit test (decision: D4, round 1) (evidence: verify/attempt.go) (assumption: RLIMIT_FSIZE injection assumes a Linux host; close failure is not observed in acceptance.) (source: request)

## Source comparison
- Failed write removal naming the cause, temporary name then rename, unchanged success output, and folder-creation failure are addressed in acceptance.feature; failing close is addressed in the Build's unit test only.

## Tests
- Failed write removes the record and new folder and names the cause: the failing-write scenario (scenario)
- Failing close removes the record and new folder: a unit test the Build adds in verify (unit)
- Success output unchanged with no temporary file: the success scenario (scenario)
- Folder-creation failure leaves nothing behind: the folder-failure scenario (scenario)

## Feasibility
- none
