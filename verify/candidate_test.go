package verify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

const candidateFixture = "testdata/candidate-fixture"

// TestMain lets this test binary stand in for the packaged candidate: RunCandidate runs the
// executable that is running it, and the phases it starts (shape, build, build --resume,
// restore, land, with KOGEN_PROVIDER=scripted) are answered by candidateStandIn.
func TestMain(m *testing.M) {
	if os.Getenv("KOGEN_PROVIDER") == "scripted" && len(os.Args) > 1 {
		switch os.Args[1] {
		case "shape", "build", "restore", "land":
			os.Exit(candidateStandIn(os.Args[1:]))
		}
	}
	os.Exit(m.Run())
}

// candidateStandIn plays the candidate against the fixture in the working directory, following
// the fixture's scripted-provider.txt: build is interrupted once, build --resume completes it,
// restore puts protected.txt back, and land needs all of that.
func candidateStandIn(args []string) int {
	fail := func(msg string) int {
		fmt.Fprintln(os.Stderr, msg)
		return 1
	}
	script, err := os.ReadFile("scripted-provider.txt")
	if err != nil {
		return fail("no scripted provider script: " + err.Error())
	}
	step := strings.Join(args, " ")
	if !strings.Contains(string(script), "\n"+step+" ") {
		return fail("the scripted provider has no step " + step)
	}
	state, _ := os.ReadFile("state")
	switch step {
	case "shape":
		if st, err := os.Stat("node_modules/mirrordep/index.js"); err != nil || st.IsDir() {
			return fail("dependency not installed")
		}
		return write("state", "shaped")
	case "build":
		if string(state) != "shaped" {
			return fail("build before shape")
		}
		if err := os.WriteFile("protected.txt", []byte("damaged\n"), 0o644); err != nil {
			return fail(err.Error())
		}
		return write("state", "interrupted")
	case "build --resume":
		if string(state) != "interrupted" {
			return fail("nothing to resume")
		}
		return write("state", "built")
	case "restore":
		if string(state) != "built" {
			return fail("restore before the Build completed")
		}
		if err := os.WriteFile("protected.txt", []byte("protected file content\n"), 0o644); err != nil {
			return fail(err.Error())
		}
		return write("state", "restored")
	case "land":
		if string(state) != "restored" {
			return fail("land before restore")
		}
		return 0
	}
	return fail("unknown step " + step)
}

func write(name, content string) int {
	if err := os.WriteFile(name, []byte(content), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}

func runCandidate(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var out, errOut bytes.Buffer
	code := RunCandidate(args, &out, &errOut)
	return code, out.String(), errOut.String()
}

func TestRunCandidateLandsShippedFixture(t *testing.T) {
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm is needed for the dependency install")
	}
	code, out, errOut := runCandidate(t, "--project", candidateFixture)
	if code != 0 {
		t.Fatalf("exit %d\nstdout:\n%s\nstderr:\n%s", code, out, errOut)
	}
	lines := strings.Split(strings.TrimRight(out, "\n"), "\n")
	if len(lines) != 2 || lines[0] != "candidate-build: landed" {
		t.Fatalf("stdout = %q", out)
	}
	var raw map[string]any
	if err := json.Unmarshal([]byte(lines[1]), &raw); err != nil {
		t.Fatalf("receipt %q: %v", lines[1], err)
	}
	if len(raw) != 4 {
		t.Fatalf("receipt keys: %v", raw)
	}
	var rec candidateReceipt
	if err := json.Unmarshal([]byte(lines[1]), &rec); err != nil {
		t.Fatal(err)
	}
	exe, _ := os.Executable()
	want, err := fileSHA256(exe)
	if err != nil {
		t.Fatal(err)
	}
	if rec.BinarySHA256 != want {
		t.Errorf("binary_sha256 = %s, want %s", rec.BinarySHA256, want)
	}
	if rec.Project != candidateFixture {
		t.Errorf("project = %q", rec.Project)
	}
	if wantPhases := []string{"install", "shape", "build", "resume", "restore", "land"}; !slices.Equal(rec.Phases, wantPhases) {
		t.Errorf("phases = %v", rec.Phases)
	}
	if rec.ElapsedSeconds <= 0 {
		t.Errorf("elapsed_seconds = %v", rec.ElapsedSeconds)
	}
	// The fixture itself is only copied, never modified.
	if _, err := os.Stat(filepath.Join(candidateFixture, "node_modules")); err == nil {
		t.Error("the fixture directory was installed into")
	}
}

func TestRunCandidateFailedPhaseStops(t *testing.T) {
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm is needed for the dependency install")
	}
	fix := t.TempDir()
	if err := copyTree(candidateFixture, fix); err != nil {
		t.Fatal(err)
	}
	// A script without the resume step makes the resume phase exit nonzero.
	script := "# no resume\nshape ok\nbuild interrupt\nrestore ok\nland ok\n"
	if err := os.WriteFile(filepath.Join(fix, "scripted-provider.txt"), []byte("\n"+script), 0o644); err != nil {
		t.Fatal(err)
	}
	code, out, _ := runCandidate(t, "--project="+fix)
	if code != 1 || out != "candidate-build: failed resume\n" {
		t.Fatalf("exit %d, stdout %q", code, out)
	}
}

func TestRunCandidateUnavailable(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no-such-fixture")
	for name, args := range map[string][]string{
		"missing directory": {"--project", missing},
		"no --project":      {},
		"empty value":       {"--project"},
	} {
		code, out, _ := runCandidate(t, args...)
		if code != 2 || out != "candidate-build: unavailable\n" {
			t.Errorf("%s: exit %d, stdout %q", name, code, out)
		}
	}
}
