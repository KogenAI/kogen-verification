package verify

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

func (p *proj) readiness() *Readiness {
	cucumber := filepath.Join(p.Aux, "node_modules")
	os.MkdirAll(filepath.Join(cucumber, "@cucumber/cucumber"), 0755)
	quint := filepath.Join(p.Aux, "quint.js")
	os.WriteFile(quint, []byte("// fixture"), 0644)
	return &Readiness{Root: p.Root, Repo: p.Repo, Config: p.Config, Tools: Tools{Node: "/bin/sh", Cucumber: cucumber, Quint: quint}, Evidence: nil}
}

func failWith(t *testing.T, err error, class, reason string) *sys.Error {
	t.Helper()
	e, ok := sys.AsError(err)
	if !ok || e.Class != class || e.Reason != reason {
		t.Fatalf("err = %v, want %s/%s", err, class, reason)
	}
	return e
}

func (p *proj) readinessRecord() (map[string]any, bool) {
	b, err := os.ReadFile(readinessPath(p.Root, fixtureSlug))
	if err != nil {
		return nil, false
	}
	var rec map[string]any
	json.Unmarshal(b, &rec)
	return rec, true
}

func TestReadinessChecksTheCleanCandidateAndKeepsCompleteEvidence(t *testing.T) {
	tmp := isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = []string{appendTo(p.trace("setup"), "setup-1"), appendTo(p.trace("setup"), "setup-2")}
	r := p.readiness()
	ev := newEvidence()
	r.Evidence = ev
	s, stderr := p.session()
	ready, err := r.Check(context.Background(), s, fixtureSlug)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "exit", ready.AcceptanceExit, 0)
	eq(t, "failures", ready.Failures(), false)
	eq(t, "scenarios", len(ready.Scenarios), 2)
	eq(t, "first", ready.Scenarios[0].Status, "passed")
	eqSlice(t, "setup ran in the scratch folder, once each", p.ran("setup"), []string{"setup-1", "setup-2"})
	eq(t, "setup evidence", ev.counts["setup"], 2)
	eq(t, "acceptance evidence", ev.counts["acceptance"], 1)
	contains(t, "progress", stderr.String(), "kogen: running setup-1: ")
	rec, ok := p.readinessRecord()
	if !ok || rec["outcome"] != "ready" || rec["head"] != p.head() || rec["acceptance_exit"].(float64) != 0 {
		t.Fatalf("record = %v", rec)
	}
	eq(t, "no stamp in the checkout", fileExists(filepath.Join(p.Root, ".kogen/local/setup.json")), false)
	if !fileExists(filepath.Join(p.Root, ".kogen/local/packages/fixture.json")) {
		t.Fatal("package facts are refreshed after the record is published")
	}
	cached := r.Cached(s, fixtureSlug)
	if cached == nil || !r.Current(s, fixtureSlug, cached) || cached.CandidateTree != ready.CandidateTree {
		t.Fatalf("cached = %+v", cached)
	}
	requireNoLeftovers(t, tmp)
	eq(t, "checkout status", p.git("status", "--porcelain"), "")

	// Any change to the candidate makes the evidence stale.
	p.write("extra.txt", "x")
	if r.Cached(s, fixtureSlug) != nil || r.Current(s, fixtureSlug, cached) {
		t.Fatal("a changed candidate is a normal miss")
	}
}

func fileExists(path string) bool { _, err := os.Stat(path); return err == nil }

func TestReadinessAcceptsLegitimateRedAndRetainsObservations(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.write("app.txt", "red\n")
	r := p.readiness()
	s, _ := p.session()
	ready, err := r.Check(context.Background(), s, fixtureSlug)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "exit", ready.AcceptanceExit, 1)
	eq(t, "failures", ready.Failures(), true)
	rec, _ := p.readinessRecord()
	eq(t, "outcome", rec["outcome"], "ready")
	eq(t, "version", rec["version"], any(float64(5)))
	for _, sc := range rec["scenarios"].([]any) {
		eq(t, "phase", sc.(map[string]any)["phase"], "assertion")
	}
	cached := r.Cached(s, fixtureSlug)
	if cached == nil || !cached.Failures() {
		t.Fatal("unchanged red is reused without another check")
	}
	obs := Observations(fixtureSlug, cached, "")
	contains(t, "observations", obs, "Readiness observations\nChecked baseline: "+cached.SHA256+"\nHEAD: "+p.head()+"\nAcceptance exit: 1\nEvidence: .kogen/local/readiness/fixture.json\n")
	contains(t, "observations", obs, "Scenario: First (acceptance.feature line 2)\nFailure phase: assertion\nacceptance.feature line 3: Then the candidate succeeds")
	ack := Acknowledgment(fixtureSlug, cached, "")
	contains(t, "acknowledgment", ack, "Inspect whether fixtures, inputs and commands reached the intended behavior")
	contains(t, "acknowledgment", ack, AcknowledgmentGuidance)
	contains(t, "acknowledgment", ack, obs)
	eq(t, "no observations when green", Observations(fixtureSlug, &Ready{}, ""), "")

	// HEAD moved: the earlier observations cannot be acknowledged.
	p.git("commit", "--allow-empty", "-qm", "External HEAD change")
	if r.Cached(s, fixtureSlug) != nil || r.Current(s, fixtureSlug, cached) {
		t.Fatal("changed HEAD must not acknowledge observations from an earlier check")
	}
}

func TestReadinessRefusals(t *testing.T) {
	type refusal struct {
		name   string
		setup  func(p *proj)
		class  string
		reason string
		detail string
		lines  func(t *testing.T, lines []string)
	}
	one := func(want string) func(*testing.T, []string) {
		return func(t *testing.T, lines []string) { eqSlice(t, "lines", lines, []string{want}) }
	}
	prefixed := func(want ...string) func(*testing.T, []string) {
		return func(t *testing.T, lines []string) {
			t.Helper()
			for _, w := range want {
				if !slices.ContainsFunc(lines, func(l string) bool { return strings.Contains(l, w) }) {
					t.Fatalf("lines %q lack %q", lines, w)
				}
			}
		}
	}
	runner := func(p *proj, script string) { p.Config.Acceptance.Run = script }
	cases := []refusal{
		{"undefined steps", func(p *proj) {
			ex := mustScenarios(t)
			rep := writeReport(t, p.Aux, "undef.ndjson", simpleMessages(project.FeaturePath(fixtureSlug), ex, reportOpts{results: statuses("UNDEFINED")}))
			runner(p, "cp '"+rep+"' \"$KOGEN_ACCEPTANCE_REPORT\"; exit 1")
		}, "intent", "not_ready", "the Intent is not ready to build", prefixed("acceptance.feature line 3: undefined step: Then the candidate succeeds")},
		{"missing report", func(p *proj) { runner(p, "echo boom; exit 2") }, "intent", "not_ready", "the Intent is not ready to build",
			prefixed("report_missing: the acceptance command exited 2; its output:", "boom")},
		{"invalid report", func(p *proj) { runner(p, `echo not-json > "$KOGEN_ACCEPTANCE_REPORT"`) }, "intent", "not_ready", "the Intent is not ready to build",
			prefixed("report_invalid: the acceptance command exited 0; its output:")},
		{"exit with every scenario passed", func(p *proj) { runner(p, p.Config.Acceptance.Run+"; echo wrapper-noise; exit 3") }, "intent", "not_ready", "the Intent is not ready to build",
			prefixed("exit 3 with all scenarios passed; its output:", "wrapper-noise")},
		{"scenario skipped", func(p *proj) {
			ex := mustScenarios(t)
			rep := writeReport(t, p.Aux, "skipped.ndjson", simpleMessages(project.FeaturePath(fixtureSlug), ex, reportOpts{results: statuses("SKIPPED")}))
			runner(p, "cp '"+rep+"' \"$KOGEN_ACCEPTANCE_REPORT\"")
		}, "intent", "not_ready", "the Intent is not ready to build", prefixed("skipped: First (line 2)", "skipped: Later (line 4)")},
		{"setup fails", func(p *proj) { p.Config.Setup = []string{"echo before; echo setup-bad; exit 3"} }, "environment", "setup_failed", "Setup setup-1 failed (status=3).", one2("before", "setup-bad", "commands.setup[0]: echo before; echo setup-bad; exit 3", setupNext)},
		{"setup changes the candidate", func(p *proj) { p.Config.Setup = []string{"echo changed > app.txt; echo added > added.txt"} }, "intent", "not_ready", "readiness changed candidate files", func(t *testing.T, l []string) {
			slices.Sort(l)
			eqSlice(t, "mutations", l, []string{"added.txt", "app.txt"})
		}},
		{"intent cannot be read", func(p *proj) {
			p.write(project.FeaturePath(fixtureSlug), "nonsense\n")
		}, "intent", "parse", "the Intent cannot be read", one("acceptance.feature line 1: expected Feature:, got: nonsense")},
		{"intent needs changes", func(p *proj) {
			p.write(project.FeaturePath(fixtureSlug), "Feature: x\n  Scenario: y\n    Given z\n")
		}, "intent", "lint", "the Intent needs changes", one("acceptance: scenario y has no Then step")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			tmp := isolateTmp(t)
			p := newProj(t)
			// An earlier record does not survive a check that fails.
			os.MkdirAll(filepath.Dir(readinessPath(p.Root, fixtureSlug)), 0o755)
			os.WriteFile(readinessPath(p.Root, fixtureSlug), []byte(`{"version":3}`), 0o644)
			c.setup(p)
			s, _ := p.session()
			_, err := p.readiness().Check(context.Background(), s, fixtureSlug)
			e := failWith(t, err, c.class, c.reason)
			eq(t, "detail", e.Detail, c.detail)
			eq(t, "exit", e.Exit, map[bool]int{true: 3, false: 1}[c.class == "environment"])
			c.lines(t, e.Lines)
			if _, ok := p.readinessRecord(); ok {
				t.Fatal("a refused check leaves no readiness record")
			}
			requireNoLeftovers(t, tmp)
		})
	}
}

const setupNext = "next: fix commands.setup in .kogen/project.yaml (commit the change) or install what the command needs, then rerun the command that was refused"

func one2(want ...string) func(*testing.T, []string) {
	return func(t *testing.T, lines []string) { eqSlice(t, "lines", lines, want) }
}

func TestReadinessRecordIsRefusedWhenItsInputsChangedDuringChecking(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	r := p.readiness()
	s, _ := p.session()
	ready, err := r.Check(context.Background(), s, fixtureSlug)
	if err != nil {
		t.Fatal(err)
	}
	os.Remove(readinessPath(p.Root, fixtureSlug))
	p.write(project.FeaturePath(fixtureSlug), fixtureFeature+"  Scenario: Third\n    Then the candidate succeeds\n")
	e := failWith(t, r.RecordPass(s, fixtureSlug, ready), "intent", "not_ready")
	eq(t, "detail", e.Detail, "the Intent is not ready to build")
	eqSlice(t, "lines", e.Lines, []string{"readiness inputs changed during checking or publication"})
	if _, ok := p.readinessRecord(); ok {
		t.Fatal("no record is published for changed inputs")
	}
}

func TestReadinessCachedMissesAreNormal(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	r := p.readiness()
	s, _ := p.session()
	if _, err := r.Check(context.Background(), s, fixtureSlug); err != nil {
		t.Fatal(err)
	}
	path := readinessPath(p.Root, fixtureSlug)
	good, _ := os.ReadFile(path)
	if r.Cached(s, fixtureSlug) == nil {
		t.Fatal("setup: the record must be reusable")
	}
	mutate := func(f func(rec map[string]any)) {
		var rec map[string]any
		d := json.NewDecoder(strings.NewReader(string(good)))
		d.UseNumber()
		d.Decode(&rec)
		f(rec)
		b, _ := json.Marshal(rec)
		os.WriteFile(path, b, 0o644)
	}
	for name, f := range map[string]func(rec map[string]any){
		"no skipped metadata":       func(rec map[string]any) { delete(rec["scenarios"].([]any)[0].(map[string]any), "unexercised_steps") },
		"null skipped metadata":     func(rec map[string]any) { rec["scenarios"].([]any)[0].(map[string]any)["unexercised_steps"] = nil },
		"nonarray skipped metadata": func(rec map[string]any) { rec["scenarios"].([]any)[0].(map[string]any)["unexercised_steps"] = "[]" },
		"bad skipped object": func(rec map[string]any) {
			rec["scenarios"].([]any)[0].(map[string]any)["unexercised_steps"] = []any{map[string]any{"keyword": "Then ", "text": "not a step", "line": json.Number("3")}}
		},
		"pre-harness-validation version": func(rec map[string]any) { rec["version"] = 3 },
		"wrong version":                  func(rec map[string]any) { rec["version"] = 2 },
		"not ready":                      func(rec map[string]any) { rec["outcome"] = "failed" },
		"exit not integer":               func(rec map[string]any) { rec["acceptance_exit"] = "0" },
		"other head":                     func(rec map[string]any) { rec["head"] = strings.Repeat("0", 40) },
		"other hash":                     func(rec map[string]any) { rec["sha256"] = strings.Repeat("0", 64) },
		"other tree":                     func(rec map[string]any) { rec["candidate_tree"] = strings.Repeat("0", 40) },
		"other baseline":                 func(rec map[string]any) { rec["baseline"] = []any{"x"} },
		"other title":                    func(rec map[string]any) { rec["title"] = "Another" },
		"other model":                    func(rec map[string]any) { rec["model"] = "none-ish" },
		"other model result":             func(rec map[string]any) { rec["model_outcome"] = "passed" },
		"scenario count":                 func(rec map[string]any) { rec["scenarios"] = rec["scenarios"].([]any)[:1] },
		"scenario status":                func(rec map[string]any) { rec["scenarios"].([]any)[0].(map[string]any)["status"] = "skipped" },
		"scenario shape":                 func(rec map[string]any) { rec["scenarios"].([]any)[0].(map[string]any)["name"] = "Renamed" },
		"scenario no detail":             func(rec map[string]any) { delete(rec["scenarios"].([]any)[0].(map[string]any), "detail") },
		"exit nonzero but all passed":    func(rec map[string]any) { rec["acceptance_exit"] = json.Number("1") },
		"unproven feasibility":           func(rec map[string]any) { rec["feasibility"] = []any{map[string]any{"id": "x"}} },
	} {
		mutate(f)
		if r.Cached(s, fixtureSlug) != nil {
			t.Fatalf("%s: a mismatching record must be a miss", name)
		}
	}
	for name, text := range map[string]string{
		"legacy record": `{"head":"` + p.head() + `","sha256":"x"}`,
		"malformed":     "{",
		"not an object": "[]",
		"empty":         "",
	} {
		os.WriteFile(path, []byte(text), 0o644)
		if r.Cached(s, fixtureSlug) != nil {
			t.Fatalf("%s must be a miss", name)
		}
	}
	os.Remove(path)
	if r.Cached(s, fixtureSlug) != nil {
		t.Fatal("no record is a miss")
	}
	os.WriteFile(path, good, 0o644)
	if r.Cached(s, fixtureSlug) == nil {
		t.Fatal("the original record is reusable again")
	}
}

func TestReadinessCachedRequiresValidFailurePhases(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.write("app.txt", "red\n")
	r := p.readiness()
	s, _ := p.session()
	ready, err := r.Check(context.Background(), s, fixtureSlug)
	if err != nil {
		t.Fatal(err)
	}
	path := readinessPath(p.Root, fixtureSlug)
	good, _ := os.ReadFile(path)
	cached := r.Cached(s, fixtureSlug)
	if cached == nil {
		t.Fatal("setup: the red record must be reusable")
	}
	for i, sc := range cached.Scenarios {
		eq(t, "cached phase", sc.Phase, ready.Scenarios[i].Phase)
		eq(t, "cached failed phase", sc.Phase, "assertion")
	}
	mutate := func(f func(rec map[string]any)) {
		var rec map[string]any
		d := json.NewDecoder(strings.NewReader(string(good)))
		d.UseNumber()
		d.Decode(&rec)
		f(rec)
		b, _ := json.Marshal(rec)
		os.WriteFile(path, b, 0o644)
	}
	first := func(rec map[string]any) map[string]any { return rec["scenarios"].([]any)[0].(map[string]any) }
	for name, f := range map[string]func(rec map[string]any){
		"version 4":            func(rec map[string]any) { rec["version"] = json.Number("4") },
		"failed without phase": func(rec map[string]any) { delete(first(rec), "phase") },
		"null phase":           func(rec map[string]any) { first(rec)["phase"] = nil },
		"unknown phase":        func(rec map[string]any) { first(rec)["phase"] = "fixture" },
		"nonstring phase":      func(rec map[string]any) { first(rec)["phase"] = 1 },
		"phase on passed": func(rec map[string]any) {
			sc := first(rec)
			sc["status"], sc["detail"], sc["phase"] = "passed", nil, "assertion"
		},
	} {
		mutate(f)
		if r.Cached(s, fixtureSlug) != nil {
			t.Fatalf("%s: a record without valid phases must be a miss", name)
		}
	}
	for _, phase := range []string{"setup", "action", "assertion", "teardown"} {
		mutate(func(rec map[string]any) { first(rec)["phase"] = phase })
		got := r.Cached(s, fixtureSlug)
		if got == nil || got.Scenarios[0].Phase != phase {
			t.Fatalf("a %s phase is reusable and returned as recorded: %+v", phase, got)
		}
	}
}

func TestSetupRunsInOrderAndWarmPreparationReusesItsStamp(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = []string{appendTo(p.trace("setup"), "one"), appendTo(p.trace("setup"), "two")}
	p.Config.Acceptance.StepsDir = "features/steps"
	r := p.readiness()
	log := &memLog{}
	r.Log = log
	s, stderr := p.session()
	ctx := context.Background()
	if err := r.Setup(ctx, s, p.Root, true); err != nil {
		t.Fatal(err)
	}
	eq(t, "no skip on the first run", len(log.named("setup_skipped")), 0)
	eqSlice(t, "first run", p.ran("setup"), []string{"one", "two"})
	stamp := must(os.ReadFile(filepath.Join(p.Root, ".kogen/local/setup.json")))
	var key map[string]any
	if err := json.Unmarshal(stamp, &key); err != nil || key["head"] != p.head() || len(key["changes"].(string)) != 64 || len(key["setup"].([]any)) != 2 {
		t.Fatalf("stamp = %s", stamp)
	}
	stderr.Reset()
	if err := r.Setup(ctx, s, p.Root, true); err != nil {
		t.Fatal(err)
	}
	eqSlice(t, "reused", p.ran("setup"), []string{"one", "two"})
	eq(t, "notice", stderr.String(), "kogen: setup already ran for this checkout state\n")
	skipped := log.named("setup_skipped")
	eq(t, "skip events", len(skipped), 1)
	eq(t, "skip event", fmt.Sprint(skipped[0]), "map[count:2 event:setup_skipped reason:already_ran]")
	eq(t, "commands logged", len(log.named("command")), 2)
	// Intent files and the steps folder do not count as checkout changes; other files do.
	p.write(".kogen/intents/fixture/extra.md", "x")
	p.write("features/steps/new_steps.js", "x")
	if err := r.Setup(ctx, s, p.Root, true); err != nil {
		t.Fatal(err)
	}
	eq(t, "still reused", len(p.ran("setup")), 2)
	p.write("src.txt", "changed")
	if err := r.Setup(ctx, s, p.Root, true); err != nil {
		t.Fatal(err)
	}
	eq(t, "changed checkout runs again", len(p.ran("setup")), 4)
	// A Build never reuses it.
	if err := r.Setup(ctx, s, p.Root, false); err != nil {
		t.Fatal(err)
	}
	eq(t, "without reuse", len(p.ran("setup")), 6)
}

func TestSetupCommandResultsCarryWallTimeAlsoWhenTheCommandFails(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = []string{"sleep 1", "exit 4"}
	r := p.readiness()
	log := &memLog{}
	r.Log = log
	s, _ := p.session()
	err := r.Setup(context.Background(), s, p.Root, false)
	e := failWith(t, err, "environment", "setup_failed")
	eq(t, "detail", e.Detail, "Setup setup-2 failed (status=4).")
	results := log.named("command_result")
	eq(t, "results", len(results), 2)
	eq(t, "first name", results[0]["name"], "setup-1")
	eq(t, "first status", results[0]["status"], 0)
	if ms, ok := results[0]["wall_ms"].(int64); !ok || ms < 1000 || ms >= 3000 {
		t.Fatalf("setup-1 wall_ms = %#v", results[0]["wall_ms"])
	}
	eq(t, "second status", results[1]["status"], 4)
	if ms, ok := results[1]["wall_ms"].(int64); !ok || ms < 0 || ms >= 1000 {
		t.Fatalf("setup-2 wall_ms = %#v", results[1]["wall_ms"])
	}
}

func TestCancelledSetupCommandStillLogsItsResultWithWallTime(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = []string{"sleep 30"}
	r := p.readiness()
	log := &memLog{}
	r.Log = log
	s, _ := p.session()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	err := r.Setup(ctx, s, p.Root, false)
	if err == nil || !strings.Contains(err.Error(), "context deadline exceeded") {
		t.Fatalf("err = %v", err)
	}
	results := log.named("command_result")
	eq(t, "results", len(results), 1)
	if ms, ok := results[0]["wall_ms"].(int64); !ok || ms < 500 || ms >= 3000 {
		t.Fatalf("wall_ms = %#v", results[0]["wall_ms"])
	}
}

func TestNoSetupCommandsLogNeitherSetupEventAlsoOnAStampMatch(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = nil
	r := p.readiness()
	log := &memLog{}
	r.Log = log
	s, _ := p.session()
	for i := 0; i < 2; i++ {
		if err := r.Setup(context.Background(), s, p.Root, true); err != nil {
			t.Fatal(err)
		}
	}
	eq(t, "events", len(log.events), 0)
}

func TestSetupFailureStopsAtTheFirstFailedCommandWithItsLastLines(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = []string{"seq 1 30; exit 9", appendTo(p.trace("later"), "later")}
	s, _ := p.session()
	err := p.readiness().Setup(context.Background(), s, p.Root, true)
	e := failWith(t, err, "environment", "setup_failed")
	eq(t, "detail", e.Detail, "Setup setup-1 failed (status=9).")
	eq(t, "exit", e.Exit, 3)
	eq(t, "lines", len(e.Lines), 22)
	eq(t, "first line", e.Lines[0], "11")
	eq(t, "last tail line", e.Lines[19], "30")
	eq(t, "command line", e.Lines[20], "commands.setup[0]: seq 1 30; exit 9")
	eq(t, "next line", e.Lines[21], setupNext)
	eqSlice(t, "later setup", p.ran("later"), nil)
	if fileExists(filepath.Join(p.Root, ".kogen/local/setup.json")) {
		t.Fatal("a failed setup leaves no stamp")
	}
}

func TestSetupFailureOfAMissingProgramSaysItWasNotFound(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = []string{"definitely-not-a-program --x"}
	s, _ := p.session()
	err := p.readiness().Setup(context.Background(), s, p.Root, false)
	e := failWith(t, err, "environment", "setup_failed")
	eq(t, "detail", e.Detail, "Setup setup-1 failed (status=127).")
	eq(t, "exit", e.Exit, 3)
	eq(t, "lines", len(e.Lines), 3)
	contains(t, "output", e.Lines[0], "definitely-not-a-program")
	eq(t, "command line", e.Lines[1], "commands.setup[0]: definitely-not-a-program --x")
	eq(t, "next line", e.Lines[2], "next: the program was not found; "+strings.TrimPrefix(setupNext, "next: "))
}

// ExUnit: refinement_test.exs, a runner failure after passing scenarios.
func TestRunnerFailureAfterPassingScenariosNeverSuppliesReusableReadiness(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.Config.Acceptance.Run = appendTo(p.trace("executions"), "run") + "; " + p.Config.Acceptance.Run + "; echo fresh runner failure; exit 17"
	r := p.readiness()
	s, _ := p.session()
	for n := 1; n <= 2; n++ {
		_, err := r.Check(context.Background(), s, fixtureSlug)
		e := failWith(t, err, "intent", "not_ready")
		joined := strings.Join(e.Lines, "\n")
		contains(t, "lines", joined, "exit 17 with all scenarios passed; its output:")
		contains(t, "lines", joined, "fresh runner failure")
		eq(t, "executions", len(p.ran("executions")), n)
		if fileExists(readinessPath(p.Root, fixtureSlug)) {
			t.Fatal("no record")
		}
	}
}

// ExUnit: refinement_test.exs, readiness mutations cannot certify the changed baseline.
func TestReadinessMutationsCannotCertifyTheChangedBaselineEvenOnRepeatedChecks(t *testing.T) {
	for name, mutation := range map[string]string{
		"intent file":   "printf '\\n' >> .kogen/intents/fixture/intent.md",
		"staged input":  "printf new > staged-input.txt; git add staged-input.txt",
		"mode":          "chmod 755 app.txt",
		"deleted input": "rm app.txt",
	} {
		t.Run(name, func(t *testing.T) {
			isolateTmp(t)
			p := newProj(t)
			p.Config.Acceptance.Run = mutation + "; " + p.Config.Acceptance.Run
			before := p.git("status", "--porcelain")
			index := p.git("ls-files", "--stage")
			baselineHash := project.Hash(p.Root, must(project.Baseline(p.Root, fixtureSlug, p.Config)))
			r := p.readiness()
			s, _ := p.session()
			for i := 0; i < 2; i++ {
				_, err := r.Check(context.Background(), s, fixtureSlug)
				e := failWith(t, err, "intent", "not_ready")
				eq(t, "detail", e.Detail, "readiness changed candidate files")
				if len(e.Lines) == 0 {
					t.Fatal("the changed files are named")
				}
				eq(t, "checkout status", p.git("status", "--porcelain"), before)
				eq(t, "index", p.git("ls-files", "--stage"), index)
				eq(t, "app.txt", p.read("app.txt"), "green\n")
				eq(t, "baseline hash", project.Hash(p.Root, must(project.Baseline(p.Root, fixtureSlug, p.Config))), baselineHash)
				if fileExists(readinessPath(p.Root, fixtureSlug)) {
					t.Fatal("no record for a mutating check")
				}
			}
		})
	}
}

// ExUnit: refinement_test.exs, local ignored warmth stays available to probes but out of final proof.
func TestLocallyIgnoredWarmthIsAvailableToProbesButOutOfFinalProof(t *testing.T) {
	for _, mode := range []string{"info exclude", "local excludes file"} {
		t.Run(mode, func(t *testing.T) {
			isolateTmp(t)
			p := newProj(t)
			if mode == "info exclude" {
				os.WriteFile(filepath.Join(p.Root, ".git/info/exclude"), []byte("local-cache/\n"), 0o644)
			} else {
				exclude := filepath.Join(p.Aux, "local-excludes")
				os.WriteFile(exclude, []byte("local-cache/\n"), 0o644)
				p.git("config", "core.excludesFile", exclude)
			}
			p.write("local-cache/warm.txt", "workspace only\n")
			s, _ := p.session()
			probe, err := RunProbe(context.Background(), s, p.Root, "cat local-cache/warm.txt", nil)
			if err != nil {
				t.Fatal(err)
			}
			eq(t, "the probe sees the warm file", probe.Output, "workspace only\n")
			p.Config.Acceptance.Run = "test ! -e local-cache/warm.txt && " + p.Config.Acceptance.Run
			r := p.readiness()
			ready, err := r.Check(context.Background(), s, fixtureSlug)
			if err != nil {
				t.Fatal(err)
			}
			eq(t, "exit", ready.AcceptanceExit, 0)
			eq(t, "the checkout keeps its warmth", p.read("local-cache/warm.txt"), "workspace only\n")
			record := must(os.ReadFile(readinessPath(p.Root, fixtureSlug)))
			cached := r.Cached(s, fixtureSlug)
			if cached == nil {
				t.Fatal("the unchanged package reuses its record")
			}
			eq(t, "record untouched by the reuse", string(must(os.ReadFile(readinessPath(p.Root, fixtureSlug)))), string(record))
		})
	}
}

// Ports the `before_record` argument of Readiness.check!/4: a conversation validates its
// private custody after the checks passed and before anything is recorded.
func TestReadinessBeforeRecordRunsAfterTheChecksAndCanStopTheRecord(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	r := p.readiness()
	calls := 0
	r.BeforeRecord = func() error {
		calls++
		if _, ok := p.readinessRecord(); ok {
			t.Error("the record exists before BeforeRecord ran")
		}
		return nil
	}
	s, _ := p.session()
	if _, err := r.Check(context.Background(), s, fixtureSlug); err != nil {
		t.Fatal(err)
	}
	eq(t, "calls", calls, 1)
	if _, ok := p.readinessRecord(); !ok {
		t.Fatal("no record after a passing check")
	}

	stop := sys.Fail("candidate", "context_custody_invalid", "custody damaged", 1)
	r.BeforeRecord = func() error { return stop }
	if _, err := r.Check(context.Background(), s, fixtureSlug); err != stop {
		t.Fatalf("err = %v, want the BeforeRecord error", err)
	}
	if _, ok := p.readinessRecord(); ok {
		t.Fatal("a stopped check left a record")
	}
	if r.Cached(s, fixtureSlug) != nil {
		t.Fatal("a stopped check left reusable evidence")
	}
}

func TestCachedUnexercisedRequiresExactOrderedSourceSubset(t *testing.T) {
	t.Parallel()
	_, scenarios := featureWithSteps(t, "cache", 3)
	steps := ScenarioRecord(scenarios[0]).Steps
	for name, records := range map[string]any{
		"empty": []StepRecord{}, "subset": []StepRecord{steps[0], steps[2]},
		"duplicate": []StepRecord{steps[0], steps[0]}, "reversed": []StepRecord{steps[2], steps[0]},
		"wrong keyword":   []StepRecord{{Keyword: "Then ", Text: steps[0].Text, Line: steps[0].Line}},
		"wrong text":      []StepRecord{{Keyword: steps[0].Keyword, Text: "other", Line: steps[0].Line}},
		"wrong line":      []StepRecord{{Keyword: steps[0].Keyword, Text: steps[0].Text, Line: 99}},
		"bad types":       []any{map[string]any{"keyword": 1, "text": "step 1", "line": 3}},
		"fractional line": []any{map[string]any{"keyword": "Given ", "text": "step 1", "line": 3.5}},
		"extra field":     []any{map[string]any{"keyword": "Given ", "text": "step 1", "line": 3, "extra": true}},
	} {
		t.Run(name, func(t *testing.T) {
			got, ok := cachedUnexercised(generic(records), scenarios[0])
			want := name == "empty" || name == "subset"
			if ok != want {
				t.Fatalf("valid = %v want %v", ok, want)
			}
			if want && encode(got) != encode(records) {
				t.Fatalf("round trip: %s", encode(got))
			}
		})
	}
}

func TestObservationsKeepFirstFailureBeforeLongSkippedListings(t *testing.T) {
	t.Parallel()
	where := "a hook at features/steps/fixture_steps.js line 8"
	detail := Cut(where + "\nhook-red: " + strings.Repeat("é", 11000))
	skipped := []StepRecord{}
	for line := 3; line < 103; line++ {
		skipped = append(skipped, StepRecord{Keyword: "Then ", Text: strings.Repeat("é", 100), Line: line})
	}
	ready := &Ready{AcceptanceExit: 1, Scenarios: []ScenarioResult{{
		Name: "Long skipped tail", Line: 2, Status: "failed", Detail: &detail, UnexercisedSteps: skipped,
	}}}
	for name, text := range map[string]string{
		"observations":   Observations(fixtureSlug, ready, ""),
		"acknowledgment": Acknowledgment(fixtureSlug, ready, ""),
	} {
		if len(text) > 16384 || !utf8.ValidString(text) {
			t.Fatalf("%s: %d bytes, valid UTF-8 %v", name, len(text), utf8.ValidString(text))
		}
		contains(t, name, text, "Unexercised acceptance steps: 100")
		contains(t, name, text, "Skipped steps are unexercised; readiness does not prove their behavior or fixture validity.")
		contains(t, name, text, "Scenario: Long skipped tail (acceptance.feature line 2)")
		contains(t, name, text, where+"\nhook-red:")
		contains(t, name, text, "bytes omitted")
	}
}

func TestPassingAttemptEvidenceSurvivesScratchButIsNotReadiness(t *testing.T) {
	tmp := isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = []string{"echo setup"}
	r := p.readiness()
	r.Attempt = NewAttempt(p.Root, fixtureSlug, nil)
	s, _ := p.session()
	if _, err := r.Check(context.Background(), s, fixtureSlug); err != nil {
		t.Fatal(err)
	}
	requireNoLeftovers(t, tmp)
	paths, err := filepath.Glob(filepath.Join(attemptsDir(p.Root), "*", "attempt.json"))
	if err != nil || len(paths) != 1 {
		t.Fatalf("attempt paths: %v, %v", paths, err)
	}
	b, err := os.ReadFile(paths[0])
	if err != nil {
		t.Fatal(err)
	}
	var rec attemptRecord
	if err := json.Unmarshal(b, &rec); err != nil {
		t.Fatal(err)
	}
	if rec.Outcome != "passed" || rec.Failure != nil || len(rec.NotRun) != 0 || len(rec.Steps) != len(r.Attempt.steps) {
		t.Fatalf("attempt: %+v", rec)
	}
	for i, st := range rec.Steps {
		if st.Name != r.Attempt.steps[i].Name || st.StartedAt == "" || st.EndedAt == "" {
			t.Fatalf("step: %+v", st)
		}
	}
	if err := os.Remove(readinessPath(p.Root, fixtureSlug)); err != nil {
		t.Fatal(err)
	}
	if r.Cached(s, fixtureSlug) != nil {
		t.Fatal("diagnostic attempt was reused as readiness")
	}
}

// A Shape acceptance timeout (no caller Attempt) keeps its refusal and explains the stop with the
// measured wall time, the output (or none), the host load and one retained shape_attempt record;
// every other Shape result retains nothing.
func TestShapeAcceptanceTimeoutExplainsItselfWithEvidence(t *testing.T) {
	first := "acceptance timed out: command exceeds the 120-second limit"
	for _, c := range []struct{ name, command, output string }{
		{"output", "echo partial-marker; sleep 30", "partial-marker"},
		{"silent", "sleep 30", ""},
	} {
		t.Run(c.name, func(t *testing.T) {
			p := newProj(t)
			p.Config.Acceptance.Run = c.command
			_, restore := ContractShapeAcceptanceDeadline(time.Second)
			defer restore()
			r := p.readiness()
			r.BoundShapeAcceptance = true
			s, _ := p.session()
			_, err := r.Check(context.Background(), s, fixtureSlug)
			e, ok := sys.AsError(err)
			if !ok || e.Class != "intent" || e.Reason != "not_ready" || e.Detail != "acceptance timed out" || e.Exit != 1 {
				t.Fatalf("refusal = %#v", err)
			}
			n := len(e.Lines)
			if n != 4+len(wantShapeOutputLines(c.output)) || e.Lines[0] != first || !strings.HasPrefix(e.Lines[1], "Acceptance ran for ") || !strings.HasSuffix(e.Lines[1], "s before it was stopped with its process group.") {
				t.Fatalf("lines = %q", e.Lines)
			}
			wantOut := wantShapeOutputLines(c.output)
			if got := e.Lines[2 : 2+len(wantOut)]; !slices.Equal(got, wantOut) {
				t.Fatalf("output lines = %q, want %q", got, wantOut)
			}
			if !strings.HasPrefix(e.Lines[n-2], "Host load at start: ") || !strings.HasSuffix(e.Lines[n-2], ". Load alone does not establish the cause.") {
				t.Fatalf("load line = %q", e.Lines[n-2])
			}
			evidence, ok := strings.CutPrefix(e.Lines[n-1], "Evidence: ")
			if !ok {
				t.Fatalf("last line = %q", e.Lines[n-1])
			}
			paths, _ := filepath.Glob(filepath.Join(p.Root, ".kogen/local/readiness/attempts/*/attempt.json"))
			if len(paths) != 1 || paths[0] != evidence {
				t.Fatalf("records = %q, evidence %q", paths, evidence)
			}
			if fi, _ := os.Stat(evidence); fi.Mode().Perm() != 0o600 {
				t.Fatalf("file mode = %v", fi.Mode())
			}
			if fi, _ := os.Stat(filepath.Dir(evidence)); fi.Mode().Perm() != 0o700 {
				t.Fatalf("folder mode = %v", fi.Mode())
			}
			b, err := os.ReadFile(evidence)
			if err != nil {
				t.Fatal(err)
			}
			var rec struct {
				Kind, Outcome, Note string
				StepTimeoutSeconds  int `json:"step_timeout_seconds"`
				Steps               []map[string]any
				NotRun              []string `json:"not_run"`
				Failure             struct {
					Class, Reason, Detail, Step string
					TimedOut                    bool `json:"timed_out"`
					Lines                       []string
				}
			}
			if err := json.Unmarshal(b, &rec); err != nil {
				t.Fatal(err)
			}
			if rec.Kind != "shape_attempt" || rec.Outcome != "refused" || rec.StepTimeoutSeconds != 1 || len(rec.Steps) != 1 || rec.NotRun == nil || len(rec.NotRun) != 0 ||
				!strings.Contains(rec.Note, "Shape acceptance check") {
				t.Fatalf("record = %s", b)
			}
			st := rec.Steps[0]
			if st["name"] != "acceptance" || st["kind"] != "acceptance" || st["status"] != "timed_out" || st["timed_out"] != true {
				t.Fatalf("step = %v", st)
			}
			if _, ok := st["load_start"]; !ok {
				t.Fatalf("step lacks load_start: %v", st)
			}
			if _, ok := st["load_end"]; !ok {
				t.Fatalf("step lacks load_end: %v", st)
			}
			var typed attemptRecord
			if err := json.Unmarshal(b, &typed); err != nil {
				t.Fatal(err)
			}
			step := typed.Steps[0]
			if e.Lines[1] != fmt.Sprintf("Acceptance ran for %s before it was stopped with its process group.", fmtSeconds(step.DurationMS)) || e.Lines[n-2] != timeoutLoad(step) {
				t.Fatalf("lines do not match recorded duration and load: %q, %+v", e.Lines, step)
			}
			if f := rec.Failure; f.Class != "intent" || f.Reason != "not_ready" || f.Detail != "acceptance timed out" || f.Step != "acceptance" || !f.TimedOut || !slices.Equal(f.Lines, e.Lines[:n-1]) {
				t.Fatalf("failure = %+v", f)
			}
			if _, ok := p.readinessRecord(); ok {
				t.Fatal("a Shape timeout wrote a readiness record")
			}
		})
	}
}

func wantShapeOutputLines(output string) []string {
	if output == "" {
		return []string{"It wrote no output before it was stopped."}
	}
	return []string{"Its output before it was stopped (stdout and stderr, secrets masked):", output}
}

func TestShapeAcceptanceWithoutTimeoutRetainsNothing(t *testing.T) {
	for _, c := range []struct {
		name, command string
		red, refused  bool
	}{
		{"passes", "", false, false},
		{"accounted red", "echo actual-case-red; exit 1", true, false},
		{"plain failure", "echo plain-failure; exit 1", false, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			p := newProj(t)
			if c.command != "" {
				if c.red {
					c.command = "cp '" + p.Red + "' \"$KOGEN_ACCEPTANCE_REPORT\"; " + c.command
				}
				p.Config.Acceptance.Run = c.command
			}
			_, restore := ContractShapeAcceptanceDeadline(time.Minute)
			defer restore()
			r := p.readiness()
			r.BoundShapeAcceptance = true
			s, _ := p.session()
			ready, err := r.Check(context.Background(), s, fixtureSlug)
			if (err != nil) != c.refused {
				t.Fatalf("err = %v", err)
			}
			if !c.refused {
				wantExit := 0
				if c.red {
					wantExit = 1
				}
				if ready == nil || ready.AcceptanceExit != wantExit {
					t.Fatalf("ready = %+v, want acceptance exit %d", ready, wantExit)
				}
			} else {
				e, ok := sys.AsError(err)
				if !ok || e.Class != "intent" || e.Reason != "not_ready" || e.Detail != "the Intent is not ready to build" || e.Exit != 1 || !slices.Equal(e.Lines, []string{"report_missing: the acceptance command exited 1; its output:", "plain-failure"}) {
					t.Fatalf("refusal = %#v", err)
				}
			}
			if e, ok := sys.AsError(err); ok {
				for _, l := range e.Lines {
					if strings.HasPrefix(l, "Evidence") || strings.HasPrefix(l, "Host load") {
						t.Fatalf("unexpected line %q", l)
					}
				}
			}
			if paths, _ := filepath.Glob(filepath.Join(p.Root, ".kogen/local/readiness/attempts/*/attempt.json")); len(paths) != 0 {
				t.Fatalf("retained %q", paths)
			}
		})
	}
}

func TestDryRunProblemsNamesAcceptedFailuresOnlyWithASetupRefusal(t *testing.T) {
	t.Parallel()
	scenarios := []ScenarioResult{
		{Name: "First", Line: 2, Status: "failed", Phase: "assertion"},
		{Name: "Seeded", Line: 5, Status: "failed", Phase: "setup", SetupFailure: "acceptance.feature line 6: Given a seeded fixture\nboom"},
		{Name: "Prepared", Line: 8, Status: "failed", Phase: "setup"},
		{Name: "Later", Line: 10, Status: "passed"},
	}
	eqSlice(t, "refusal", dryRunProblems(Acceptance{Status: 1, Scenarios: scenarios}), []string{
		"setup failure: Seeded (line 5)\nacceptance.feature line 6: Given a seeded fixture\nboom",
		"accepted assertion failure: First (line 2)",
		"accepted setup failure: Prepared (line 8)",
	})
	if got := dryRunProblems(Acceptance{Status: 1, Scenarios: slices.Delete(slices.Clone(scenarios), 1, 2)}); len(got) != 0 {
		t.Fatalf("accepted red alone is not a problem: %v", got)
	}
}

func TestReadinessInstallGateBeforeAcceptance(t *testing.T) {
	t.Parallel()
	p := newProj(t)
	root := t.TempDir()
	node := filepath.Join(root, "node")
	np := filepath.Join(root, "node-path")
	pkg := filepath.Join(root, "lib/cucumber/node_modules/@cucumber/cucumber")
	if err := os.WriteFile(node, []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(np, []byte(" \n"+node+"\n"), 0644); err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(pkg, 0755)
	trace := p.trace("started")
	p.Config.Acceptance.Run = `printf '%s' "$KOGEN_NODE" > ` + shellQuote(trace) + `; ` + p.Config.Acceptance.Run
	r := p.readiness()
	s, _ := p.session()
	run := func(cause string) {
		t.Helper()
		r.Tools = ToolsFromInstall(root)
		_, err := r.Check(context.Background(), s, fixtureSlug)
		e := failWith(t, err, "environment", "tool_missing")
		contains(t, "cause", e.Detail, cause)
		if e.Exit != 3 || fileExists(trace) {
			t.Fatalf("refusal or acceptance trace: %+v", e)
		}
	}
	os.Remove(np)
	os.RemoveAll(pkg)
	run("node-path is missing")
	os.WriteFile(np, []byte(node), 0644)
	run("cucumber")
	os.MkdirAll(pkg, 0755)
	modelPath := project.ModelPath(fixtureSlug)
	p.setModel(fmt.Sprintf("%s invariants=Safe seed=7 samples=40 steps=12", modelPath), map[string]string{modelPath: realModel})
	run("quint")
	p.setModel("not applicable — nothing to model", nil)
	if err := os.WriteFile(np, []byte(" \n"+node+"\n "), 0644); err != nil {
		t.Fatal(err)
	}
	r.Tools = ToolsFromInstall(root)
	ready, err := r.Check(context.Background(), s, fixtureSlug)
	if err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(trace)
	if err != nil || string(b) != node {
		t.Fatalf("KOGEN_NODE = %q, %v", b, err)
	}
	if ready.AcceptanceExit != 0 || len(ready.Scenarios) != 2 || ready.Failures() {
		t.Fatalf("readiness: %+v", ready)
	}
}
