package contract_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-verification/verify"
)

func TestShapingStepReports(t *testing.T) {
	intent := &project.Intent{Slug: "k", Acceptance: []string{project.FeaturePath("k"), "features/steps/k_steps.js", "features/steps/k_driver.go", "test/k_helper.js"}}
	if got := verify.OwnStepFiles(intent); !slices.Equal(got, []string{"features/steps/k_steps.js"}) {
		t.Fatal(got)
	}
	const own = "features/steps/a_steps.js"
	var raw verify.StepRaw
	if err := json.Unmarshal([]byte(`{"loads":[{"file":"features/steps/a_steps.js","error":""}],"defs":[{"file":"features/steps/a_steps.js","pattern":"x","body":"","used":true},{"file":"features/steps/a_steps.js","pattern":"dead","body":"","used":false},{"file":"features/steps/other.js","pattern":"o","body":"","used":false}],"steps":[{"text":"x","count":1},{"text":"y","count":0},{"text":"z","count":2}]}`), &raw); err != nil {
		t.Fatal(err)
	}
	items := verify.StepItems([]string{own}, raw)
	var defects []string
	for _, i := range items {
		if !i.OK {
			defects = append(defects, i.Check+" "+i.Target+": "+i.Detail)
		}
	}
	if !slices.Equal(defects, []string{"steps y: undefined step", "steps z: ambiguous step (2 definitions)"}) {
		t.Fatal(defects)
	}
	if got := verify.StepWarnings(items); !reflect.DeepEqual(got, []verify.StepWarning{{Pattern: "dead", File: own, Detail: verify.UnusedDefinition}}) {
		t.Fatal(got)
	}
	raw.Loads[0].Error = "SyntaxError: boom"
	items = verify.StepItems([]string{own}, raw)
	if len(items) != 1 || items[0].OK || items[0].Detail != "SyntaxError: boom" || len(verify.StepWarnings(items)) != 0 {
		t.Fatal(items)
	}
}

func complete() verify.Pass {
	return verify.Pass{N: 1, Clean: true, Green: true, Tree: "tree", Setup: []verify.CommandResult{{Name: "setup-1", Command: "true"}}, Acceptance: &verify.Acceptance{Passed: 1, Scenarios: []verify.ScenarioResult{{Line: 2, Name: "Complete", Status: "passed"}}}, Model: verify.ModelNone, Checks: []verify.CommandResult{{Name: "z-first", Command: "true"}, {Name: "a-last", Command: "true"}}}
}
func TestBuildCompleteEvidence(t *testing.T) {
	cfg := &project.Config{Setup: []string{"true"}, Checks: []project.Check{{Name: "z-first", Run: "true"}, {Name: "a-last", Run: "true"}}}
	expected := []project.Scenario{{Name: "Complete", Line: 2}}
	mutations := map[string]func(*verify.Pass){"not run": func(p *verify.Pass) { p.NotRun = []string{"a-last"} }, "checks absent": func(p *verify.Pass) { p.Checks = nil }, "acceptance absent": func(p *verify.Pass) { p.Acceptance = nil }, "setup absent": func(p *verify.Pass) { p.Setup = nil }, "reversed": func(p *verify.Pass) { p.Checks[0], p.Checks[1] = p.Checks[1], p.Checks[0] }, "failed": func(p *verify.Pass) { p.Acceptance.Status = 1 }, "invalid": func(p *verify.Pass) { p.Acceptance.Problems = []string{"report_invalid"} }, "skipped": func(p *verify.Pass) { p.Acceptance.Scenarios[0].Status = "skipped" }, "model": func(p *verify.Pass) { p.Model = verify.ModelNotRun }, "moved": func(p *verify.Pass) { p.Moved = []string{"x"} }, "failing": func(p *verify.Pass) { p.Failing = []string{"x"} }}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			p := complete()
			mutate(&p)
			b, e := json.Marshal(p)
			if e != nil {
				t.Fatal(e)
			}
			var q verify.Pass
			if e = json.Unmarshal(b, &q); e != nil {
				t.Fatal(e)
			}
			if q.Complete(cfg, expected, nil) {
				t.Fatalf("accepted %+v", q)
			}
		})
	}
	p := complete()
	b, e := json.Marshal(p)
	if e != nil {
		t.Fatal(e)
	}
	var q verify.Pass
	if e = json.Unmarshal(b, &q); e != nil || !q.Valid() || !q.Complete(cfg, expected, nil) {
		t.Fatalf("%+v %v", q, e)
	}
}

func TestPassWireRecords(t *testing.T) {
	for _, tc := range []struct{ model, wire string }{{"none", `"none"`}, {"not_run", `"not_run"`}, {"ok", `{"ok":[]}`}, {"failed", `{"failed":[]}`}} {
		for _, legacy := range []bool{false, true} {
			p := verify.Pass{N: 1, Clean: true, Tree: "tree", Model: verify.ModelResult{State: tc.model}, Legacy: legacy}
			b, e := json.Marshal(p)
			if e != nil {
				t.Fatal(e)
			}
			extra := `,"setup":[],"not_run":[]`
			if legacy {
				extra = ""
			}
			want := `{"n":1,"clean":true,"green":false,"tree":"tree","acceptance":"not_run","model":` + tc.wire + `,"checks":[],"moved":[],"failing":[]` + extra + `}`
			var got, expected any
			if json.Unmarshal(b, &got) != nil || json.Unmarshal([]byte(want), &expected) != nil || !reflect.DeepEqual(got, expected) {
				t.Fatalf("got %s want %s", b, want)
			}
			var q verify.Pass
			if e = json.Unmarshal(b, &q); e != nil || q.Legacy != legacy || q.Model.State != tc.model {
				t.Fatalf("%+v %v", q, e)
			}
		}
	}
}

// timeoutCommand reaps its child on group termination, also under an outer subreaper.
const timeoutCommand = "trap 'wait; exit 143' TERM; sleep 600 & wait"

func TestProbeCustodyAndResults(t *testing.T) {
	root := t.TempDir()
	s := sys.NewWith(os.Environ(), root)
	for _, tc := range []struct {
		cmd    string
		status int
		output string
	}{{"printf hello", 0, "hello"}, {"printf failure; exit 7", 7, "failure"}} {
		r, e := verify.RunProbe(context.Background(), s, root, tc.cmd, nil)
		if e != nil || r.Status != tc.status || r.Output != tc.output || r.TimedOut {
			t.Fatalf("%+v %v", r, e)
		}
	}
	var seen []verify.ProbeObservation
	production, restore := verify.ContractProbeDeadline(200*time.Millisecond, func(o verify.ProbeObservation) { seen = append(seen, o) })
	defer restore()
	if production != 5*time.Minute {
		t.Fatal(production)
	}
	r, e := verify.RunProbe(context.Background(), s, root, timeoutCommand, nil)
	if e != nil || !r.TimedOut || r.Status == 0 || len(seen) != 1 {
		t.Fatalf("%+v %v %+v", r, e, seen)
	}
	o := seen[0]
	if o.Command != timeoutCommand || o.Deadline != 200*time.Millisecond || o.Group <= 1 {
		t.Fatal(o)
	}
	if syscall.Kill(-o.Group, 0) == nil {
		t.Fatal("process group remains")
	}
	if _, e = os.Stat(o.Scratch); !os.IsNotExist(e) {
		t.Fatalf("scratch remains: %v", e)
	}
}

func TestToolsAndRunner(t *testing.T) {
	root := t.TempDir()
	tools := verify.ToolsFromInstall(root)
	if tools.Require() == nil {
		t.Fatal("missing bundled tools accepted")
	}
	node := filepath.Join(root, "fake-node")
	if e := os.WriteFile(node, []byte("#!/bin/sh\nexit 0\n"), 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(filepath.Join(root, "node-path"), []byte(node+"\n"), 0644); e != nil {
		t.Fatal(e)
	}
	if e := os.MkdirAll(filepath.Dir(tools.Quint), 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(tools.Quint, []byte("// synthetic"), 0644); e != nil {
		t.Fatal(e)
	}
	tools = verify.ToolsFromInstall(root)
	if tools.Node != node || tools.Require() != nil {
		t.Fatalf("installed tools: %+v", tools)
	}
	s := sys.NewWith(os.Environ(), root)
	for _, tc := range []struct{ cmd, reason, output string }{{`cat "$KOGEN_ACCEPTANCE_FEATURES"; echo '{}' > "$KOGEN_ACCEPTANCE_REPORT"`, "", "Feature: Kogen acceptance runner check\n"}, {"echo nope; exit 4", "the runner check failed with status 4", "nope\n"}, {"true", "the runner check wrote no report", ""}} {
		reason, out, e := verify.RunnerCheck(context.Background(), s, verify.Tools{}, root, tc.cmd)
		if e != nil || reason != tc.reason || out != tc.output {
			t.Fatalf("%q %q %v", reason, out, e)
		}
	}
	cfg := &project.Config{Acceptance: &project.Acceptance{Run: `echo '{}' > "$KOGEN_ACCEPTANCE_REPORT"`}, Checks: []project.Check{{Name: "x", Run: "definitely-not-a-tool"}}}
	if verify.RequireTools(s, verify.Tools{}, root, cfg, true) == nil {
		t.Fatal("missing tool accepted")
	}
	if e := verify.RequireRunner(context.Background(), s, verify.Tools{}, root, &project.Config{Acceptance: cfg.Acceptance}); e != nil {
		t.Fatal(e)
	}
}

func TestConsumerSurface(t *testing.T) {
	// Function values pin the consumer call signatures without starting a provider or model.
	var _ func(context.Context, *sys.Session, verify.Input) error = verify.Fix
	var _ func(context.Context, *sys.Session, verify.Input) (verify.Pass, error) = verify.Verify
	var _ func(*sys.Session, string, string, verify.Logger, func() (sys.Result, error)) (sys.Result, error) = verify.RunWatched
	var _ func(string, *project.Intent, []project.Scenario) ([]string, []string, []string) = verify.StepAnalysis
	var _ func(context.Context, string, string, string, []string, []string, []string) (verify.StepRaw, bool, error) = verify.RunStepScript
	_ = verify.Execute
	_ = verify.ContractProbeRun
	_ = verify.ContractShapeAcceptanceDeadline
	_ = verify.Input{Stage: &verify.Stage{ID: "s", Checks: []string{"true"}}}
	_ = verify.ProbeFile{Path: "x", Content: "y"}
	_ = verify.ProbeFileError{}
	_ = verify.Readiness{}
	_ = verify.Ready{}
	var _ verify.Evidence
	if _, err := verify.Declarations(&project.Intent{}); err != nil {
		t.Fatal(err)
	}
	r := verify.NewRedactor(nil, "")
	a := verify.NewAttempt(t.TempDir(), "k", r)
	if a == nil {
		t.Fatal("nil attempt")
	}
	if got := verify.NotRunNotice([]string{"a", "b"}); !strings.Contains(got, "a, b") {
		t.Fatal(got)
	}
}

func TestDeclaredEvidenceRetained(t *testing.T) {
	root := t.TempDir()
	if e := os.WriteFile(root+"/route.cjs", []byte("route bytes\n"), 0644); e != nil {
		t.Fatal(e)
	}
	s := sys.NewWith(os.Environ(), root)
	for _, tc := range []struct {
		name, command, output string
		exit                  int
		ok, timed             bool
	}{{"match", "cat route.cjs; exit 23", "route bytes\n", 23, true, false}, {"mismatch", "printf wrong", "expected", 0, false, false}, {"timeout", timeoutCommand, "", 0, false, true}} {
		t.Run(tc.name, func(t *testing.T) {
			declaration := verify.Declaration{ID: "route", Kind: "capability", Inputs: []string{"route.cjs"}, Observers: []string{}, Checks: []verify.DeclaredCheck{{Name: "support", Command: tc.command, Exit: tc.exit, Output: tc.output}}}
			b, e := json.Marshal(declaration)
			if e != nil {
				t.Fatal(e)
			}
			intent := &project.Intent{Slug: tc.name, Feasibility: []string{"- evidence: " + string(b)}}
			_, restore := verify.ContractProbeDeadline(200*time.Millisecond, nil)
			defer restore()
			got, e := verify.Execute(context.Background(), s, verify.Tools{}, root, intent, root, nil)
			if (e == nil) != tc.ok {
				t.Fatalf("%+v %v", got, e)
			}
			record, e := os.ReadFile(root + "/.kogen/local/readiness/" + tc.name + "-feasibility.ndjson")
			if e != nil {
				t.Fatal(e)
			}
			var obs []verify.Obligation
			if e = json.Unmarshal(record, &obs); e != nil || len(obs) != 1 || len(obs[0].Checks) != 1 {
				t.Fatalf("%s %v", record, e)
			}
			c := obs[0].Checks[0]
			if c.TimedOut != tc.timed || c.Command != tc.command {
				t.Fatalf("%+v", c)
			}
			if tc.ok && (c.Exit != 23 || c.Output != "route bytes\n" || !verify.Valid(root, intent, got)) {
				t.Fatalf("%+v", got)
			}
		})
	}
}

func TestConsumerResultRecords(t *testing.T) {
	for _, tc := range []struct {
		value any
		want  string
	}{
		{verify.ProbeResult{Status: 7, TimedOut: true, Output: "failure", Wall: 1, InputChanges: []string{"route.cjs"}}, `{"status":7,"timed_out":true,"output":"failure","wall":1,"input_changes":["route.cjs"]}`},
		{verify.ProbeResult{Status: 0, Output: "hello"}, `{"status":0,"timed_out":false,"output":"hello","wall":0}`},
	} {
		b, err := json.Marshal(tc.value)
		if err != nil {
			t.Fatal(err)
		}
		var got, want any
		if json.Unmarshal(b, &got) != nil || json.Unmarshal([]byte(tc.want), &want) != nil || !reflect.DeepEqual(got, want) {
			t.Fatalf("got %s want %s", b, tc.want)
		}
	}
	if verify.Diagnostic("failure output\n") != "failure output" || verify.Cap("hello") != "hello" {
		t.Fatal("diagnostic/output changed")
	}
}

func TestEnvironmentFailureAndPassFeedback(t *testing.T) {
	for _, tc := range []struct {
		r    verify.CommandResult
		want string
	}{{verify.CommandResult{Status: 1, Output: "ok\n  panic: test timed out after 10m0s\nFAIL\n"}, "panic: test timed out after 10m0s"}, {verify.CommandResult{Status: 1, Output: "--- FAIL: TestApp\n"}, ""}, {verify.CommandResult{Status: 0, Output: "panic: test timed out after 1s"}, ""}} {
		got, ok := verify.EnvFailure(tc.r)
		if got != tc.want || ok != (tc.want != "") {
			t.Fatalf("%q %v", got, ok)
		}
	}
	p := complete()
	p.Green = false
	p.Checks[1].Status = 1
	p.Checks[1].Output = "failure output"
	p.NotRun = []string{"later"}
	text := p.Feedback("runner", "finish")
	for _, want := range []string{"a-last", "failure output", "later"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q: %s", want, text)
		}
	}
}

func TestReadinessRecordAndIdentity(t *testing.T) {
	root := t.TempDir()
	if e := verify.CopyTree("../verify/testdata/readiness-simple", root); e != nil {
		t.Fatal(e)
	}
	env := append(os.Environ(), "GIT_AUTHOR_DATE=2026-01-01T00:00:00Z", "GIT_COMMITTER_DATE=2026-01-01T00:00:00Z", "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid")
	for _, args := range [][]string{{"init", "-q"}, {"config", "commit.gpgsign", "false"}, {"config", "core.hooksPath", t.TempDir()}, {"add", "-A"}, {"commit", "-qm", "baseline", "--no-verify"}} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		cmd.Env = env
		if b, e := cmd.CombinedOutput(); e != nil {
			t.Fatalf("git %v: %v %s", args, e, b)
		}
	}
	cfg, e := project.LoadConfig(root)
	if e != nil {
		t.Fatal(e)
	}
	intent, scenarios, e := project.CheckIntent(root, "fixture", nil)
	if e != nil {
		t.Fatal(e)
	}
	ready := &verify.Ready{Intent: intent, Model: intent.Model, Head: "cf76389c534b622b53ffc386a51864551ab1dad6", CandidateTree: "6307078b1939625eeb38acd2da2c49e9963d637c", SHA256: "f6e3814bafd9a1bea693d23825c90b3837b74aa95167fc07cd888649b08428f7", Baseline: []string{".kogen/intents/fixture/intent.md", ".kogen/intents/fixture/acceptance.feature", "features/steps/fixture_steps.js", ".kogen/project.yaml", ".kogen/models.yaml"}, AcceptanceExit: 1}
	for i, scenario := range scenarios {
		sr := verify.ScenarioRecord(scenario)
		sr.UnexercisedSteps = []verify.StepRecord{}
		sr.Status = "passed"
		if i == 0 {
			sr.Status = "failed"
			detail := "acceptance.feature line 3: Then the candidate succeeds\nboom"
			sr.Detail, sr.Phase = &detail, "assertion"
		}
		ready.Scenarios = append(ready.Scenarios, sr)
	}
	r := &verify.Readiness{Root: root, Config: cfg}
	session := sys.NewWith(env, root)
	if !r.Current(session, "fixture", ready) {
		t.Fatal("identity not current")
	}
	if e = r.RecordPass(session, "fixture", ready); e != nil {
		t.Fatal(e)
	}
	b, e := os.ReadFile(root + "/.kogen/local/readiness/fixture.json")
	if e != nil {
		t.Fatal(e)
	}
	var rec map[string]any
	if e = json.Unmarshal(b, &rec); e != nil {
		t.Fatal(e)
	}
	if rec["outcome"] != "ready" || rec["acceptance_exit"] != float64(1) || rec["sha256"] != ready.SHA256 {
		t.Fatalf("%s", b)
	}
	obs := verify.Observations("fixture", ready, "")
	for _, text := range []string{"Acceptance exit: 1", "boom", ".kogen/local/readiness/fixture.json"} {
		if !strings.Contains(obs, text) {
			t.Fatalf("missing %q: %s", text, obs)
		}
	}
	if !strings.Contains(verify.Acknowledgment("fixture", ready, ""), obs) {
		t.Fatal("acknowledgment lost observations")
	}
	cached := r.Cached(session, "fixture")
	if cached == nil || !r.Current(session, "fixture", cached) || len(cached.Scenarios) != 2 || cached.Scenarios[0].Status != "failed" {
		t.Fatalf("%+v", cached)
	}
	if e = os.WriteFile(root+"/app.txt", []byte("changed\n"), 0644); e != nil {
		t.Fatal(e)
	}
	if r.Cached(session, "fixture") != nil || r.Current(session, "fixture", cached) {
		t.Fatal("changed candidate reused")
	}
	// A build stage executes fixers in the checkout and checks in the candidate.
	headCmd := exec.Command("git", "rev-parse", "HEAD")
	headCmd.Dir = root
	head, e := headCmd.Output()
	if e != nil {
		t.Fatal(e)
	}
	buildCfg := &project.Config{Fix: []string{"printf fixed > fixed.txt"}}
	in := verify.Input{Root: root, Start: strings.TrimSpace(string(head)), Config: buildCfg, N: 1, Stage: &verify.Stage{ID: "local", Checks: []string{"cat fixed.txt; printf ' check'"}}}
	if e = verify.Fix(context.Background(), session, in); e != nil {
		t.Fatal(e)
	}
	pass, e := verify.Verify(context.Background(), session, in)
	if e != nil || len(pass.Checks) != 1 || pass.Checks[0].Status != 0 || pass.Checks[0].Output != "fixed check" {
		t.Fatalf("stage: %+v %v", pass, e)
	}
}

func TestProbeOverlayAndInterrupt(t *testing.T) {
	root := t.TempDir()
	s := sys.NewWith(os.Environ(), root)
	p := verify.Probe{Root: root, Command: "cat input", Files: []verify.ProbeFile{{Path: "input", Content: "synthetic"}}}
	result, e := p.Run(context.Background(), s)
	if e != nil || result.Status != 0 || result.Output != "synthetic" {
		t.Fatalf("%+v %v", result, e)
	}
	if _, e = os.Stat(root + "/input"); !os.IsNotExist(e) {
		t.Fatal("overlay leaked", e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	restore := verify.ContractProbeRun(func(_ *sys.Session, _, _ string, o sys.Options) (sys.Result, error) {
		if o.Context != ctx || o.Timeout != 5*time.Minute {
			t.Errorf("options %+v", o)
		}
		cancel()
		return sys.Result{}, ctx.Err()
	})
	defer restore()
	result, e = verify.RunProbe(ctx, s, root, "sleep 600", nil)
	if !errors.Is(e, context.Canceled) || result.TimedOut {
		t.Fatalf("%+v %v", result, e)
	}
}
