//go:build linux

package verify

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"kogen-loop/sys"
)

// A server whose launcher (Python Popen with the default close_fds, an empty environment and a
// new session) exited carries neither marker and has no marked parent; the run's subreaper
// still stops it.
func TestAcceptanceStopsMarkerlessSessionOrphan(t *testing.T) {
	python := sweepPython(t)
	root, slug := sweepRoot(t)
	pidFile := filepath.Join(root, "pids")
	script := `import subprocess, sys
p = subprocess.Popen(["sleep", "300"], env={}, start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
open(sys.argv[1], "w").write("%d" % p.pid)
`
	s := sys.NewWith(os.Environ(), root)
	command := python + " -c " + shellQuote(script) + " " + pidFile
	if _, err := RunAcceptance(context.Background(), s, root, Tools{}, slug, command, filepath.Join(root, "r.ndjson"), nil, nil); err != nil {
		t.Fatal(err)
	}
	for _, pid := range sweepPIDs(t, pidFile, 1) {
		if !sweepGoneSoon(pid) {
			t.Errorf("server %d is still running after the acceptance run", pid)
		}
	}
}

func TestAcceptanceReapedQuotesScript(t *testing.T) {
	got := acceptanceReaped("echo 'x'")
	if !strings.HasPrefix(got, "exec '") || !strings.HasSuffix(got, ` `+acceptanceReaperFlag+` 'echo '\''x'\'''`) {
		t.Fatalf("acceptanceReaped = %q", got)
	}
}
