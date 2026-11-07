package prereq

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// recorder is a testing.TB that records Fatal instead of stopping the goroutine.
type recorder struct {
	testing.TB
	message string
	failed  bool
}

func (r *recorder) Helper() {}

func (r *recorder) Fatal(args ...any) {
	r.failed = true
	var parts []string
	for _, a := range args {
		parts = append(parts, a.(string))
	}
	r.message = strings.Join(parts, " ")
}

func standIn(t *testing.T, modules string) {
	t.Helper()
	bin := filepath.Join(modules, "@cucumber", "cucumber", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "cucumber.js"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
}

func chdir(t *testing.T, dir string) {
	t.Helper()
	t.Chdir(dir)
}

func moduleWithSubfolder(t *testing.T) (root, sub string) {
	t.Helper()
	root = t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module m\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	sub = filepath.Join(root, "pkg", "deep")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	return root, sub
}

func TestCucumberMissingMessage(t *testing.T) {
	want := "missing prerequisite: Cucumber is not installed; run the setup command: go run github.com/KogenAI/kogen-verification/cmd/setup-tools"
	if CucumberMissing != want {
		t.Fatalf("CucumberMissing = %q", CucumberMissing)
	}
}

func TestCucumberFindsKogenCucumberFirst(t *testing.T) {
	root, sub := moduleWithSubfolder(t)
	standIn(t, filepath.Join(root, "testdata", "tools", "cucumber", "node_modules"))
	env := t.TempDir()
	standIn(t, env)
	t.Setenv("KOGEN_CUCUMBER", env)
	chdir(t, sub)
	if got := Cucumber(t); got != env {
		t.Fatalf("Cucumber = %q, want %q", got, env)
	}
}

func TestCucumberFindsTheModuleInstallAboveTheWorkingDirectory(t *testing.T) {
	root, sub := moduleWithSubfolder(t)
	modules := filepath.Join(root, "testdata", "tools", "cucumber", "node_modules")
	standIn(t, modules)
	t.Setenv("KOGEN_CUCUMBER", "")
	chdir(t, sub)
	if got := Cucumber(t); got != modules {
		t.Fatalf("Cucumber = %q, want %q", got, modules)
	}
}

func TestCucumberIgnoresAKogenCucumberFolderWithoutCucumber(t *testing.T) {
	root, sub := moduleWithSubfolder(t)
	modules := filepath.Join(root, "testdata", "tools", "cucumber", "node_modules")
	standIn(t, modules)
	t.Setenv("KOGEN_CUCUMBER", t.TempDir())
	chdir(t, sub)
	if got := Cucumber(t); got != modules {
		t.Fatalf("Cucumber = %q, want %q", got, modules)
	}
}

func TestCucumberFailsWithTheOneMessageWhenNothingHoldsIt(t *testing.T) {
	_, sub := moduleWithSubfolder(t)
	t.Setenv("KOGEN_CUCUMBER", t.TempDir())
	chdir(t, sub)
	r := &recorder{TB: t}
	Cucumber(r)
	if !r.failed || r.message != CucumberMissing {
		t.Fatalf("failed = %v, message = %q; want the message %q", r.failed, r.message, CucumberMissing)
	}
}
