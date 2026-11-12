package verify

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// The setup command "compiles" into the git-ignored build/ cache only when it is absent, and counts
// each from-scratch compile.
func TestReadinessReusesTheCheckoutsIgnoredBuildOutputs(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	count := p.trace("compiles")
	p.Config.Setup = []string{`if [ ! -d build ]; then mkdir build; echo cold >> ` + shellQuote(count) + `; fi; echo built > build/cache`}
	r := p.readiness()
	s, _ := p.session()

	// The checkout has compiled once, as a developer's own setup would.
	p.write("build/cache", "built\n")
	for i := 0; i < 2; i++ {
		if _, err := r.Check(context.Background(), s, fixtureSlug); err != nil {
			t.Fatal(err)
		}
	}
	eqSlice(t, "from-scratch compiles", p.ran("compiles"), nil)
}

func TestReadinessCompilesFromScratchWithoutAnyCheckoutCache(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	count := p.trace("compiles")
	p.Config.Setup = []string{`if [ ! -d build ]; then mkdir build; echo cold >> ` + shellQuote(count) + `; fi`}
	r := p.readiness()
	s, _ := p.session()
	for i := 0; i < 2; i++ {
		if _, err := r.Check(context.Background(), s, fixtureSlug); err != nil {
			t.Fatal(err)
		}
	}
	eqSlice(t, "from-scratch compiles", p.ran("compiles"), []string{"cold", "cold"})
}

func TestSeedIgnoredKeepsTrackedContentAndSkipsKogenLocal(t *testing.T) {
	p := newProj(t)
	// A tracked file that a broader ignore rule also matches, plus ignored neighbours.
	p.write(".gitignore", ".kogen/local/\nbuild/\n*.log\nshaped.txt\n")
	p.write("shaped.txt", "tracked\n")
	p.git("add", "-f", ".gitignore", "shaped.txt")
	p.git("commit", "-q", "-m", "track")
	p.write("shaped.txt", "ignored-edit\n")
	p.write("build/x/cache", "cache\n")
	p.write("a.log", "log\n")
	p.write(".kogen/local/secret", "local\n")

	dst := t.TempDir()
	if err := os.WriteFile(filepath.Join(dst, "shaped.txt"), []byte("tracked\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := SeedIgnored(p.Root, dst); err != nil {
		t.Fatal(err)
	}
	read := func(rel string) string { b, _ := os.ReadFile(filepath.Join(dst, rel)); return string(b) }
	eq(t, "tracked wins", read("shaped.txt"), "tracked\n")
	eq(t, "build seeded", read("build/x/cache"), "cache\n")
	eq(t, "log seeded", read("a.log"), "log\n")
	eq(t, ".kogen/local absent", fileExists(filepath.Join(dst, ".kogen/local")), false)
	eq(t, ".kogen absent", fileExists(filepath.Join(dst, ".kogen")), false)
}

func seedGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v: %s", args, err, b)
	}
}

func seedWrite(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, rel)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func seedRead(t *testing.T, root, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(root, rel))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// seedRepo makes a repository whose tracked files are given and whose .gitignore is ignore.
func seedRepo(t *testing.T, ignore string, tracked map[string]string) string {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	seedGit(t, root, "init", "-q")
	seedWrite(t, root, ".gitignore", ignore)
	for rel, content := range tracked {
		seedWrite(t, root, rel, content)
	}
	seedGit(t, root, "add", "-A")
	return root
}

func TestSeedIgnoredNeverWritesThroughToTheSourceCheckout(t *testing.T) {
	src := seedRepo(t, "cache/\n", map[string]string{"tracked.txt": "t\n"})
	seedWrite(t, src, "cache/keep.txt", "keep\n")
	seedWrite(t, src, "cache/gone.txt", "gone\n")
	seedWrite(t, src, "cache/edit.txt", "edit\n")
	seedWrite(t, src, "cache/sub/deep.txt", "deep\n")
	if err := os.Symlink(filepath.Join(src, "cache/sub/deep.txt"), filepath.Join(src, "cache/abs-link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("sub/deep.txt", filepath.Join(src, "cache/rel-link")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("../tracked.txt", filepath.Join(src, "cache/up-link")); err != nil {
		t.Fatal(err)
	}
	snapshot := func() map[string]string {
		got := map[string]string{}
		filepath.WalkDir(src, func(p string, d os.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				if d != nil && d.IsDir() && d.Name() == ".git" {
					return filepath.SkipDir
				}
				return nil
			}
			if d.Type()&os.ModeSymlink != 0 {
				to, _ := os.Readlink(p)
				got[p] = "link:" + to
				return nil
			}
			b, _ := os.ReadFile(p)
			got[p] = string(b)
			return nil
		})
		return got
	}
	before := snapshot()

	dst := seedRepo(t, "", map[string]string{"tracked.txt": "t\n"})
	if err := SeedIgnored(src, dst); err != nil {
		t.Fatal(err)
	}
	seedWrite(t, dst, "cache/edit.txt", "changed\n")
	if err := os.Remove(filepath.Join(dst, "cache/gone.txt")); err != nil {
		t.Fatal(err)
	}
	seedWrite(t, dst, "cache/new.txt", "new\n")
	// Write through every symlink; a link that was skipped has nothing to write through.
	for _, l := range []string{"cache/abs-link", "cache/rel-link", "cache/up-link"} {
		if f, err := os.OpenFile(filepath.Join(dst, l), os.O_WRONLY|os.O_TRUNC, 0); err == nil {
			f.WriteString("clobbered\n")
			f.Close()
		}
	}
	after := snapshot()
	if len(before) != len(after) {
		t.Fatalf("source checkout changed: %v, now %v", before, after)
	}
	for p, v := range before {
		if after[p] != v {
			t.Errorf("source %s = %q, want %q", p, after[p], v)
		}
	}
}

func TestSeedIgnoredLeavesTrackedCandidateContentAlone(t *testing.T) {
	src := seedRepo(t, "shared.txt\nmodified.txt\nonly-src.txt\n", nil)
	seedWrite(t, src, "shared.txt", "source ignored\n")
	seedWrite(t, src, "modified.txt", "source ignored\n")
	seedWrite(t, src, "only-src.txt", "seeded\n")

	dst := seedRepo(t, "", map[string]string{"shared.txt": "tracked\n", "modified.txt": "tracked\n"})
	seedWrite(t, dst, "modified.txt", "edited in candidate\n")
	if err := SeedIgnored(src, dst); err != nil {
		t.Fatal(err)
	}
	eq(t, "tracked", seedRead(t, dst, "shared.txt"), "tracked\n")
	eq(t, "modified in candidate", seedRead(t, dst, "modified.txt"), "edited in candidate\n")
	eq(t, "non-colliding seeded", seedRead(t, dst, "only-src.txt"), "seeded\n")
}

// A make fixture with two outputs in the git-ignored bin/: a seeded tree reuses an output whose
// input is unchanged and rebuilds only the one whose input changed.
func TestSeedIgnoredLetsMakeReuseAndRebuildOutputs(t *testing.T) {
	if _, err := exec.LookPath("make"); err != nil {
		t.Skip("make not available")
	}
	files := map[string]string{
		"Makefile": "all: bin/a bin/b\n" +
			"bin/%: %.txt\n\t@mkdir -p bin && cp $< $@ && echo $* >> bin/log\n",
		"a.txt": "a1\n",
		"b.txt": "b1\n",
	}
	src := seedRepo(t, "bin/\n", files)
	old := time.Now().Add(-time.Hour)
	for _, f := range []string{"a.txt", "b.txt"} {
		if err := os.Chtimes(filepath.Join(src, f), old, old); err != nil {
			t.Fatal(err)
		}
	}
	make := func(dir string) {
		t.Helper()
		if b, err := exec.Command("make", "-C", dir).CombinedOutput(); err != nil {
			t.Fatalf("make: %v: %s", err, b)
		}
	}
	make(src)

	dst := seedRepo(t, "", files)
	for _, f := range []string{"a.txt", "b.txt"} {
		if err := os.Chtimes(filepath.Join(dst, f), old, old); err != nil {
			t.Fatal(err)
		}
	}
	if err := SeedIgnored(src, dst); err != nil {
		t.Fatal(err)
	}
	make(dst)
	eq(t, "unchanged inputs rebuild nothing", seedRead(t, dst, "bin/log"), "a\nb\n")

	seedWrite(t, dst, "a.txt", "a2\n")
	// Make compares whole seconds on some platforms, so state the edit's time outright.
	edited := time.Now().Add(time.Minute)
	if err := os.Chtimes(filepath.Join(dst, "a.txt"), edited, edited); err != nil {
		t.Fatal(err)
	}
	make(dst)
	eq(t, "changed input rebuilt, other reused", seedRead(t, dst, "bin/log"), "a\nb\na\n")
	eq(t, "output reflects change", seedRead(t, dst, "bin/a"), "a2\n")
	eq(t, "unchanged output", seedRead(t, dst, "bin/b"), "b1\n")
	eq(t, "source output untouched", seedRead(t, src, "bin/a"), "a1\n")
}
