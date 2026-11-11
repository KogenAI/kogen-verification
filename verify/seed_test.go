package verify

import (
	"context"
	"os"
	"path/filepath"
	"testing"
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
