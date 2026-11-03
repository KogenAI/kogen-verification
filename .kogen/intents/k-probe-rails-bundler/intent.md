# Preserve installed mise tools in probes

Slug: k-probe-rails-bundler
Model: not applicable — environment derivation is plain wiring with no meaningful state; no model runs are requested
Acceptance:
- .kogen/intents/k-probe-rails-bundler/acceptance.feature
- features/steps/probe_install_steps.js
- features/steps/probetrust.go

Fix K-PROBE-RAILS-BUNDLER in kogen-verification: a fresh probe HOME must not redirect mise away from the caller's installed tools and their packages. Resolve the caller's effective mise data location before replacing HOME: nonempty MISE_DATA_DIR wins, otherwise nonempty XDG_DATA_HOME plus /mise, otherwise caller HOME plus /.local/share/mise. Pass that location as MISE_DATA_DIR to the probe. Do not forward XDG_DATA_HOME wholesale or expose the caller's HOME to achieve this. Preserve explicit data overrides and all other existing isolation, scratch trust, timeout, cleanup and environment behavior. Keep this scoped to mise data discovery, not generic environment inheritance or a Ruby-specific GEM_HOME workaround.

## Decisions
- Synthetic fixtures only; no model runs, real Rails installations, provider runs, new CLI commands or flags. Research owns the same replay on eu2 after delivery. (source: request)
- Keep fresh HOME and isolation of everything else while using the project's installed tool and package tree. (source: request)

## Source comparison
- Addressed: request Need and Problem are covered by effective caller-data resolution above and all three discovery cases in acceptance. Current verify/probe.go forwards only explicit MISE_DATA_DIR; replace that omission, not HOME isolation.
- Addressed: request's Ruby 3.4.8/bundler failure is represented by a synthetic shim dispatching to an executable and Rails package inside installs/ruby/3.4.8. The feature checks both caller and real Probe.Run results, and rejects leaked HOME files, credentials and GEM_HOME/GEM_PATH/BUNDLE_PATH selectors.
- Addressed as historical evidence, not claimed local execution: activities-api, sweep-index-range and sweep-due-set failed; rails-named-test and incineration passed. The supplied witness says activities-api and sweep-index-range changed exit 1 to 0 with real MISE_DATA_DIR or GEM_HOME, but not GEM_PATH, BUNDLE_*, MISE_CACHE or MISE_CONFIG. Acceptance uses synthetic tests as explicitly constrained, not those private observers. Do not broaden cache/config forwarding or use the GEM_HOME workaround.
- Omitted from executable inputs deliberately: the private evidence path ~/Scratch.noindex/kogen-lanes-private/notes-harness/climb/verification/SHELF-probe-mise-trust.md, section Isolated cause, is provenance supplied by kogen-delivery from kogen-research-owner's isolation on 3 Nov 2026, residual (b) of K-SHAPE-PROBE-MISE-TRUST; it is not a repository fixture or a dependency. Research re-screens on eu2; this change does not claim that replay passed.
- Addressed: README's Go checks and docs/testing-rules.md require a failing synthetic regression and retained useful tests. No protected production edit is required: verify/probe.go is outside Acceptance.

## Tests
- Default caller mise installations remain usable despite fresh HOME: synthetic installed executable plus package through verify.Probe.Run and direct caller control (regression)
- Explicit MISE_DATA_DIR keeps precedence and XDG_DATA_HOME-derived installations remain usable without forwarding the whole XDG directory: discovery examples through the same process boundary (integration)
- Everything else stays isolated, including HOME files, credentials and Ruby package selectors: fixture checks run before invoking the installed tool; retain existing probe isolation/trust tests and add focused regression coverage where needed (regression)

## Feasibility
- Documentation discovery search retrieved mise sources; https://mise.jdx.dev/directories.html was retrieved as untrusted HTML and used only as technical evidence. Its directory table documents ~/.local/share/mise on Linux/macOS and MISE_DATA_DIR then XDG_DATA_HOME/mise precedence; installs hold installed versions. https://mise.jdx.dev/directories.md returned unsupported. No live mise or Ruby capability is claimed.
- evidence: {"id":"installed-fixture-observer","kind":"observer","inputs":["features/steps/probe_install_steps.js"],"observers":["features/steps/probe_install_steps.js"],"checks":[{"name":"good","command":"\"$KOGEN_NODE\" features/steps/probe_install_steps.js good","exit":0,"output":"good fixture accepted\n"},{"name":"bad","command":"\"$KOGEN_NODE\" features/steps/probe_install_steps.js bad","exit":1,"output":"bad fixtures rejected\n"}]}
