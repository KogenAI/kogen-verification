# Consumer contracts

These external-package tests pin verification interfaces used by consumers. They run with
`go test ./...`; fixtures, commands and evidence are local and synthetic. No consumer checkout,
provider, network or model is needed at test time. For an intentional interface or record change,
update these cases together with the paired consumer items, review the wire changes, and land
both sides in coordination. The consumer tests remain useful and are not removed.

## Source map

* kogen-shaping `94eabe5d492d`, `shape/stepcheck_test.go`,
  `TestOwnStepFilesAreTheJavaScriptStepFiles` and
  `TestSelfcheckFeedbackNamesDefectsNotWarnings`: `TestShapingStepReports` retains the
  source fixtures and verifies the producer's filtering, defects, warnings and load precedence.
  The source's `selfcheckScenarioFeedback`, headline and location rendering belong to shaping,
  so those presentation assertions are not copied.
* kogen-build `3109cd105f75`, `build/unit_test.go`,
  `TestGreenReuseRequiresCompleteRequiredCleanEvidenceNotAStoredBoolean`:
  `TestBuildCompleteEvidence` and `TestPassWireRecords`. Checkpoint placement, prompt-cache
  state, document version and working-context validation belong to build, not verification.
* kogen-build `3109cd105f75`, `build/baseline_cache_test.go`,
  `TestBaselineComparisonPassingOutput`, and `build/material_test.go`,
  `build/named_feedback_test.go`, `build/envfailure.go`, `build/baseline.go`, `build/builder.go`
  and review code: `TestProbeCustodyAndResults`, `TestEnvironmentFailureAndPassFeedback`,
   `TestConsumerResultRecords`, and `TestConsumerSurface` pin output, diagnostics and call surface;
  `TestReadinessRecordAndIdentity` also exercises a synthetic build stage and fixer. Build's baseline
  comparison, review and checkpoint orchestration themselves belong to build.
* kogen-shaping `94eabe5d492d`, `shape/evidence_test.go`,
  `feasibility_fits_limit_test.go`, `discovery_test.go`, `window_test.go`, `approve_test.go`,
  `init_test.go`, `refine_test.go` and `contract_test.go`: `TestDeclaredEvidenceRetained`,
  `TestReadinessRecordAndIdentity`, `TestProbeOverlayAndInterrupt`, `TestToolsAndRunner`,
  and `TestConsumerSurface` adapt local evidence, records, probes and setup. Provider sessions,
  approval UI, shaping windows and consumer-owned workflows are not verification assertions.
  The fixed readiness identity and synthetic fixture are supported by producer
  `verify/testdata/golden/readiness.json` and `verify/testdata/readiness-simple`.
* kogen `a208d0f0691ab73b2a1ef784dee2d150b8e3bfa8`,
  `cli/readiness/readiness_test.go` `TestInstallCheck`,
  `cli/probe_deadline_test.go` `TestInstalledProbeDeadline`, and the verification feature
  drivers: `TestToolsAndRunner`, `TestProbeCustodyAndResults` and
  `TestProbeOverlayAndInterrupt` exercise tools and probe custody directly, not the installed
  CLI. CLI presentation and invocation are consumer responsibilities.
