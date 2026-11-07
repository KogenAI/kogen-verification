package verify

import (
	"context"
	"encoding/json"
	"errors"
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

func (p *proj) setFeasibility(ds ...Declaration) {
	p.t.Helper()
	lines := make([]string, len(ds))
	for i, d := range ds {
		lines[i] = "- evidence: " + encode(d)
	}
	writeIntent(p.fixture, "not applicable — nothing to model", strings.Join(lines, "\n"))
	intent, _, err := project.CheckIntent(p.Root, fixtureSlug, nil)
	if err != nil {
		p.t.Fatal(err)
	}
	p.Intent = intent
}

func capability(id, command string, exit int, output string, inputs ...string) Declaration {
	return Declaration{ID: id, Kind: "capability", Inputs: inputs, Observers: []string{},
		Checks: []DeclaredCheck{{Name: "support", Command: command, Exit: exit, Output: output}}}
}

func (p *proj) retained() []map[string]any {
	b, err := os.ReadFile(filepath.Join(p.Root, ".kogen/local/readiness/"+fixtureSlug+"-feasibility.ndjson"))
	if err != nil {
		return nil
	}
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		var rec []any
		if err := json.Unmarshal([]byte(line), &rec); err != nil {
			p.t.Fatal(err)
		}
		for _, o := range rec {
			out = append(out, o.(map[string]any))
		}
	}
	return out
}

func TestExecuteRunsDeclaredChecksInAProbeCopyAndRetainsTheActualOutcome(t *testing.T) {
	tmp := isolateTmp(t)
	p := newProj(t)
	p.write("route.cjs", "route bytes\n")
	d := capability("route", "cat route.cjs; echo extra >> route.log; exit 23", 23, "route bytes\n", "route.cjs")
	p.setFeasibility(d)
	ev := newEvidence()
	s, _ := p.session()
	got, err := Execute(context.Background(), s, Tools{}, p.Root, p.Intent, p.Root, ev)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != "route" || got[0].Checks[0].Exit != 23 || got[0].Checks[0].TimedOut || got[0].Inputs["route.cjs"] != sha("route bytes\n") {
		t.Fatalf("obligations = %s", encode(got))
	}
	if !Valid(p.Root, p.Intent, got) {
		t.Fatal("the executed evidence is valid proof")
	}
	eq(t, "probes", ev.probes, 1)
	eq(t, "recorded events", len(ev.events), 1)
	eq(t, "event", ev.events[0]["event"].(string), "feasibility_check")
	// The obligation of the event is its identity (no checks); the check is the actual outcome.
	obligation := ev.events[0]["obligation"].(map[string]any)
	eq(t, "obligation keys", len(obligation), 4)
	eq(t, "obligation inputs", obligation["inputs"].(map[string]any)["route.cjs"].(string), sha("route bytes\n"))
	check := ev.events[0]["check"].(map[string]any)
	eq(t, "check name", check["name"].(string), "support")
	eq(t, "check timed_out", check["timed_out"].(bool), false)
	eq(t, "retained", len(p.retained()), 1)
	// The probe ran in a copy: nothing leaked into the checkout, nothing is left in /tmp.
	if fileExists(filepath.Join(p.Root, "route.log")) {
		t.Fatal("the probe wrote into the checkout")
	}
	requireNoLeftovers(t, tmp)
	// Every execution appends one line.
	if _, err := Execute(context.Background(), s, Tools{}, p.Root, p.Intent, p.Root, nil); err != nil {
		t.Fatal(err)
	}
	eq(t, "retained after two runs", len(p.retained()), 2)
}

// ExUnit: readiness_observations_test.exs, replacement bytes inside the disposable probe.
func TestDeclaredChecksCannotQualifyReplacementBytesInsideTheirDisposableProbe(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	observer := "features/steps/observed_steps.js"
	source := "reject submitted bytes\n"
	input := "control.txt"
	p.write(input, source)
	p.write(observer, "observer bytes\n")
	for _, path := range []string{observer, input} {
		d := Declaration{ID: "final-bytes", Kind: "capability", Inputs: []string{observer, input}, Observers: []string{},
			Checks: []DeclaredCheck{{Name: "support", Command: "printf 'replacement\\n' > " + path + "; printf 'accepted\\n'", Exit: 0, Output: "accepted\n"}}}
		p.setFeasibility(d)
		observerBytes := p.read(observer)
		s, _ := p.session()
		_, err := Execute(context.Background(), s, Tools{}, p.Root, p.Intent, p.Root, nil)
		e := failWith(t, err, "intent", "not_ready")
		eq(t, "detail", e.Detail, "declared feasibility evidence failed")
		joined := strings.Join(e.Lines, "\n")
		contains(t, "lines", joined, "final-bytes/support")
		contains(t, "lines", joined, path)
		contains(t, "lines", joined, `"input_changes":["`+path+`"]`)
		var found bool
		for _, r := range p.retained() {
			if strings.Contains(encode(r), "accepted") {
				found = true
			}
		}
		if !found {
			t.Fatal("the actual outcome is retained")
		}
		eq(t, "input", p.read(input), source)
		eq(t, "observer", p.read(observer), observerBytes)
	}
}

// ExUnit: readiness_observations_test.exs, feedback bounded across obligations.
func TestFeasibilityFeedbackIsBoundedAcrossObligationsWhileFullFailuresRemainInspectable(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.write("app.txt", "x")
	cmd := `yes é | head -n 10000 | tr -d '\n'`
	p.setFeasibility(capability("first-control", cmd, 0, "supported\n", "app.txt"), capability("last-control", cmd, 0, "supported\n", "app.txt"))
	s, _ := p.session()
	_, err := Execute(context.Background(), s, Tools{}, p.Root, p.Intent, p.Root, nil)
	e := failWith(t, err, "intent", "not_ready")
	text := e.Render()
	if !utf8.ValidString(text) || len(text) >= 17000 {
		t.Fatalf("feedback: %d bytes, valid %v", len(text), utf8.ValidString(text))
	}
	contains(t, "feedback", text, "first-control/support")
	contains(t, "feedback", text, "bytes omitted")
	retained := p.retained()
	eq(t, "retained obligations", len(retained), 2)
	for i, id := range []string{"first-control", "last-control"} {
		eq(t, "id", retained[i]["id"].(string), id)
		eq(t, "full output kept", retained[i]["checks"].([]any)[0].(map[string]any)["output"].(string), strings.Repeat("é", 10000))
	}
	if fileExists(readinessPath(p.Root, fixtureSlug)) {
		t.Fatal("no readiness record for failed evidence")
	}
}

func TestReadinessRunsDeclaredEvidenceAndRecordsItsProof(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.write("route.cjs", "route bytes\n")
	p.setFeasibility(capability("route", "cat route.cjs", 0, "route bytes\n", "route.cjs"))
	p.commit("evidence")
	r := p.readiness()
	log := &memLog{}
	r.Log = log
	s, _ := p.session()
	ready, err := r.Check(context.Background(), s, fixtureSlug)
	if err != nil {
		t.Fatal(err)
	}
	events := log.named("step_sweep")
	probes := 0
	for _, event := range events {
		if event["name"] == "probe" {
			probes++
		}
	}
	if probes != 1 {
		t.Fatalf("probe sweep events: %+v", events)
	}
	eq(t, "obligations", len(ready.Feasibility), 1)
	rec, _ := p.readinessRecord()
	if feas := rec["feasibility"].([]any); len(feas) != 1 || feas[0].(map[string]any)["id"] != "route" {
		t.Fatalf("record = %v", rec)
	}
	if r.Cached(s, fixtureSlug) == nil {
		t.Fatal("evidence with proof is reusable")
	}
	// A declaration whose check no longer holds is not ready, and the record is gone.
	p.setFeasibility(capability("route", "cat route.cjs", 0, "other\n", "route.cjs"))
	_, err = r.Check(context.Background(), s, fixtureSlug)
	e := failWith(t, err, "intent", "not_ready")
	eq(t, "detail", e.Detail, "declared feasibility evidence failed")
	if fileExists(readinessPath(p.Root, fixtureSlug)) {
		t.Fatal("record must be gone")
	}
}

func TestCopyTreeKeepsIgnoredFilesAndLeavesOutGitAndLocalState(t *testing.T) {
	p := newProj(t)
	p.write("build/out.txt", "ignored output")
	p.write(".kogen/local/runs/x/log", "local")
	p.write("node_modules/dep/index.js", "dep")
	scratch := filepath.Join(t.TempDir(), "copy")
	os.MkdirAll(scratch, 0o755)
	if err := CopyTree(p.Root, scratch); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"app.txt", "build/out.txt", "node_modules/dep/index.js", ".kogen/project.yaml", ".kogen/intents/fixture/intent.md", ".gitignore"} {
		if !fileExists(filepath.Join(scratch, want)) {
			t.Errorf("copy lacks %s", want)
		}
	}
	for _, not := range []string{".git", ".kogen/local"} {
		if fileExists(filepath.Join(scratch, not)) {
			t.Errorf("copy has %s", not)
		}
	}
}

func TestRunProbeReportsStatusOutputWallAndInputChanges(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.write("a.txt", "a")
	s, _ := p.session()
	r, err := RunProbe(context.Background(), s, p.Root, "echo out; echo err >&2; printf b > a.txt; exit 5", map[string]string{"a.txt": sha("a"), "missing.txt": sha("x")})
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "status", r.Status, 5)
	eq(t, "timed out", r.TimedOut, false)
	eq(t, "output", len(r.Output) == len("out\nerr\n") || strings.Contains(r.Output, "out"), true)
	eqSlice(t, "input changes", r.InputChanges, []string{"a.txt", "missing.txt"})
	eq(t, "checkout untouched", p.read("a.txt"), "a")
}

func TestReadinessInterruptStopsAndCleansUp(t *testing.T) {
	tmp := isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = []string{"touch '" + p.trace("started") + "'; sleep 30"}
	s, _ := p.session()
	go func() {
		for i := 0; i < 400; i++ {
			if fileExists(p.trace("started")) {
				s.Interrupt("SIGTERM")
				return
			}
			time.Sleep(25 * time.Millisecond)
		}
	}()
	_, err := p.readiness().Check(context.Background(), s, fixtureSlug)
	var intr *sys.Interrupted
	if !errors.As(err, &intr) || intr.Signal != "SIGTERM" {
		t.Fatalf("err = %v, want an interrupt", err)
	}
	requireNoLeftovers(t, tmp)
	if fileExists(readinessPath(p.Root, fixtureSlug)) {
		t.Fatal("no record after an interrupt")
	}
}

func TestProbeFilesStayInTheScratchCopyAndThePrepareStep(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	if err := os.Symlink("elsewhere", filepath.Join(p.Root, "link")); err != nil {
		t.Fatal(err)
	}
	p.write("blocker", "a file")
	s, _ := p.session()
	s.Env = append(s.Env, "KOGEN_FROM_CALLER=yes")
	pr := Probe{Root: p.Root, Command: `cat probe/new.txt app.txt; echo "$KOGEN_NODE $KOGEN_FROM_CALLER"`, Tools: Tools{Node: "/n/node"},
		Files: []ProbeFile{{Path: "probe/new.txt", Content: "overlay\n"}, {Path: "app.txt", Content: "replaced\n"}}}
	got, err := pr.Run(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "output", got.Output, "overlay\nreplaced\n/n/node \n")
	eq(t, "checkout untouched", p.read("app.txt"), "green\n")
	if fileExists(filepath.Join(p.Root, "probe")) {
		t.Fatal("the overlay leaked into the checkout")
	}
	for _, tc := range []struct {
		file    ProbeFile
		problem string
	}{
		{ProbeFile{Path: "../outside.txt"}, "../outside.txt is outside the scratch copy"},
		{ProbeFile{Path: "/etc/kogen-probe-test"}, "/etc/kogen-probe-test is outside the scratch copy"},
		{ProbeFile{Path: "link/x.txt"}, "link/x.txt would be written through a symlink"},
		{ProbeFile{Path: "blocker/x.txt"}, "blocker/x.txt: enotdir"},
		{ProbeFile{Path: ".kogen"}, ".kogen: eisdir"},
	} {
		_, err := Probe{Root: p.Root, Command: "true", Files: []ProbeFile{tc.file}}.Run(context.Background(), s)
		var fe *ProbeFileError
		if !errors.As(err, &fe) || len(fe.Problems) != 1 || fe.Problems[0] != tc.problem {
			t.Fatalf("%q: err = %v, want %q", tc.file.Path, err, tc.problem)
		}
		eq(t, "message", err.Error(), "error: "+tc.problem)
	}
	_, err = Probe{Root: p.Root, Command: "true", Files: []ProbeFile{{Path: "../a"}, {Path: "link/b"}}}.Run(context.Background(), s)
	eq(t, "all problems in one message", err.Error(), "error: ../a is outside the scratch copy; link/b would be written through a symlink")
}

// A probe runs in a session of its own whose environment is built by allowlist: the caller's
// credentials and credential-store paths never reach it, and its HOME is a private empty
// folder, not the caller's home.
func TestShapeProbeMinimalEnvironment(t *testing.T) {
	tmp := isolateTmp(t)
	p := newProj(t)
	callerHome := t.TempDir()
	store := filepath.Join(callerHome, ".kogen", "credentials")
	if err := os.MkdirAll(store, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(store, "chatgpt.json"), []byte(`{"token":"synthetic-saved-login"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	s := sys.NewWith(testEnv("HOME="+callerHome, "MISE_DATA_DIR=", "XDG_DATA_HOME=", "STUDIO_TOKEN=studio-secret", "OPENAI_API_KEY=openai-secret",
		"UNRELATED_SECRET=unrelated-secret", "KOGEN_CREDENTIALS_DIR="+store, "NODE_OPTIONS=--require=/x", "BASH_ENV=/x", "ENV=/x",
		"KOGEN_NODE=/caller/node", "LC_ALL=C", "LANG=C", "GOPATH=/fixture/gopath"), p.Root)
	before := slices.Clone(s.Env)
	pr := Probe{Root: p.Root, Tools: Tools{Node: "/n/node"},
		Command: `env; echo "HOME-LIST:"; ls -A "$HOME"; echo "HOME-IS:$HOME"; ls -A "$HOME/.kogen" 2>&1; echo "HOME-DIR:$(cd "$HOME" && pwd -P)"`}
	got, err := pr.Run(context.Background(), s)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"STUDIO_TOKEN", "studio-secret", "OPENAI_API_KEY", "openai-secret", "UNRELATED_SECRET", "unrelated-secret",
		"KOGEN_CREDENTIALS_DIR", store, "synthetic-saved-login", "chatgpt.json", "NODE_OPTIONS", "BASH_ENV", "ENV=/x", "/caller/node"} {
		if strings.Contains(got.Output, secret) {
			t.Errorf("probe output shows %q:\n%s", secret, got.Output)
		}
	}
	withoutMiseData := strings.ReplaceAll(got.Output, "MISE_DATA_DIR="+filepath.Join(callerHome, ".local/share/mise")+"\n", "")
	if strings.Contains(withoutMiseData, callerHome) {
		t.Errorf("probe output exposes caller home outside mise data: %s", got.Output)
	}
	for _, want := range []string{"KOGEN_NODE=/n/node\n", "LC_ALL=C\n", "LANG=C\n", "GOPATH=/fixture/gopath\n", "PATH=", "MISE_DATA_DIR=" + filepath.Join(callerHome, ".local/share/mise") + "\n", "HOME-LIST:\nHOME-IS:" + tmp + "/kogen-probe-home-"} {
		if !strings.Contains(got.Output, want) {
			t.Errorf("probe output lacks %q:\n%s", want, got.Output)
		}
	}
	eqSlice(t, "caller environment", s.Env, before)
	if !fileExists(filepath.Join(store, "chatgpt.json")) {
		t.Fatal("the caller's credential store changed")
	}
	requireNoLeftovers(t, tmp)

	// The probe trusts its own scratch copy, followed by the caller's trusted paths when it has any.
	const trustCommand = `echo "TRUST:$MISE_TRUSTED_CONFIG_PATHS"; echo "PWD:$(pwd)"; echo "RUNTMP:$TMPDIR"; echo "RUNTMP-LIST:$(ls -A "$TMPDIR" | wc -l | tr -d ' ')"; echo "HOME:$HOME"`
	for _, tc := range []struct{ name, caller, suffix string }{
		{"caller without the variable", "", ""},
		{"caller with an empty variable", "MISE_TRUSTED_CONFIG_PATHS=", ""},
		{"caller with the variable", "MISE_TRUSTED_CONFIG_PATHS=/caller/trusted:/other", ":/caller/trusted:/other"},
	} {
		env := []string{"HOME=" + callerHome}
		if tc.caller != "" {
			env = append(env, tc.caller)
		}
		got, err := Probe{Root: p.Root, Command: trustCommand}.Run(context.Background(), sys.NewWith(testEnv(env...), p.Root))
		if err != nil {
			t.Fatal(err)
		}
		var trust, pwd, runTmp, runTmpCount, home string
		for _, line := range strings.Split(got.Output, "\n") {
			if v, ok := strings.CutPrefix(line, "TRUST:"); ok {
				trust = v
			}
			if v, ok := strings.CutPrefix(line, "PWD:"); ok {
				pwd = v
			}
			if v, ok := strings.CutPrefix(line, "RUNTMP:"); ok {
				runTmp = v
			}
			if v, ok := strings.CutPrefix(line, "RUNTMP-LIST:"); ok {
				runTmpCount = v
			}
			if v, ok := strings.CutPrefix(line, "HOME:"); ok {
				home = v
			}
		}
		scratch := trust[:strings.Index(trust+":", ":")]
		if !strings.HasPrefix(scratch, tmp+"/kogen-probe-") || !strings.HasPrefix(runTmp, tmp+"/kogen-probe-tmp-") || trust != scratch+":"+runTmp+tc.suffix {
			t.Errorf("%s: MISE_TRUSTED_CONFIG_PATHS = %q, want the scratch copy, %q%s", tc.name, trust, runTmp, tc.suffix)
		}
		if runTmp == scratch || strings.HasPrefix(runTmp, scratch+"/") || runTmp == home || strings.HasPrefix(runTmp, home+"/") || runTmpCount != "0" {
			t.Errorf("%s: TMPDIR = %q (%s entries) is not a new empty directory apart from the scratch copy %q and HOME %q", tc.name, runTmp, runTmpCount, scratch, home)
		}
		if resolved, err := filepath.EvalSymlinks(scratch); err != nil && fileExists(scratch) || pwd != scratch && pwd != resolved {
			t.Errorf("%s: probe ran in %q, trusted %q", tc.name, pwd, scratch)
		}
	}
	requireNoLeftovers(t, tmp)
}

// A control the tool manager trusts only at the project's own location passes as a probe, in the
// probe's scratch copy, trusts nothing else, and still fails with its own status and output.
func TestProbeTrustsTheProjectToolConfigurationOfItsScratchCopy(t *testing.T) {
	tmp := isolateTmp(t)
	p := newProj(t)
	bin := t.TempDir()
	shim := `#!/bin/sh
trusted=no
old=$IFS; IFS=:
for dir in $MISE_TRUSTED_CONFIG_PATHS; do
  case "$PWD/" in "$dir"/*) trusted=yes ;; esac
done
IFS=$old
if [ ! -f .mise.toml ] || [ $trusted = no ]; then
  echo "mise ERROR Config files in $PWD/.mise.toml are not trusted."
  exit 1
fi
if [ "$1" = "--loud" ]; then
  echo "greet: unknown option --loud"
  exit 2
fi
echo "hello from the project tool"
`
	if err := os.WriteFile(filepath.Join(bin, "greet"), []byte(shim), 0o755); err != nil {
		t.Fatal(err)
	}
	p.write(".mise.toml", "[tools]\n")
	s := sys.NewWith(testEnv("PATH="+bin+":"+os.Getenv("PATH"), "MISE_TRUSTED_CONFIG_PATHS="+p.Root), p.Root)
	run := func(command string) ProbeResult {
		t.Helper()
		got, err := Probe{Root: p.Root, Command: command}.Run(context.Background(), s)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	if got := run("greet"); got.Status != 0 || got.Output != "hello from the project tool\n" {
		t.Fatalf("the control as a probe = %d %q", got.Status, got.Output)
	}
	if got := run("greet --loud"); got.Status != 2 || got.Output != "greet: unknown option --loud\n" {
		t.Fatalf("the failing control as a probe = %d %q", got.Status, got.Output)
	}
	// The caller trusts only the project, so a copy elsewhere stays untrusted and the probe
	// does not trust the filesystem root.
	elsewhere := t.TempDir()
	if err := os.WriteFile(filepath.Join(elsewhere, ".mise.toml"), []byte("[tools]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := run("cd '" + elsewhere + "' && greet"); got.Status != 1 || !strings.Contains(got.Output, "are not trusted.") {
		t.Fatalf("a control outside the scratch copy = %d %q", got.Status, got.Output)
	}
	// A control that makes a second temporary directory under TMPDIR and runs the tool in a copy
	// of the project there passes; a copy in the caller's temporary folder stays untrusted.
	const second = `d=$(mktemp -d "${TMPDIR:-/tmp}/second-tmp.XXXXXX") && cp .mise.toml "$d/" && cd "$d" && greet`
	if got := run(second); got.Status != 0 || got.Output != "hello from the project tool\n" {
		t.Fatalf("a control in a temporary directory it creates = %d %q", got.Status, got.Output)
	}
	if got := run(second + " --loud"); got.Status != 2 || got.Output != "greet: unknown option --loud\n" {
		t.Fatalf("the failing control in a temporary directory it creates = %d %q", got.Status, got.Output)
	}
	if got := run(`d=$(mktemp -d "` + tmp + `/caller-tmp.XXXXXX") && cp .mise.toml "$d/" && cd "$d" && greet`); got.Status != 1 || !strings.Contains(got.Output, "are not trusted.") {
		t.Fatalf("a control in the caller's temporary directory = %d %q", got.Status, got.Output)
	}

	p.setFeasibility(capability("greeting", "greet", 0, "hello from the project tool\n", ".mise.toml"))
	got, err := Execute(context.Background(), s, Tools{}, p.Root, p.Intent, p.Root, nil)
	if err != nil {
		t.Fatalf("the declared control passing in the project is met: %v", renderErr(err))
	}
	if len(got) != 1 || got[0].Checks[0].Exit != 0 {
		t.Fatalf("obligations = %s", encode(got))
	}
	p.setFeasibility(capability("greeting", second, 0, "hello from the project tool\n", ".mise.toml"))
	if _, err := Execute(context.Background(), s, Tools{}, p.Root, p.Intent, p.Root, nil); err != nil {
		t.Fatalf("the declared control in a temporary directory it creates is met: %v", renderErr(err))
	}
	p.setFeasibility(capability("greeting", "greet --loud", 0, "hello from the project tool\n", ".mise.toml"))
	_, err = Execute(context.Background(), s, Tools{}, p.Root, p.Intent, p.Root, nil)
	if e, ok := sys.AsError(err); !ok || !strings.Contains(e.Render(), "greeting/support") || !strings.Contains(e.Render(), "greet: unknown option --loud") {
		t.Fatalf("the refusal of a failing control = %v", err)
	}
	requireNoLeftovers(t, tmp)
}

// The private home is removed when the probe is refused or interrupted too.
func TestShapeProbeMinimalEnvironmentHomeIsRemovedOnEveryReturn(t *testing.T) {
	tmp := isolateTmp(t)
	p := newProj(t)
	s, _ := p.session()
	if _, err := (Probe{Root: p.Root, Command: "true", Files: []ProbeFile{{Path: "../a"}}}).Run(context.Background(), s); err == nil {
		t.Fatal("want a refusal")
	}
	requireNoLeftovers(t, tmp)
	go func() {
		for i := 0; i < 400; i++ {
			if len(leftovers(t, tmp, "kogen-probe-home-")) > 0 {
				time.Sleep(300 * time.Millisecond)
				s.Interrupt("SIGTERM")
				return
			}
			time.Sleep(25 * time.Millisecond)
		}
	}()
	_, err := (Probe{Root: p.Root, Command: "sleep 30"}).Run(context.Background(), s)
	var intr *sys.Interrupted
	if !errors.As(err, &intr) || intr.Signal != "SIGTERM" {
		t.Fatalf("err = %v, want the caller's interrupt", err)
	}
	requireNoLeftovers(t, tmp)
}

// A caller already interrupted must not launch even a quick probe command.
func TestProbeDoesNotStartAfterCallerInterrupt(t *testing.T) {
	tmp := isolateTmp(t)
	p := newProj(t)
	s, _ := p.session()
	s.Interrupt("SIGTERM")
	marker := filepath.Join(tmp, "started")
	_, err := (Probe{Root: p.Root, Command: "touch '" + marker + "'"}).Run(context.Background(), s)
	var intr *sys.Interrupted
	if !errors.As(err, &intr) || intr.Signal != "SIGTERM" {
		t.Fatalf("err = %v", err)
	}
	if fileExists(marker) {
		t.Fatal("probe started after interrupt")
	}
	requireNoLeftovers(t, tmp)
}

// A probe gets the caller's Mix home itself, and a private Hex home that links only the caller's
// package and registry caches, never hex.config. Homes come from MIX_HOME/HEX_HOME or from the
// caller's HOME; a caller without such a directory gives the probe none.
func TestShapeProbeMixAndHexHomes(t *testing.T) {
	const command = `echo "MIX_HOME:${MIX_HOME-unset}"; echo "HEX_HOME:${HEX_HOME-unset}"; echo "HOME-LIST:"; ls -A "$HOME"; echo "HEX-LIST:"; if test -n "${HEX_HOME-}"; then ls -A "$HEX_HOME"; fi; echo "HEX_API_KEY:${HEX_API_KEY-unset}"`
	writeHex := func(t *testing.T, hex string, entries ...string) {
		t.Helper()
		for _, e := range entries {
			path := filepath.Join(hex, e)
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte("synthetic "+e), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
	// the caller's Hex entries, relative to its Hex home, that must survive untouched
	callerFiles := []string{"packages/hexpm/dep-1.0.0.tar", "cache.bin", "hex.config"}
	cases := []struct {
		name     string
		explicit bool // homes named by MIX_HOME/HEX_HOME rather than <HOME>/.mix and .hex
		mix, hex bool // the caller's directory exists
		entries  []string
		refuse   bool
	}{
		{name: "explicit homes", explicit: true, mix: true, hex: true, entries: callerFiles},
		{name: "default homes", mix: true, hex: true, entries: callerFiles},
		{name: "only packages", explicit: true, mix: true, hex: true, entries: []string{"packages/hexpm/dep-1.0.0.tar", "hex.config"}},
		{name: "only the registry cache", mix: true, hex: true, entries: []string{"cache.bin", "hex.config"}},
		{name: "no entries to link", explicit: true, hex: true, entries: []string{"hex.config"}},
		{name: "explicit homes missing", explicit: true},
		{name: "default homes missing"},
		{name: "refused probe", explicit: true, mix: true, hex: true, entries: callerFiles, refuse: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tmp := isolateTmp(t)
			p := newProj(t)
			callerHome := t.TempDir()
			var mixDir, hexDir string
			env := []string{"HOME=" + callerHome, "HEX_API_KEY=hex-api-key-secret", "MIX_HOME=", "HEX_HOME=", "MIX_XDG=1"}
			if tc.explicit {
				mixDir, hexDir = filepath.Join(t.TempDir(), "mixhome"), filepath.Join(t.TempDir(), "hexhome")
				env = append(env, "MIX_HOME="+mixDir, "HEX_HOME="+hexDir)
			} else {
				mixDir, hexDir = filepath.Join(callerHome, ".mix"), filepath.Join(callerHome, ".hex")
			}
			if tc.mix {
				if err := os.MkdirAll(filepath.Join(mixDir, "archives"), 0o755); err != nil {
					t.Fatal(err)
				}
			}
			if tc.hex {
				writeHex(t, hexDir, tc.entries...)
			}
			s := sys.NewWith(testEnv(env...), p.Root)
			pr := Probe{Root: p.Root, Command: command}
			if tc.refuse {
				pr.Files = []ProbeFile{{Path: "../a"}}
				if _, err := pr.Run(context.Background(), s); err == nil {
					t.Fatal("want a refusal")
				}
				requireNoLeftovers(t, tmp)
				for _, e := range tc.entries {
					if !fileExists(filepath.Join(hexDir, e)) {
						t.Errorf("the caller's %s is gone", e)
					}
				}
				return
			}
			got, err := pr.Run(context.Background(), s)
			if err != nil {
				t.Fatal(err)
			}
			wantMix, wantHex, wantList := "unset", "unset", ""
			if tc.mix {
				wantMix = mixDir
			}
			if tc.hex {
				wantHex = "kogen-probe-hex-"
				for _, e := range []string{"cache.bin", "packages"} {
					for _, have := range tc.entries {
						if have == e || strings.HasPrefix(have, e+"/") {
							wantList += e + "\n"
							break
						}
					}
				}
			}
			contains(t, "output", got.Output, "MIX_HOME:"+wantMix+"\n")
			if tc.hex {
				contains(t, "output", got.Output, "HEX_HOME:"+tmp+"/"+wantHex)
			} else {
				contains(t, "output", got.Output, "HEX_HOME:unset\n")
			}
			contains(t, "output", got.Output, "HOME-LIST:\nHEX-LIST:\n"+wantList+"HEX_API_KEY:unset")
			if tc.hex && strings.Contains(got.Output, "hex.config") {
				t.Errorf("probe sees hex.config:\n%s", got.Output)
			}
			for _, e := range tc.entries {
				b, err := os.ReadFile(filepath.Join(hexDir, e))
				if err != nil || string(b) != "synthetic "+e {
					t.Errorf("the caller's %s changed: %q, %v", e, b, err)
				}
			}
			requireNoLeftovers(t, tmp)
		})
	}
}

func renderErr(err error) string {
	if e, ok := sys.AsError(err); ok {
		return e.Render()
	}
	return err.Error()
}

func TestDeclaredProbeEnvironmentMismatch(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.write("check.txt", "fixture")
	home := t.TempDir()
	mix := filepath.Join(home, "mix")
	hex := filepath.Join(home, "hex")
	for _, dir := range []string{mix, hex} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	const secret = "synthetic-credential-7f91"
	s := sys.NewWith([]string{"PATH=" + os.Getenv("PATH"), "HOME=" + home, "TMPDIR=/caller/tmp", "MIX_HOME=" + mix, "HEX_HOME=" + hex, "MISE_DATA_DIR=/caller/mise", "MISE_TRUSTED_CONFIG_PATHS=/caller/trusted", "KOGEN_NODE=/caller/node", "REPORTER=0", "SECRET_TOKEN_X=" + secret, "REPORTER=0"}, p.Root)
	cases := []struct {
		command, expected, actual string
		mismatch                  bool
	}{
		{`if [ "${REPORTER+x}" = x ]; then echo runs; else echo tests; fi`, "runs\n", "tests\n", true},
		{`if [ "${REPORTER+x}" = x ]; then echo runs; else echo tests; fi`, "tests\n", "tests\n", false},
		{`echo stable`, "stable\n", "stable\n", false},
		{`echo "${REPORTER:-unset}"`, "unset\n", "unset\n", false},
	}
	for _, tc := range cases {
		t.Run(tc.expected+tc.command, func(t *testing.T) {
			p.setFeasibility(capability("reporter", tc.command, 0, tc.expected, "check.txt"))
			ev := newEvidence()
			log := &memLog{}
			// Exercise the same executor with its real run logger enabled.
			_, err := execute(context.Background(), s, Tools{Node: "/tool/node"}, p.Root, p.Intent, p.Root, ev, false, log)
			text := ""
			if tc.mismatch {
				e := failWith(t, err, "intent", "not_ready")
				text = e.Render()
				contains(t, "diagnostic", text, "probes run under a restricted environment; caller variables omitted: REPORTER, SECRET_TOKEN_X")
				contains(t, "expected", text, `"output":"runs\n"`)
				contains(t, "actual", text, `"output":"tests\n"`)
			} else if err != nil {
				t.Fatal(err)
			}
			if len(log.events) == 0 {
				t.Fatal("probe run logs missing")
			}
			retained := p.retained()
			last := retained[len(retained)-1]
			got := last["checks"].([]any)[0].(map[string]any)["output"].(string)
			eq(t, "retained output", got, tc.actual)
			for _, value := range []string{text, encode(log.events), encode(ev.events), encode(last)} {
				if strings.Contains(value, secret) {
					t.Fatalf("credential disclosed: %s", value)
				}
			}
		})
	}
}

func TestDeclaredProbeExitMismatchHasNoEnvironmentExplanation(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.write("check.txt", "fixture")
	p.setFeasibility(capability("exit", "echo stable", 1, "stable\n", "check.txt"))
	s, _ := p.session()
	_, err := Execute(context.Background(), s, Tools{}, p.Root, p.Intent, p.Root, nil)
	e := failWith(t, err, "intent", "not_ready")
	if strings.Contains(e.Render(), "restricted environment") {
		t.Fatalf("unexpected environment explanation: %s", e.Render())
	}
}
