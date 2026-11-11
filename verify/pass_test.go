package verify

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/KogenAI/kogen-coordinator/project"
)

// passGolden is testdata/golden/passes.json: recorded pass records with the feedback and the
// completeness verdict the code gives them. Every `pass` record is input, as are the other
// fields of each case.
// `go test -update` rewrites `feedback[].feedback` and `complete[].complete`; no other byte of
// the file is rewritten.
type passGolden struct {
	Feedback []struct {
		Name          string          `json:"name"`
		Pass          json.RawMessage `json:"pass"`
		AcceptanceRun string          `json:"acceptance_run"`
		Completion    string          `json:"completion"`
		Feedback      string          `json:"feedback"`
	} `json:"feedback"`
	Complete []struct {
		Name    string          `json:"name"`
		Pass    json.RawMessage `json:"pass"`
		Feature string          `json:"feature"`
		Setup   []string        `json:"setup"`
		Checks  []project.Check `json:"checks"`
		Model   string          `json:"model"`
		Done    bool            `json:"complete"`
	} `json:"complete"`
}

func readPass(t *testing.T, raw json.RawMessage) Pass {
	t.Helper()
	var p Pass
	if err := json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPassFeedbackEqualsTheElixirFeedback(t *testing.T) {
	var g passGolden
	readGolden(t, "passes.json", &g)
	if len(g.Feedback) < 10 {
		t.Fatal("missing reference cases")
	}
	edits := goldenUpdates(t, "passes.json")
	for i, c := range g.Feedback {
		t.Run(c.Name, func(t *testing.T) {
			p := readPass(t, c.Pass)
			got := p.Feedback(c.AcceptanceRun, c.Completion)
			if edits != nil && got != c.Feedback {
				edits.set(got, "feedback", i, "feedback")
				c.Feedback = got
			}
			if got != c.Feedback {
				t.Fatalf("feedback differs\n got: %q\nwant: %q", got, c.Feedback)
			}
			// What Kogen writes reads back to the same pass.
			again, err := json.Marshal(p)
			if err != nil {
				t.Fatal(err)
			}
			var expected map[string]any
			json.Unmarshal(c.Pass, &expected)
			if acc, ok := expected["acceptance"].(map[string]any); ok {
				if scenarios, ok := acc["scenarios"].([]any); ok {
					for _, sc := range scenarios {
						sc.(map[string]any)["unexercised_steps"] = nil
					}
				}
			}
			sameJSON(t, "pass record", p, json.RawMessage(encode(expected)))
			if q := readPass(t, again); q.Feedback(c.AcceptanceRun, c.Completion) != c.Feedback {
				t.Fatal("a pass read back from its own record gives other feedback")
			}
		})
	}
}

func TestPassCompleteEqualsTheElixirVerdictOnEveryReference(t *testing.T) {
	var g passGolden
	readGolden(t, "passes.json", &g)
	edits := goldenUpdates(t, "passes.json")
	for i, c := range g.Complete {
		t.Run(c.Name, func(t *testing.T) {
			expected, err := project.ParseGherkin(c.Feature)
			if err != nil {
				t.Fatal(err)
			}
			cfg := &project.Config{Setup: c.Setup, Checks: c.Checks}
			var model *project.ModelSpec
			if c.Model == "none" {
				model = &project.ModelSpec{None: true}
			} else {
				model = &project.ModelSpec{Path: "m.qnt", Invariants: []string{"Safe"}, Seed: "1", Samples: "1", Steps: "1"}
			}
			p := readPass(t, c.Pass)
			got := p.Complete(cfg, expected, model)
			if edits != nil && got != c.Done {
				edits.set(got, "complete", i, "complete")
				c.Done = got
			}
			if got != c.Done {
				t.Fatalf("Complete = %v, want %v", got, c.Done)
			}
			// A pass written by Kogen and read back keeps its verdict.
			again, err := json.Marshal(p)
			if err != nil {
				t.Fatal(err)
			}
			q := readPass(t, again)
			if got := q.Complete(cfg, expected, model); got != c.Done {
				t.Fatalf("Complete after a round trip = %v, want %v", got, c.Done)
			}
		})
	}
}

func TestPassRecordHasExactlyTheFieldsKogenRecords(t *testing.T) {
	p := Pass{N: 3, Clean: true, Tree: "abc", Model: ModelNone}
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	var keys []string
	for k := range m {
		keys = append(keys, k)
	}
	want := []string{"n", "clean", "green", "tree", "setup", "acceptance", "model", "checks", "not_run", "moved", "failing"}
	if len(keys) != len(want) {
		t.Fatalf("keys = %v, want %v", keys, want)
	}
	for _, k := range want {
		if _, ok := m[k]; !ok {
			t.Fatalf("record lacks %q: %s", k, b)
		}
	}
	for _, k := range []string{"setup", "checks", "not_run", "moved", "failing"} {
		if string(m[k]) != "[]" {
			t.Fatalf("%s = %s, want []", k, m[k])
		}
	}
	if string(m["acceptance"]) != `"not_run"` || string(m["model"]) != `"none"` {
		t.Fatalf("acceptance %s, model %s", m["acceptance"], m["model"])
	}
	for _, c := range []struct {
		m    ModelResult
		want string
	}{
		{ModelNone, `"none"`}, {ModelNotRun, `"not_run"`},
		{ModelResult{State: "ok", Problems: []string{}}, `{"ok":[]}`},
		{ModelResult{State: "failed", Problems: []string{"x"}}, `{"failed":["x"]}`},
	} {
		b, _ := json.Marshal(Pass{Model: c.m})
		if !strings.Contains(string(b), `"model":`+c.want) {
			t.Fatalf("model %v encodes as %s, want %s", c.m, b, c.want)
		}
	}
}

func TestPassSummaryProgressLine(t *testing.T) {
	for _, c := range []struct {
		p    Pass
		want string
	}{
		{Pass{N: 1, Green: true}, "kogen: pass 1: all checks passed"},
		{Pass{N: 2, Failing: []string{"acceptance", "lint"}, NotRun: []string{"test"}}, "kogen: pass 2: acceptance, lint failed; not run because an earlier item failed: test"},
		{Pass{N: 3, Moved: []string{"a", "b"}}, "kogen: pass 3: files changed while the checks ran: a, b"},
		{Pass{N: 4, Failing: []string{"setup-1"}, NotRun: []string{"setup-2", "acceptance", "z-first", "a-later"}},
			"kogen: pass 4: setup-1 failed; not run because an earlier item failed: setup-2, acceptance, z-first, a-later"},
	} {
		eq(t, "summary", c.p.Summary(), c.want)
	}
	eq(t, "notice", NotRunNotice([]string{"a", "b"}), "not run because an earlier item failed: a, b")
	eq(t, "empty notice", NotRunNotice(nil), "")
}

func TestPassChecksLineAndResults(t *testing.T) {
	acc := &Acceptance{Passed: 2, Scenarios: []ScenarioResult{{}, {}}}
	p := Pass{Acceptance: acc, Model: ModelResult{State: "ok"}, Checks: []CommandResult{{Name: "lint"}, {Name: "test"}}}
	eq(t, "checks line", p.ChecksLine(), "acceptance 2/2, model passed, lint passed, test passed")
	eq(t, "results", p.Results(), "acceptance: passed (2 scenarios)\nmodel: passed\ncheck lint: passed\ncheck test: passed")
	p.Model = ModelNone
	eq(t, "checks line none", p.ChecksLine(), "acceptance 2/2, model not applicable, lint passed, test passed")
	eq(t, "results none", p.Results(), "acceptance: passed (2 scenarios)\nmodel: not applicable\ncheck lint: passed\ncheck test: passed")
}

func TestPassValidIsTheShapeAResumedRecordMustHave(t *testing.T) {
	var g passGolden
	readGolden(t, "passes.json", &g)
	good := readPass(t, g.Complete[0].Pass)
	if !good.Valid() {
		t.Fatal("a recorded complete pass is valid")
	}
	for name, mutate := range map[string]func(p *Pass){
		"not clean":          func(p *Pass) { p.Clean = false },
		"no tree":            func(p *Pass) { p.Tree = "" },
		"no model":           func(p *Pass) { p.Model = ModelResult{} },
		"acceptance no list": func(p *Pass) { a := *p.Acceptance; a.Scenarios = nil; p.Acceptance = &a },
	} {
		p := good
		mutate(&p)
		if p.Valid() {
			t.Errorf("%s: must not be valid", name)
		}
	}
	p := good
	p.Acceptance = nil // not run
	if !p.Valid() {
		t.Error("a pass whose acceptance did not run is valid")
	}
}

func TestPassRecordsThatCannotBeReadAreRejected(t *testing.T) {
	var p Pass
	for name, text := range map[string]string{
		"not an object":      `[]`,
		"no model":           `{"n":1,"clean":true,"green":false,"tree":"t","acceptance":"not_run","checks":[],"moved":[],"failing":[]}`,
		"unknown model":      `{"n":1,"acceptance":"not_run","model":{"weird":[]},"checks":[]}`,
		"two model keys":     `{"n":1,"acceptance":"not_run","model":{"ok":[],"failed":[]},"checks":[]}`,
		"acceptance garbage": `{"n":1,"acceptance":7,"model":"none","checks":[]}`,
		"check garbage":      `{"n":1,"acceptance":"not_run","model":"none","checks":[1]}`,
	} {
		if err := json.Unmarshal([]byte(text), &p); err == nil {
			t.Errorf("%s: record was accepted", name)
		}
	}
}

// ExUnit: run_test.exs, completeness of green evidence (the checkpoint-decoder half of that
// test belongs to the build package).
func TestCompleteRequiresRequiredCleanEvidenceNotAStoredBoolean(t *testing.T) {
	expected, err := project.ParseGherkin("Feature: Example\n  Scenario: Complete\n    Given a gate\n")
	if err != nil {
		t.Fatal(err)
	}
	cfg := &project.Config{Setup: []string{"true"}, Checks: []project.Check{{Name: "z-first", Run: "true"}, {Name: "a-last", Run: "true"}}}
	none := &project.ModelSpec{None: true}
	scenario := func(status string) ScenarioResult { return ScenarioResult{Name: "Complete", Line: 2, Status: status} }
	acc := func() *Acceptance {
		return &Acceptance{Status: 0, Passed: 1, Scenarios: []ScenarioResult{scenario("passed")}, Problems: []string{}}
	}
	checks := func() []CommandResult {
		return []CommandResult{{Name: "z-first", Command: "true"}, {Name: "a-last", Command: "true"}}
	}
	old := Pass{Green: true, Clean: true, Acceptance: acc(), Model: ModelNone, Checks: checks(), NotRun: []string{}, Setup: []CommandResult{{Name: "setup-1", Command: "true"}}}
	current := old
	if !current.Complete(cfg, expected, none) {
		t.Fatal("current complete evidence is reusable")
	}
	noSetup := current
	noSetup.Setup = nil
	if noSetup.Complete(cfg, expected, none) {
		t.Fatal("a current record without its setup is incomplete")
	}
	mut := func(f func(p *Pass)) Pass { p := old; p.Acceptance, p.Checks = acc(), checks(); f(&p); return p }
	for name, p := range map[string]Pass{
		"not clean":         mut(func(p *Pass) { p.Clean = false }),
		"not green":         mut(func(p *Pass) { p.Green = false }),
		"acceptance absent": mut(func(p *Pass) { p.Acceptance = nil }),
		"exit status":       mut(func(p *Pass) { p.Acceptance.Status = 1 }),
		"problems":          mut(func(p *Pass) { p.Acceptance.Problems = []string{"report_invalid"} }),
		"duplicated":        mut(func(p *Pass) { p.Acceptance.Scenarios = append(p.Acceptance.Scenarios, scenario("passed")) }),
		"no checks":         mut(func(p *Pass) { p.Checks = nil }),
		"checks reversed":   mut(func(p *Pass) { p.Checks = []CommandResult{p.Checks[1], p.Checks[0]} }),
		"no scenarios":      mut(func(p *Pass) { p.Acceptance.Scenarios = nil }),
		"skipped":           mut(func(p *Pass) { p.Acceptance.Scenarios = []ScenarioResult{scenario("skipped")} }),
		"not run":           mut(func(p *Pass) { p.NotRun = []string{"a-last"} }),
		"speculative":       mut(func(p *Pass) { p.Speculative = []CommandResult{{Name: "later"}} }),
		"cancelled":         mut(func(p *Pass) { p.Cancelled = []CommandResult{{Name: "later", Status: -1}} }),
		"empty setup":       mut(func(p *Pass) { p.Setup = []CommandResult{} }),
	} {
		if p.Complete(cfg, expected, none) {
			t.Errorf("%s: must be incomplete", name)
		}
	}
	model := &project.ModelSpec{Path: "model.qnt"}
	if old.Complete(cfg, expected, model) {
		t.Error("an Intent with a model needs the model passed")
	}
	withModel := old
	withModel.Model = ModelResult{State: "ok", Problems: []string{}}
	if !withModel.Complete(cfg, expected, model) {
		t.Error("a passed model completes the evidence")
	}
}

// ExUnit: run_test.exs, the run log cap.
func TestCapPreservesUTF8AndFitsInAMebibyteIncludingItsMarker(t *testing.T) {
	for _, size := range []int{1048575, 1048576} {
		text := strings.Repeat("x", size)
		eq(t, "short enough", Cap(text) == text, true)
	}
	for _, text := range []string{strings.Repeat("x", 1048577), strings.Repeat("€", 400000), strings.Repeat("🌍", 300000)} {
		capped := Cap(text)
		if len(capped) > 1048576 || !utf8.ValidString(capped) {
			t.Fatalf("cap: %d bytes, valid %v", len(capped), utf8.ValidString(capped))
		}
		parts := strings.Split(capped, "\n[... cut in the run log ...]\n")
		if len(parts) != 2 || !strings.HasPrefix(text, parts[0]) || !strings.HasSuffix(text, parts[1]) {
			t.Fatal("the cap keeps the start and the end of the output")
		}
		var round struct{ Output string }
		if err := json.Unmarshal([]byte(encode(map[string]any{"output": capped})), &round); err != nil || round.Output != capped {
			t.Fatal("a capped output survives JSON")
		}
	}
}

func TestMaintainedFeatureRoundTrip(t *testing.T) {
	detail := "failure detail"
	p := Pass{Model: ModelNone, MaintainedFeatures: []MaintainedFeatureResult{
		{Path: "red.feature", Result: &Acceptance{Status: 1, Scenarios: []ScenarioResult{{Name: "First", Status: "failed", Detail: &detail}}, Problems: []string{"First: failure detail"}, BindingProblems: []string{}}},
		{Path: "later.feature"},
	}}
	data, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var got Pass
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.MaintainedFeatures) != 2 || got.MaintainedFeatures[0].Result == nil || *got.MaintainedFeatures[0].Result.Scenarios[0].Detail != detail || got.MaintainedFeatures[1].Result != nil {
		t.Fatalf("round trip: %+v", got.MaintainedFeatures)
	}
	data2, err := json.Marshal(got)
	if err != nil || string(data) != string(data2) {
		t.Fatalf("round trip bytes: %s != %s: %v", data, data2, err)
	}
}

func TestExecutionOrderNeverNullWhenEmitted(t *testing.T) {
	b, err := json.Marshal(Pass{PulledForward: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"execution_order":[]`) || !strings.Contains(string(b), `"pulled_forward":[]`) {
		t.Fatalf("constructed: %s", b)
	}
	var p Pass
	if err := json.Unmarshal([]byte(`{"n":1,"clean":true,"green":true,"tree":"t","checks":[],"moved":[],"failing":[],"setup":[],"not_run":[],"acceptance":"not_run","model":"none","pulled_forward":["C"]}`), &p); err != nil {
		t.Fatal(err)
	}
	b, err = json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"execution_order":[]`) || !strings.Contains(string(b), `"pulled_forward":["C"]`) {
		t.Fatalf("decoded: %s", b)
	}
	b, err = json.Marshal(Pass{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "execution_order") || strings.Contains(string(b), "pulled_forward") {
		t.Fatalf("ordinary record: %s", b)
	}
}

func TestDependencyReorderedKeyIsWrittenOnlyWhenSet(t *testing.T) {
	record := `{"dependency_reordered":true,"n":1,"clean":true,"green":true,"tree":"t","setup":[],"acceptance":"not_run","model":"none","checks":[],"not_run":[],"moved":[],"failing":[]}`
	var p Pass
	if err := json.Unmarshal([]byte(record), &p); err != nil {
		t.Fatal(err)
	}
	if !p.dependencyReordered {
		t.Fatalf("flag not restored: %+v", p)
	}
	b, err := json.Marshal(p)
	if err != nil || string(b) != record {
		t.Fatalf("re-marshalled: %s != %s: %v", b, record, err)
	}
	b, err = json.Marshal(Pass{})
	if err != nil || strings.Contains(string(b), "dependency_reordered") {
		t.Fatalf("ordinary record: %s: %v", b, err)
	}
}

func TestPassSummaryAcceptanceScenarios(t *testing.T) {
	tests := []struct {
		name string
		pass Pass
		want string
	}{
		{"two of seven", Pass{N: 6, Failing: []string{"acceptance"}, NotRun: []string{"model", "checks"}, Acceptance: &Acceptance{Scenarios: []ScenarioResult{
			{Name: "Alpha", Line: 6, Status: "passed"}, {Name: "Beta", Line: 12, Status: "failed"}, {Name: "Gamma", Line: 18, Status: "passed"}, {Name: "Delta", Line: 24, Status: "skipped"}, {Name: "Epsilon", Line: 30, Status: "passed"}, {Name: "Zeta", Line: 36, Status: "passed"}, {Name: "Eta", Line: 42, Status: "passed"},
		}}}, "kogen: pass 6: acceptance failed (2 of 7 scenarios: Beta:12, Delta:24); not run because an earlier item failed: model, checks"},
		{"five failures", Pass{N: 1, Failing: []string{"acceptance"}, Acceptance: &Acceptance{Scenarios: []ScenarioResult{
			{Name: "Zebra", Line: 3, Status: "failed"}, {Name: "Ant", Line: 7, Status: "failed"}, {Name: "Yak", Line: 11, Status: "failed"}, {Name: "Bee", Line: 15, Status: "failed"}, {Name: "Fox", Line: 19, Status: "failed"},
		}}}, "kogen: pass 1: acceptance failed (5 of 5 scenarios: Zebra:3, Ant:7, Yak:11, ...)"},
		{"not run", Pass{N: 2, Failing: []string{"compile"}, NotRun: []string{"acceptance", "model"}}, "kogen: pass 2: compile failed; not run because an earlier item failed: acceptance, model"},
		{"empty results", Pass{N: 3, Failing: []string{"acceptance"}, Acceptance: &Acceptance{}}, "kogen: pass 3: acceptance failed"},
		{"other sections", Pass{N: 4, Failing: []string{"lint", "acceptance"}, Acceptance: &Acceptance{Scenarios: []ScenarioResult{{Name: "A", Line: 9, Status: "failed"}}}, Speculative: []CommandResult{{Name: "test"}}, Cancelled: []CommandResult{{Name: "build"}}}, "kogen: pass 4: lint, acceptance failed (1 of 1 scenarios: A:9); Speculative results: test; Cancelled work: build"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) { eq(t, "summary", tt.pass.Summary(), tt.want) })
	}
}

func TestPassRecordWithoutCurrentEvidenceIsRefused(t *testing.T) {
	for name, record := range map[string]string{
		"no setup":   `{"n":1,"tree":"t","acceptance":"not_run","model":"none","checks":[],"moved":[],"failing":[],"not_run":[]}`,
		"no not_run": `{"n":1,"tree":"t","acceptance":"not_run","model":"none","checks":[],"moved":[],"failing":[],"setup":[]}`,
		"neither":    `{"n":1,"tree":"t","acceptance":"not_run","model":"none","checks":[],"moved":[],"failing":[]}`,
	} {
		var p Pass
		if err := json.Unmarshal([]byte(record), &p); err == nil {
			t.Errorf("%s: a record without current setup and not_run evidence must be refused", name)
		}
	}
}
