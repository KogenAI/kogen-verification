package verify

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestProbeGitMetadataIsolation(t *testing.T) {
	root := t.TempDir()
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %s: %v", args, out, err)
		}
		return string(out)
	}
	git("init", "-q")
	git("config", "probe.sentinel", "original")
	for _, tc := range []struct {
		name, command string
		status        int
	}{
		{"failure", "git status --short", 128},
		{"handled", "git status --short; exit 0", 0},
		{"writes", "touch scratch-only; git config probe.sentinel changed; git status --short", 128},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, err := RunProbe(context.Background(), sessionFor(root), root, tc.command, nil)
			if err != nil || r.Status != tc.status || r.TimedOut {
				t.Fatalf("probe = %+v, err %v", r, err)
			}
			diagnostic := "fatal: not a git repository"
			if !strings.Contains(r.Output, diagnostic) || !strings.Contains(r.Output, "\nprobe copy has no git metadata:") || !strings.Contains(r.Output, "not evidence that the source project lacks a repository") {
				t.Fatalf("output = %q", r.Output)
			}
		})
	}
	if got := git("config", "--get", "probe.sentinel"); got != "original\n" {
		t.Fatalf("source config = %q", got)
	}
	if _, err := os.Stat(filepath.Join(root, "scratch-only")); !os.IsNotExist(err) {
		t.Fatalf("scratch file in source: %v", err)
	}
	r, err := RunProbe(context.Background(), sessionFor(root), root, "printf 'unchanged\\n'", nil)
	if err != nil || r.Status != 0 || r.TimedOut || r.Output != "unchanged\n" {
		t.Fatalf("probe = %+v, err %v", r, err)
	}
}

func TestProbeGitDiagnosticWithoutFinalNewline(t *testing.T) {
	root := t.TempDir()
	r, err := RunProbe(context.Background(), sessionFor(root), root, "printf 'fatal: not a git repository'", nil)
	if err != nil || r.Status != 0 || r.TimedOut || !strings.HasPrefix(r.Output, "fatal: not a git repository\nprobe copy has no git metadata:") {
		t.Fatalf("probe = %+v, err %v", r, err)
	}
}
