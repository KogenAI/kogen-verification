package verify

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// A readiness check keeps the ignored build outputs of its scratch tree in the run's cache; a
// later fresh copy of the same package, lockfile and toolchain is seeded with them, one with a
// different lockfile or toolchain gets nothing, and Close removes everything.
func TestBuildCacheSeedsOnlyTheSamePackageLockfileAndToolchain(t *testing.T) {
	tmp := isolateTmp(t)
	p := newProj(t)
	p.write("go.sum", "lock one\n")
	p.commit("lockfile")
	p.Config.Setup = []string{`mkdir -p build && echo compiled > build/dep`}
	r := p.readiness()
	r.Cache = NewBuildCache()
	s, _ := p.session()
	if _, err := r.Check(context.Background(), s, fixtureSlug); err != nil {
		t.Fatal(err)
	}

	fresh := func() (string, []string) {
		t.Helper()
		tree, err := p.Repo.Tree(p.Repo.Head(), nil)
		if err != nil {
			t.Fatal(err)
		}
		dir := filepath.Join(t.TempDir(), "copy")
		mat, err := p.Repo.Materialize(tree, dir)
		if err != nil {
			t.Fatal(err)
		}
		return dir, mat.Paths
	}
	seeded := func(dir string) bool {
		b, err := os.ReadFile(filepath.Join(dir, "build/dep"))
		return err == nil && string(b) == "compiled\n"
	}

	dir, paths := fresh()
	if r.SeedBuild(s, dir, fixtureSlug, paths) == "" || !seeded(dir) {
		t.Fatalf("a copy of the same package and lockfile did not get the build outputs")
	}

	dir, paths = fresh()
	if r.SeedBuild(s, dir, "another-intent", paths); seeded(dir) {
		t.Errorf("a different Intent got the build outputs")
	}

	p.write("go.sum", "lock two\n")
	p.commit("another lockfile")
	dir, paths = fresh()
	if r.SeedBuild(s, dir, fixtureSlug, paths); seeded(dir) {
		t.Errorf("a different lockfile got the build outputs")
	}

	p.write("go.sum", "lock one\n")
	p.commit("back")
	r.Cache.tools["go version"] = "go version other"
	dir, paths = fresh()
	if r.SeedBuild(s, dir, fixtureSlug, paths); seeded(dir) {
		t.Errorf("a different toolchain got the build outputs")
	}

	if err := r.Cache.Close(); err != nil {
		t.Fatal(err)
	}
	if l := leftovers(t, tmp, "kogen-buildcache"); len(l) != 0 {
		t.Errorf("the cache left behind %v", l)
	}
	dir, paths = fresh()
	if r.SeedBuild(s, dir, fixtureSlug, paths); seeded(dir) {
		t.Errorf("a closed cache still seeded")
	}
}

// Without a lockfile of a known toolchain nothing is cached, and a nil cache does nothing.
func TestBuildCacheIgnoresTreesWithoutALockfile(t *testing.T) {
	isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = []string{`mkdir -p build && echo compiled > build/dep`}
	r := p.readiness()
	r.Cache = NewBuildCache()
	defer r.Cache.Close()
	s, _ := p.session()
	if _, err := r.Check(context.Background(), s, fixtureSlug); err != nil {
		t.Fatal(err)
	}
	if len(r.Cache.entries) != 0 {
		t.Errorf("kept build outputs of a tree without a lockfile")
	}
	var none *BuildCache
	none.Keep("k", t.TempDir())
	if err := none.Seed("k", t.TempDir()); err != nil || none.Close() != nil {
		t.Errorf("a nil cache failed")
	}
}
