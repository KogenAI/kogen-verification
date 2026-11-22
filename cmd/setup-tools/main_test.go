package main

import (
	"bytes"
	"os"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/KogenAI/kogen-verification/testdata/tools"
)

// inTempDir makes a fresh working directory the current one, with a fake npm that touches a marker
// first on PATH. It returns the marker path.
func inTempDir(t *testing.T) string {
	t.Helper()
	work := t.TempDir()
	t.Chdir(work)
	marker := filepath.Join(work, "npm-called")
	bin := t.TempDir()
	script := "#!/bin/sh\ntouch '" + marker + "'\n"
	if err := os.WriteFile(filepath.Join(bin, "npm"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	return marker
}

func TestRunRejectsNonRegularPinnedTarget(t *testing.T) {
	makeDir := func(p string) error { return os.Mkdir(p, 0o755) }
	makeFifo := func(p string) error { return syscall.Mkfifo(p, 0o644) }
	cases := []struct {
		name   string
		target string
		make   func(string) error
	}{
		{"directory at cucumber package.json", "testdata/tools/cucumber/package.json", makeDir},
		{"directory at cucumber package-lock.json", "testdata/tools/cucumber/package-lock.json", makeDir},
		{"directory at quint package.json", "testdata/tools/quint/package.json", makeDir},
		{"fifo at cucumber package-lock.json", "testdata/tools/cucumber/package-lock.json", makeFifo},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			marker := inTempDir(t)
			target := filepath.FromSlash(c.target)
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := c.make(target); err != nil {
				t.Fatal(err)
			}
			err := run()
			if err == nil {
				t.Fatalf("run() succeeded although %s is not a regular file", target)
			}
			if !strings.Contains(err.Error(), target) {
				t.Errorf("error %q does not name %s", err, target)
			}
			if !strings.HasPrefix(err.Error(), "setup-tools: ") {
				t.Errorf("error %q lacks the setup-tools prefix", err)
			}
			if _, statErr := os.Stat(marker); statErr == nil {
				t.Error("npm was invoked although a pinned manifest is not a regular file")
			}
			info, statErr := os.Lstat(target)
			if statErr != nil {
				t.Fatal(statErr)
			}
			if info.Mode().IsRegular() {
				t.Errorf("%s was replaced by a regular file", target)
			}
		})
	}
}

func TestWriteMissingKeepsExistingAndCopiesAbsent(t *testing.T) {
	cases := []struct{ tool, existing, absent string }{
		{"quint", "package.json", "package-lock.json"},
		{"cucumber", "package-lock.json", "package.json"},
	}
	for _, c := range cases {
		t.Run(c.tool, func(t *testing.T) {
			inTempDir(t)
			dir := filepath.Join("testdata", "tools", c.tool)
			if err := os.MkdirAll(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			existing := filepath.Join(dir, c.existing)
			if err := os.WriteFile(existing, []byte("custom manifest"), 0o644); err != nil {
				t.Fatal(err)
			}
			if err := writeMissing(c.tool); err != nil {
				t.Fatal(err)
			}
			got, err := os.ReadFile(existing)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != "custom manifest" {
				t.Errorf("existing %s was changed to %q", existing, got)
			}
			want, err := tools.Files.ReadFile(path.Join(c.tool, c.absent))
			if err != nil {
				t.Fatal(err)
			}
			copied, err := os.ReadFile(filepath.Join(dir, c.absent))
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(copied, want) {
				t.Errorf("copied %s differs from the pinned file", c.absent)
			}
		})
	}
}
