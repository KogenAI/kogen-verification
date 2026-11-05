//go:build linux

package verify

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
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

// runReaperHelper runs script under the real helper (this test binary) and returns its output
// and exit status.
func runReaperHelper(t *testing.T, dir, script string) (string, int) {
	t.Helper()
	cmd := exec.Command(os.Args[0], acceptanceReaperFlag, script)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err == nil {
		return string(out), 0
	}
	ee, ok := err.(*exec.ExitError)
	if !ok {
		t.Fatal(err)
	}
	return string(out), ee.ExitCode()
}

// A process-group member the helper adopted and that exits while the shell runs is reaped at
// once, so a check that kills its group and polls kill -0 sees it gone.
func TestAcceptanceReaperReapsAdoptedChildWhileShellRuns(t *testing.T) {
	script := `( setsid /bin/sleep 300 </dev/null >/dev/null 2>&1 & echo $! > member )
member=$(cat member)
i=0
while [ "$(cut -d' ' -f5 /proc/$member/stat)" != "$member" ] && [ $i -lt 500 ]; do sleep 0.01; i=$((i+1)); done
kill -TERM -$member
i=0
while kill -0 $member 2>/dev/null && [ $i -lt 100 ]; do sleep 0.05; i=$((i+1)); done
if kill -0 $member 2>/dev/null; then echo still present; else echo gone; fi
`
	start := time.Now()
	out, code := runReaperHelper(t, t.TempDir(), script)
	if code != 0 || out != "gone\n" {
		t.Fatalf("helper exit %d, output %q; want 0, \"gone\\n\"", code, out)
	}
	if d := time.Since(start); d > 4*time.Second {
		t.Errorf("helper took %v", d)
	}
}

// The helper returns the shell's status, not that of a child it reaped before the shell.
func TestAcceptanceReaperReturnsShellStatus(t *testing.T) {
	script := `( sh -c 'exit 9' & )
sleep 0.3
echo shell done
exit 7
`
	out, code := runReaperHelper(t, t.TempDir(), script)
	if code != 7 || out != "shell done\n" {
		t.Fatalf("helper exit %d, output %q; want 7, \"shell done\\n\"", code, out)
	}
	if _, code := runReaperHelper(t, t.TempDir(), "kill -TERM $$"); code != 143 {
		t.Errorf("signalled shell: exit %d, want 143", code)
	}
}
