# Qualify a packaged candidate dependency build

Slug: verify-packaged-candidate-dependency-build
Model: not applicable — the change is a sequential command that runs fixed phases and reports their outcome; there is no state with interacting rules to model
Acceptance:
- .kogen/intents/verify-packaged-candidate-dependency-build/acceptance.feature
- features/steps/verify-packaged-candidate-dependency-build__steps.js
- features/steps/verify-packaged-candidate-dependency-build__driver/main.go

Release qualification has no run of the packaged candidate on a real project with a dependency install through Shape, Build and landing. This change adds `kogen verify candidate --project <fixture directory>`, which runs the packaged candidate binary (not the source tree) against a fixture project that installs real dependencies from a local mirror, with the scripted provider that ships with the verification fixtures. It runs the phases `install`, `shape`, `build`, `resume`, `restore`, `land` in that order: it shapes one request, builds it, resumes the Build once after an interruption, restores a protected file once, and lands.

Output and exit codes. When every phase completed, standard output is the line `candidate-build: landed` followed by one line holding the receipt, and the exit code is 0. The receipt is one JSON object with exactly the keys `binary_sha256`, `project`, `phases` and `elapsed_seconds`; `phases` is the list of completed phase names in execution order; `project` is the `--project` value as given; `binary_sha256` is the hex sha256 of the packaged binary file; `elapsed_seconds` is a number that may differ between runs, and every other value is identical for the same binary and fixture. When a phase does not complete (its command exits nonzero), the command stops, prints `candidate-build: failed <phase>` naming that phase and exits 1. When the fixture directory is missing (or `--project` is not given) or the packaged binary is unreadable, it prints `candidate-build: unavailable` and exits 2. Exit 0 is never produced without the `landed` line. Existing verify commands and their output are unchanged; there is no network use beyond the local dependency mirror and no real model.

Interface fixed for the checks. The code is `verify.RunCandidate(args []string, stdout, stderr io.Writer) int`, where `args` are the arguments after `verify candidate`; it returns the exit code. The packaged candidate binary is the executable that is running the command (`os.Executable()`), so a candidate checks itself and no other binary path is needed; the receipt hashes that file. The acceptance driver (`features/steps/verify-packaged-candidate-dependency-build__driver/main.go`, built with `-tags kogendriver`) is a stand-in `kogen`: `kogen verify candidate <args>` calls `RunCandidate`, and its other arguments are the stand-in candidate's phases. The verifier copies the fixture directory to a temporary working directory and runs, with that copy as the working directory and `KOGEN_PROVIDER=scripted` in the environment: `install` is `npm install --offline --no-audit --no-fund --ignore-scripts`; the other phases run the executable with the arguments `shape`, `build`, `build --resume`, `restore` and `land`. The fixture's dependencies come from tarballs in a mirror folder of the fixture referenced by `file:` dependencies, so the install needs no network. The interruption of the Build is whatever the scripted provider or the fixture scripts; the verifier only runs `build --resume` after `build`. The build ships one fixture project with its mirror and scripted provider script under the verify package's testdata, and tests that run `RunCandidate` on it.

Scope: the verification package and new fixtures and tests only. Documentation and design files are untouched.

## Decisions
- The command is implemented as `verify.RunCandidate(args []string, stdout, stderr io.Writer) int` in package `verify`, because this repository holds the verification package and not the assembling `kogen` program, which wires `verify candidate` to it; the acceptance driver stands in for that wiring. (decision: D1, round 1) (constraint: Existing verify commands and output stay unchanged) (evidence: README.md; go.mod) (assumption: The assembling kogen program calls verify.RunCandidate; the program was not readable from this checkout.) (source: request)
- The packaged binary is the running executable itself, and the phase invocations are `shape`, `build`, `build --resume`, `restore`, `land` with `KOGEN_PROVIDER=scripted`. (decision: D2, round 1) (assumption: The real candidate's subcommands and scripted-provider switch could not be read from this repository; the user confirms these names or says what the real candidate expects.) (source: request)
- Exit 0 happens only after every phase completed and the line `candidate-build: landed` was printed; any nonzero phase prints `candidate-build: failed <phase>` and exits 1; a missing fixture or unreadable binary prints `candidate-build: unavailable` and exits 2. (decision: D3, round 1) (constraint: Exit 0 without the landed line is never produced) (source: request)
- The receipt has exactly the keys `binary_sha256`, `project`, `phases`, `elapsed_seconds`, and the phase names are exactly `install`, `shape`, `build`, `resume`, `restore`, `land`. (decision: D4, round 1) (source: request)
- Dependencies are installed offline from a local mirror folder of tarballs in the fixture, so no network is used. (decision: D5, round 1) (assumption: A scratch run in this session of `npm install --offline` on a file: tarball dependency added one package in 0.2 s; it is not a Kogen probe record.) (source: request)

## Source comparison
- Addressed: acceptance 1, landed line, exit 0 and receipt sha256 of the packaged binary: scenario `A complete scripted run lands`.
- Addressed: acceptance 2, a resume that loses the restore flag prints `candidate-build: failed resume` and exits 1: scenario `A resume that loses the restore flag fails`.
- Addressed: acceptance 3, missing fixture prints `candidate-build: unavailable` and exits 2; the unreadable-binary case is implemented but not acceptance-tested, since the running executable cannot be made unreadable by a step.
- Addressed: acceptance 4, two runs give identical `phases` that include `install`, and identical other receipt values except elapsed seconds.
- Partly addressed: the checks use a stand-in candidate driver, not the real kogen binary, because this repository holds neither the real candidate nor a scripted provider; the shipped fixture and its tests are for the Build.

## Tests
- The phases run in order and the receipt and lines are printed as specified: acceptance scenarios through the `kogen verify candidate --project` command, plus a Go test of `RunCandidate` on the shipped fixture. (scenario)
- A failing phase prints `candidate-build: failed <phase>` and exits 1: scenario with a resume that fails. (scenario)
- A missing fixture prints `candidate-build: unavailable` and exits 2: scenario. (scenario)
- Two runs have identical phases including install: scenario. (scenario)
- Existing verify commands are unchanged: the existing tests of the verify package keep passing. (existing)
- none: the command runs six fixed phases, not a collection of records, so no record-count scenario applies

## Feasibility
- none
