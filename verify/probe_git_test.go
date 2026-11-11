package verify

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const probeNoGitExplanation = "probe copy has no git metadata: scratch-copy isolation, not evidence that the source project lacks a repository"

// gitIn runs git in dir with a private HOME and returns its trimmed output.
func gitIn(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "HOME="+t.TempDir(), "GIT_CONFIG_NOSYSTEM=1",
		"GIT_AUTHOR_NAME=T", "GIT_AUTHOR_EMAIL=t@example.invalid", "GIT_COMMITTER_NAME=T", "GIT_COMMITTER_EMAIL=t@example.invalid")
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %s: %v", args, out, err)
	}
	return strings.TrimSpace(string(out))
}

func writeProjectFile(t *testing.T, root, name, content string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

// gitProject is a repository on branch main with one commit holding README.md and src/main.txt.
func gitProject(t *testing.T, extraInit ...string) string {
	t.Helper()
	root := t.TempDir()
	gitIn(t, root, append([]string{"init", "-q", "-b", "main"}, extraInit...)...)
	gitIn(t, root, "config", "probe.sentinel", "original")
	writeProjectFile(t, root, "README.md", "readme\n")
	writeProjectFile(t, root, "src/main.txt", "Usage: main [file]\n")
	gitIn(t, root, "add", "-A")
	gitIn(t, root, "commit", "-qm", "baseline")
	return root
}

func probeOf(t *testing.T, root, command string) ProbeResult {
	t.Helper()
	r, err := RunProbe(context.Background(), sessionFor(root), root, command, nil)
	if err != nil || r.TimedOut {
		t.Fatalf("probe %q = %+v, err %v", command, r, err)
	}
	return r
}

// snapshot is every file below root, .git included, with its mode and bytes.
func snapshot(t *testing.T, root string) map[string]string {
	t.Helper()
	snap := map[string]string{}
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		content := ""
		if info.Mode().IsRegular() {
			b, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			content = string(b)
		}
		snap[rel] = info.Mode().String() + "\x00" + content
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return snap
}

func TestProbeCopyReadsSourceHistory(t *testing.T) {
	t.Parallel()
	root := gitProject(t)
	first := gitIn(t, root, "rev-parse", "HEAD")
	writeProjectFile(t, root, "src/main.txt", "Usage: main --verbose\n")
	gitIn(t, root, "commit", "-qam", "second")
	head := gitIn(t, root, "rev-parse", "HEAD")
	r := probeOf(t, root, "git show "+first+":src/main.txt; git show HEAD:src/main.txt; git rev-parse --abbrev-ref HEAD; git rev-parse HEAD; git log --format=%s; git grep -n -w -F -e Usage HEAD")
	want := "Usage: main [file]\nUsage: main --verbose\nmain\n" + head + "\nsecond\nbaseline\nHEAD:src/main.txt:1:Usage: main --verbose\n"
	if r.Status != 0 || r.Output != want {
		t.Fatalf("probe = %+v, want output %q", r, want)
	}
}

func TestProbeCopyIndexIsHeadAndWorkingTreeAsCopied(t *testing.T) {
	t.Parallel()
	root := gitProject(t)
	writeProjectFile(t, root, "README.md", "changed\n")
	writeProjectFile(t, root, "staged.txt", "staged\n")
	gitIn(t, root, "add", "staged.txt")
	writeProjectFile(t, root, "shaped.txt", "shaped\n")
	r := probeOf(t, root, "git status --short; cat staged.txt")
	if want := " M README.md\n?? shaped.txt\n?? staged.txt\nstaged\n"; r.Status != 0 || r.Output != want {
		t.Fatalf("probe = %+v, want output %q", r, want)
	}
}

func TestProbeGitMetadataIsolation(t *testing.T) {
	t.Parallel()
	root := gitProject(t)
	hook := filepath.Join(root, ".git", "hooks", "post-commit")
	writeProjectFile(t, root, ".git/hooks/post-commit", "#!/bin/sh\ntouch \"$PWD/hook-marker\"\n")
	if err := os.Chmod(hook, 0o755); err != nil {
		t.Fatal(err)
	}
	// Prove the hook fires in the source, so its silence in the copy means something.
	gitIn(t, root, "commit", "-q", "--allow-empty", "-m", "hooked")
	if _, err := os.Stat(filepath.Join(root, "hook-marker")); err != nil {
		t.Fatalf("hook did not run in the source: %v", err)
	}
	if err := os.Remove(filepath.Join(root, "hook-marker")); err != nil {
		t.Fatal(err)
	}
	head, status := gitIn(t, root, "rev-parse", "HEAD"), gitIn(t, root, "status", "--porcelain")
	objects := gitIn(t, root, "count-objects", "-v")
	before := snapshot(t, root)

	r := probeOf(t, root, "touch scratch-only; git config probe.sentinel changed; git add -A; git -c user.name=P -c user.email=p@example.invalid commit -qm x; git branch probe-only; git log -1 --format=%s; git config --get probe.sentinel; test ! -e .git/hooks && echo no-hooks")
	if r.Status != 0 || r.Output != "x\nchanged\nno-hooks\n" {
		t.Fatalf("probe = %+v", r)
	}
	if got := gitIn(t, root, "config", "--get", "probe.sentinel"); got != "original" {
		t.Fatalf("source config = %q", got)
	}
	if got := gitIn(t, root, "rev-parse", "HEAD"); got != head {
		t.Fatalf("source HEAD = %s, want %s", got, head)
	}
	if got := gitIn(t, root, "status", "--porcelain"); got != status {
		t.Fatalf("source status = %q, want %q", got, status)
	}
	if got := gitIn(t, root, "count-objects", "-v"); got != objects {
		t.Fatalf("source objects = %q, want %q", got, objects)
	}
	for _, name := range []string{"scratch-only", "hook-marker"} {
		if _, err := os.Stat(filepath.Join(root, name)); !os.IsNotExist(err) {
			t.Fatalf("%s in source: %v", name, err)
		}
	}
	after := snapshot(t, root)
	for path, want := range before {
		if got, ok := after[path]; !ok || got != want {
			t.Errorf("source %s changed (present %v)", path, ok)
		}
	}
	for path := range after {
		if _, ok := before[path]; !ok {
			t.Errorf("source gained %s", path)
		}
	}
}

func TestProbeCopyCarriesNoLocalConfig(t *testing.T) {
	t.Parallel()
	root := gitProject(t)
	gitIn(t, root, "config", "user.name", "Source User")
	gitIn(t, root, "config", "user.email", "source@example.invalid")
	gitIn(t, root, "remote", "add", "origin", "https://example.invalid/repo.git")
	r := probeOf(t, root, "git rev-parse --is-inside-work-tree; git remote; git config --local --get user.name; git config --local --get user.email; git config --local --get remote.origin.url; git config --local --get probe.sentinel; git for-each-ref --format='%(refname)'; git config --local --get core.hooksPath; echo done")
	if want := "true\nrefs/heads/main\n/dev/null\ndone\n"; r.Status != 0 || r.Output != want {
		t.Fatalf("probe = %+v, want output %q", r, want)
	}
}

func TestProbeCopyDetachedHead(t *testing.T) {
	t.Parallel()
	root := gitProject(t)
	head := gitIn(t, root, "rev-parse", "HEAD")
	gitIn(t, root, "checkout", "-q", "--detach")
	r := probeOf(t, root, "git rev-parse HEAD; git symbolic-ref -q HEAD || echo detached; git log --format=%s; git for-each-ref")
	if want := head + "\ndetached\nbaseline\n"; r.Status != 0 || r.Output != want {
		t.Fatalf("probe = %+v, want output %q", r, want)
	}
}

func TestProbeCopyLinkedWorktree(t *testing.T) {
	t.Parallel()
	main := gitProject(t)
	root := filepath.Join(t.TempDir(), "linked")
	gitIn(t, main, "worktree", "add", "-q", "-b", "feature", root)
	before := snapshot(t, main)
	r := probeOf(t, root, "git rev-parse --abbrev-ref HEAD; git show HEAD:src/main.txt; git status --short; git -c user.name=P -c user.email=p@example.invalid commit -q --allow-empty -m y; git log -1 --format=%s")
	if want := "feature\nUsage: main [file]\ny\n"; r.Status != 0 || r.Output != want {
		t.Fatalf("probe = %+v, want output %q", r, want)
	}
	after := snapshot(t, main)
	for path, want := range before {
		if got, ok := after[path]; !ok || got != want {
			t.Errorf("main checkout %s changed (present %v)", path, ok)
		}
	}
	if got := gitIn(t, root, "log", "-1", "--format=%s"); got != "baseline" {
		t.Fatalf("linked worktree HEAD subject = %q", got)
	}
}

func TestProbeCopyShallowClone(t *testing.T) {
	t.Parallel()
	origin := gitProject(t)
	writeProjectFile(t, origin, "src/main.txt", "Usage: main --verbose\n")
	gitIn(t, origin, "commit", "-qam", "second")
	root := filepath.Join(t.TempDir(), "shallow")
	gitIn(t, filepath.Dir(root), "clone", "-q", "--depth", "1", "file://"+origin, root)
	r := probeOf(t, root, "git show HEAD:src/main.txt; git log --format=%s; git rev-parse --is-shallow-repository")
	if want := "Usage: main --verbose\nsecond\ntrue\n"; r.Status != 0 || r.Output != want {
		t.Fatalf("probe = %+v, want output %q", r, want)
	}
}

func TestProbeCopySHA256(t *testing.T) {
	t.Parallel()
	root := gitProject(t, "--object-format=sha256")
	head := gitIn(t, root, "rev-parse", "HEAD")
	r := probeOf(t, root, "git rev-parse HEAD; git show HEAD:src/main.txt; git status --short; git rev-parse --show-object-format")
	if want := head + "\nUsage: main [file]\nsha256\n"; r.Status != 0 || r.Output != want {
		t.Fatalf("probe = %+v, want output %q", r, want)
	}
}

func TestProbeWithoutUsableSourceRepositoryHasNoGitMetadata(t *testing.T) {
	t.Parallel()
	noCommit := t.TempDir()
	gitIn(t, noCommit, "init", "-q")
	missing := gitProject(t)
	writeProjectFile(t, missing, ".git/refs/heads/main", strings.Repeat("1", 40)+"\n")
	subdir := gitProject(t)
	plain := t.TempDir()
	writeProjectFile(t, plain, "README.md", "readme\n")
	for name, root := range map[string]string{"no repository": plain, "no commit": noCommit, "missing commit": missing, "not the top level": filepath.Join(subdir, "src")} {
		t.Run(name, func(t *testing.T) {
			r := probeOf(t, root, "git status --short")
			if r.Status != 128 || !strings.Contains(r.Output, "fatal: not a git repository") || !strings.HasSuffix(r.Output, "\n"+probeNoGitExplanation+"\n") {
				t.Fatalf("probe = %+v", r)
			}
			if r := probeOf(t, root, "echo unchanged; test ! -e .git && echo no-git"); r.Status != 0 || r.Output != "unchanged\nno-git\n" {
				t.Fatalf("probe = %+v", r)
			}
		})
	}
}

func TestProbeGitDiagnosticWithoutFinalNewline(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	r, err := RunProbe(context.Background(), sessionFor(root), root, "printf 'fatal: not a git repository'", nil)
	if err != nil || r.Status != 0 || r.TimedOut || !strings.HasPrefix(r.Output, "fatal: not a git repository\nprobe copy has no git metadata:") {
		t.Fatalf("probe = %+v, err %v", r, err)
	}
}
