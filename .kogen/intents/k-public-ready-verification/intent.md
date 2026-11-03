# Prepare verification docs for public readers

Slug: k-public-ready-verification
Model: not applicable — documentation cleanup has no meaningful state
Acceptance:
- .kogen/intents/k-public-ready-verification/acceptance.feature
- features/steps/public_ready_steps.js

Make KogenAI/kogen-verification readable and usable from a plain public clone. Only README and documentation files may be changed by the implementation. Remove private setup instructions and workspace-only links, contribution refusal, maintenance promises, machine-specific paths and host names, and internal landing/delivery notes throughout the documentation tree, including historical Intent Markdown. Preserve technical specifications, assertions, goldens and executable behavior. Use synthetic paths wherever documentation needs a fixture path. Do not rewrite Git history.

README must explain deterministic verification and its role as the component pinned by Kogen to assemble the kogen program. Document the Go toolchain version from go.mod and Node/npm prerequisites for real Cucumber/Quint tests, retain both npm ci commands, build/vet/race tests and accurate golden-update guidance. No private or unavailable setup is mentioned. All tree links must resolve publicly; Kogen-wide links use https://kogen.dev or https://github.com/KogenAI/kogen. State contact@kogen.dev exactly once in README for inquiries.

Audit tracked tree links and documentation, not merely README. Do not create SECURITY.md, CONTRIBUTING.md or BRANDING.md. Issues and pull requests are disabled; do not discuss that or add contribution policy. Do not change repository settings. Existing checks must pass unchanged, with no weakened assertions. Audit reachable Git history without modifying it; final owner-facing completion report must list each historical finding by commit, file and what was found (or explicitly report none), separately from the committed public tree. Avoid disclosing credentials in that report.

## Decisions
- Limit implementation changes to README and documentation; configuration and all protected artifacts remain untouched. The host-local lineup override is not pushed and its check wrapper paths are excluded from the public-tree audit; main uses plain commands including `GOFLAGS=-trimpath go test ./...`. main has no private-module setup. (source: request)
- Deliver history findings only in the final owner-facing completion report outside the repository. (source: answer 1)
- Preserve behavior and all existing assertions; do not rewrite history. (source: request)

## Source comparison
- Addressed: request Problem and Need are covered by the full-tree documentation audit, public setup, links/contact requirements, policy-file exclusions, unchanged checks and owner-facing history inventory above; executable scenarios check the principal README outputs and machine-path cleanup.
- Addressed: request Scope (re-filed 3 Nov) supersedes any wider implementation cleanup: only README/documentation edits, never .kogen/project.yaml; host-local override check paths are not public-tree findings. No protected edit is authorized.
- Addressed: answer 1 selects an external final report, not a committed history report. Historical findings remain intact in Git.
- Addressed: supplied README testing and golden instructions remain accurate and usable, except the obsolete private-module instruction is removed. Supplied testing rules require output inspection and unchanged existing tests, not new production unit tests for copy.
- Omitted deliberately: no settings changes for already-disabled issues/PRs, no new contribution/security/branding policy, no production or fixture-code changes, no history rewriting. These follow the request's explicit boundaries, not reduced behavior guarantees.

## Tests
- Public README purpose, prerequisites, commands, contact and removal of private setup: inspect actual README text in acceptance (scenario)
- Remove machine-specific paths from documentation across the current tree: inspect tracked Markdown in acceptance, excluding only the unpushed host configuration (scenario)
- All links public, no internal host/landing/delivery notes or contribution refusal/maintenance promise, no excluded policy files: inspect all documentation and public link targets during final review (existing)
- Behavior and assertions unchanged: run configured checks and existing tests without edits or golden regeneration (existing)
- History untouched and findings delivered outside Git: review final diff and owner-facing commit/file/category inventory against read-only history audit (existing)

## Feasibility
- Public Go proxy returned HTTP 200 and version metadata for both exact pinned coordinator and loop modules without authentication (scratch probe: exit 0, 1.1 s). This establishes public metadata availability, not complete clean-clone test success.
- Documentation discovery search for the public modules returned generic GitHub sources only; it did not establish module documentation or exhaustive link availability. No external API behavior changes are required.
