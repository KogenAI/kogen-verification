package kogencoordinator_test

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

func put(t *testing.T, root, path, text string) {
	t.Helper()
	p := filepath.Join(root, path)
	if e := os.MkdirAll(filepath.Dir(p), 0755); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(p, []byte(text), 0644); e != nil {
		t.Fatal(e)
	}
}
func repo(t *testing.T) (string, []string) {
	t.Helper()
	root := t.TempDir()
	for _, entry := range os.Environ() {
		key, value, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(key, "GIT_") {
			key, value := key, value
			if err := os.Unsetenv(key); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { os.Setenv(key, value) })
		}
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	t.Setenv("GIT_CONFIG_GLOBAL", filepath.Join(home, "config"))
	env := make([]string, 0)
	for _, v := range os.Environ() {
		if !strings.HasPrefix(v, "GIT_") {
			env = append(env, v)
		}
	}
	env = append(env, "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL="+filepath.Join(home, "config"), "GIT_AUTHOR_DATE=2026-01-01T00:00:00Z", "GIT_COMMITTER_DATE=2026-01-01T00:00:00Z", "GIT_AUTHOR_NAME=Fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid", "GIT_COMMITTER_NAME=Fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid")
	for _, args := range [][]string{{"init", "-q"}, {"config", "user.name", "Fixture"}, {"config", "user.email", "fixture@example.invalid"}} {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		cmd := exec.CommandContext(ctx, "git", args...)
		cmd.Dir = root
		cmd.Env = env
		b, e := cmd.CombinedOutput()
		cancel()
		if e != nil {
			t.Fatalf("%s %v", b, e)
		}
	}
	return root, env
}
func TestIntentBaselineFacts(t *testing.T) {
	root, _ := repo(t)
	feature := project.FeaturePath("demo")
	put(t, root, feature, "Feature: F\n  Scenario: s\n    Then it works\n")
	put(t, root, ".kogen/intents/demo/intent.md", "# Demo title\nSlug: demo\nModel: not applicable — display only\nAcceptance:\n- "+feature+"\n\nprose\n\n## Decisions\n\n- Do it (source: request)\n\n## Feasibility\n\n- none\n\n## Tests\n\n- rule: add a test (unit)\n")
	put(t, root, ".kogen/project.yaml", "commands: {}\n")
	in, sc, err := project.CheckIntent(root, "demo", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(in.Feasibility, []string{"- none"}) || in.Slug != "demo" || in.Title != "Demo title" || in.Model == nil || !in.Model.None || !reflect.DeepEqual(in.Acceptance, []string{feature}) || len(sc) != 1 || sc[0].Name != "s" || sc[0].Line != 2 || sc[0].Steps[0].Text != "it works" || sc[0].Steps[0].Keyword != "Then " || sc[0].Steps[0].Line != 3 || sc[0].Outline != nil {
		t.Fatalf("%+v %+v", in, sc)
	}
	put(t, root, ".kogen/intents/demo/model.qnt", "module demo { val Safe = true; val Other = true }\n")
	md, err := os.ReadFile(filepath.Join(root, ".kogen/intents/demo/intent.md"))
	if err != nil {
		t.Fatal(err)
	}
	modelMD := strings.Replace(string(md), "not applicable — display only", ".kogen/intents/demo/model.qnt invariants=Safe,Other seed=7 samples=40 steps=12", 1)
	modelIntent, _, err := project.CheckIntent(root, "demo", map[string][]byte{".kogen/intents/demo/intent.md": []byte(modelMD)})
	if err != nil {
		t.Fatalf("%+v", err.(*sys.Error).Lines)
	}
	m := modelIntent.Model
	if m == nil || m.Path != ".kogen/intents/demo/model.qnt" || !reflect.DeepEqual(m.Invariants, []string{"Safe", "Other"}) || m.Seed != "7" || m.Samples != "40" || m.Steps != "12" {
		t.Fatal(m)
	}
	cfg := &project.Config{}
	paths, err := project.Baseline(root, "demo", cfg)
	if err != nil || !slices.Contains(paths, feature) || !slices.Contains(paths, ".kogen/project.yaml") {
		t.Fatalf("%v %v", paths, err)
	}
	hash := project.Hash(root, paths)
	put(t, root, feature, "Feature: Changed\n  Scenario: s\n    Then it works\n")
	if project.Hash(root, paths) == hash {
		t.Fatal("hash did not change")
	}
	hash = project.Hash(root, paths)
	if err := project.WritePackageFacts(root, "demo", cfg); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(root, ".kogen/local/packages/demo.json"))
	if err != nil {
		t.Fatal(err)
	}
	var facts struct {
		Paths []string `json:"paths"`
		SHA   string   `json:"sha256"`
		State string   `json:"package_state"`
		ID    string   `json:"checkout_id"`
	}
	if err := json.Unmarshal(b, &facts); err != nil || facts.SHA != hash || facts.State != "valid" || len(facts.ID) != 64 || !slices.Contains(facts.Paths, feature) {
		t.Fatalf("%s %v", b, err)
	}
	b, err = project.EncodeJSON(map[string]any{"z": "<x>", "a": 1})
	if err != nil || string(b) != `{"a":1,"z":"<x>"}` {
		t.Fatalf("%s %v", b, err)
	}
}
func TestGherkinAndConfig(t *testing.T) {
	sc, err := project.ParseGherkin("@tag\nFeature: F\n  Scenario Outline: item <x>\n    Then see <x>\n    Examples:\n      | x |\n      | one |\n")
	if err != nil || len(sc) != 1 || sc[0].Name != "item one" || sc[0].Line != 7 || sc[0].Steps[0].Text != "see one" || !slices.Contains(sc[0].Tags, "@tag") || sc[0].Outline == nil || *sc[0].Outline != (project.Outline{Name: "item <x>", Line: 3, Examples: 1}) || sc[0].Steps[0].Line != 4 {
		t.Fatalf("%+v %v", sc, err)
	}
	if _, err := project.ParseGherkin("Feature: F\n  Scenario: x\n  Examples:\n"); err == nil {
		t.Fatal("invalid feature accepted")
	}
	intent := &project.Intent{Slug: "demo", Acceptance: []string{project.FeaturePath("demo"), "features/steps/demo.js", "helper.go"}}
	if !reflect.DeepEqual(intent.StepFiles(), []string{"features/steps/demo.js", "helper.go"}) {
		t.Fatal(intent.StepFiles())
	}
	cfg := &project.Config{Setup: []string{"setup"}, Fix: []string{"fix"}, Checks: []project.Check{{Name: "test", Run: "go test"}}, Acceptance: &project.Acceptance{Run: "cucumber", StepsDir: "features/steps"}}
	if !cfg.AcceptanceConfigured() || !reflect.DeepEqual(cfg.NamedCommands(), []project.NamedCommand{{Name: "setup-1", Run: "setup"}, {Name: "fix-1", Run: "fix"}, {Name: "test", Run: "go test"}, {Name: "acceptance", Run: "cucumber"}}) {
		t.Fatal(cfg.NamedCommands())
	}
}
func TestCandidateMaterialization(t *testing.T) {
	root, env := repo(t)
	put(t, root, "file", "original\n")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", "add", "file")
	cmd.Dir = root
	cmd.Env = env
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("%s %v", b, e)
	}
	cmd = exec.CommandContext(ctx, "git", "commit", "-qm", "fixture")
	cmd.Dir = root
	cmd.Env = env
	if b, e := cmd.CombinedOutput(); e != nil {
		t.Fatalf("%s %v", b, e)
	}
	r := git.New(root, env)
	head := r.Head()
	if head == "" {
		t.Fatal("empty head")
	}
	put(t, root, "file", "candidate\n")
	put(t, root, "new", "new\n")
	tree, err := r.Tree(head, nil)
	if err != nil {
		t.Fatal(err)
	}
	scratch := filepath.Join(t.TempDir(), "scratch")
	mat, err := r.Materialize(tree, scratch)
	if err != nil {
		t.Fatal(err)
	}
	for p, want := range map[string]string{"file": "candidate\n", "new": "new\n"} {
		b, e := os.ReadFile(filepath.Join(mat.Dir, p))
		if e != nil || string(b) != want {
			t.Fatalf("%s %s %v", p, b, e)
		}
	}
	changed, err := mat.Mutations()
	if err != nil || len(changed) != 0 {
		t.Fatalf("%v %v", changed, err)
	}
	put(t, scratch, "file", "modified\n")
	changed, err = mat.Mutations()
	if err != nil || !slices.Contains(changed, "file") {
		t.Fatalf("%v %v", changed, err)
	}
	put(t, root, "new", "later\n")
	later, err := r.Tree(head, nil)
	if err != nil {
		t.Fatal(err)
	}
	changed, err = r.Changed(tree, later)
	if err != nil || !reflect.DeepEqual(changed, []string{"new"}) {
		t.Fatalf("%v %v", changed, err)
	}
}
