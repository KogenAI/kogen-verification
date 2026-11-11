package verify

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
)

func TestAcceptanceTargets(t *testing.T) {
	t.Parallel()
	const me, self = 1000, 50
	procs := []procEntry{
		{pid: 1, ppid: 0, uid: 0},
		{pid: 40, ppid: 1, uid: me},    // an ancestor of Kogen carrying the value
		{pid: self, ppid: 40, uid: me}, // Kogen itself
		{pid: 60, ppid: self, uid: me}, // marked
		{pid: 61, ppid: 60, uid: me},   // descendant of a marked process
		{pid: 62, ppid: 61, uid: me, zombie: true},
		{pid: 63, ppid: 61, uid: 0},     // another user's descendant
		{pid: 70, ppid: 1, uid: me},     // unrelated
		{pid: 71, ppid: 70, uid: me},    // unrelated child
		{pid: 80, ppid: 1, uid: me + 1}, // marked, but another user's
		{pid: 90, ppid: self, uid: me},  // not marked, Kogen's own child
		{pid: 91, ppid: self, uid: me},  // marked, a Kogen child
		{pid: 92, ppid: 91, uid: me},    // its child
		{pid: 100, ppid: 1, uid: me, zombie: true},
	}
	marked := map[int]bool{40: true, self: true, 60: true, 80: true, 91: true, 100: true}
	got := acceptanceTargets(procs, me, self, func(pid int) bool { return marked[pid] })
	if want := []int{60, 61, 91, 92}; !slices.Equal(got, want) {
		t.Fatalf("targets = %v, want %v", got, want)
	}
}

func sweepAlive(pid int) bool { return pid > 0 && syscall.Kill(pid, 0) != syscall.ESRCH }

func sweepGoneSoon(pid int) bool {
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(25 * time.Millisecond) {
		if !sweepAlive(pid) {
			return true
		}
	}
	return false
}

func sweepRoot(t *testing.T) (root, slug string) {
	t.Helper()
	root, slug = t.TempDir(), "sweep"
	feature := filepath.Join(root, ".kogen/intents", slug, "acceptance.feature")
	if err := os.MkdirAll(filepath.Dir(feature), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(feature, []byte("Feature: sweep\n  Scenario: sweep\n    Then sweep\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return root, slug
}

func sweepPython(t *testing.T) string {
	t.Helper()
	p, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 is not available")
	}
	return p
}

func sweepPIDs(t *testing.T, file string, n int) []int {
	t.Helper()
	b, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var pids []int
	for _, f := range strings.Fields(string(b)) {
		pid, _ := strconv.Atoi(f)
		pids = append(pids, pid)
	}
	if len(pids) != n {
		t.Fatalf("%s holds %q, want %d pids", file, b, n)
	}
	t.Cleanup(func() {
		for _, pid := range pids {
			syscall.Kill(pid, syscall.SIGKILL)
		}
	})
	return pids
}

// A process that dropped the marker but whose parent still carries it when the command ends is
// stopped with that parent.
func TestAcceptanceStopsMarkerlessChildOfMarkedProcess(t *testing.T) {
	t.Parallel()
	python := sweepPython(t)
	root, slug := sweepRoot(t)
	pidFile := filepath.Join(root, "pids")
	// The child hangs under a marked parent that is itself in a new session.
	script := `import subprocess, sys
parent = subprocess.Popen([sys.executable, "-c", "import os, subprocess, sys, time\nenv = dict(os.environ)\nenv.pop('KOGEN_ACCEPTANCE_RUN')\nc = subprocess.Popen(['sleep', '300'], env=env, start_new_session=True)\nprint(c.pid, flush=True)\ntime.sleep(300)"], stdout=subprocess.PIPE, start_new_session=True)
child = int(parent.stdout.readline())
open(sys.argv[1], "w").write("%d %d" % (parent.pid, child))
`
	s := sys.NewWith(os.Environ(), root)
	command := python + " -c '" + strings.ReplaceAll(script, "'", `'\''`) + "' " + pidFile
	if _, err := RunAcceptance(context.Background(), s, root, Tools{}, slug, command, filepath.Join(root, "r.ndjson"), nil, nil); err != nil {
		t.Fatal(err)
	}
	for _, pid := range sweepPIDs(t, pidFile, 2) {
		if !sweepGoneSoon(pid) {
			t.Errorf("process %d is still running after the acceptance run", pid)
		}
	}
}

// A process carrying another run's value (an enclosing or concurrent run) is not touched.
func TestAcceptanceLeavesOtherRunsProcessesAlone(t *testing.T) {
	t.Parallel()
	root, slug := sweepRoot(t)
	other := exec.Command("sleep", "300")
	other.Env = append(os.Environ(), acceptanceMarker+"=0123456789abcdef0123456789abcdef")
	other.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := other.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { other.Process.Kill(); other.Wait() }()
	s := sys.NewWith(os.Environ(), root)
	if _, err := RunAcceptance(context.Background(), s, root, Tools{}, slug, "exit 0", filepath.Join(root, "r.ndjson"), nil, nil); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	if !sweepAlive(other.Process.Pid) {
		t.Fatal("a process carrying another run's value was stopped")
	}
}

// Every run gets its own value, replacing one inherited from the caller.
func TestAcceptanceRunValueIsFreshPerRun(t *testing.T) {
	t.Parallel()
	root, slug := sweepRoot(t)
	inherited := "inherited-by-an-enclosing-run"
	s := sys.NewWith(append(os.Environ(), acceptanceMarker+"="+inherited), root)
	var seen []string
	for i := 0; i < 2; i++ {
		out := filepath.Join(root, "value"+strconv.Itoa(i))
		if _, err := RunAcceptance(context.Background(), s, root, Tools{}, slug, `printf %s "$KOGEN_ACCEPTANCE_RUN" > '`+out+`'`, filepath.Join(root, "r.ndjson"), nil, nil); err != nil {
			t.Fatal(err)
		}
		b, err := os.ReadFile(out)
		if err != nil {
			t.Fatal(err)
		}
		seen = append(seen, string(b))
	}
	hex := regexp.MustCompile(`^[0-9a-f]{32,}$`)
	for _, v := range seen {
		if v == inherited || !hex.MatchString(v) {
			t.Fatalf("acceptance command saw %q, want a fresh lowercase hex value of at least 128 bits", v)
		}
	}
	if seen[0] == seen[1] {
		t.Fatalf("two runs saw the same value %q", seen[0])
	}
	if got, _ := s.LookupEnv(acceptanceMarker); got != inherited {
		t.Fatalf("the session environment changed to %q", got)
	}
}

// sweepDetach is a launcher that keeps inherited descriptors: it starts sleep 300 in a new
// session (with the run's environment or an empty one) and exits at once, so the sleep is
// reparented. It writes the sleep's pid to argv[1].
const sweepDetach = `import os, sys
r, w = os.pipe()
if os.fork() == 0:
    os.setsid()
    os.write(w, b"%d" % os.getpid())
    os.close(w)
    os.execve("/bin/sleep", ["sleep", "300"], {} if sys.argv[2] == "clear" else dict(os.environ))
os.close(w)
open(sys.argv[1], "w").write(os.read(r, 32).decode())
`

// A server that started a new session and was reparented when its launcher exited is stopped,
// whether or not it kept its environment (an Apple platform binary hides it on macOS).
func TestAcceptanceStopsDetachedServers(t *testing.T) {
	t.Parallel()
	python := sweepPython(t)
	for _, envMode := range []string{"clear", "keep"} {
		t.Run(envMode, func(t *testing.T) {
			root, slug := sweepRoot(t)
			pidFile := filepath.Join(root, "pids")
			s := sys.NewWith(os.Environ(), root)
			command := python + " -c '" + strings.ReplaceAll(sweepDetach, "'", `'\''`) + "' " + pidFile + " " + envMode
			if _, err := RunAcceptance(context.Background(), s, root, Tools{}, slug, command, filepath.Join(root, "r.ndjson"), nil, nil); err != nil {
				t.Fatal(err)
			}
			for _, pid := range sweepPIDs(t, pidFile, 1) {
				if !sweepGoneSoon(pid) {
					t.Errorf("server %d is still running after the acceptance run", pid)
				}
			}
		})
	}
}

// A process holding a descriptor on the marker file is selected; one holding another file is not.
func TestProcHoldsFile(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	marker, other := filepath.Join(dir, "marker"), filepath.Join(dir, "other")
	for _, f := range []string{marker, other} {
		if err := os.WriteFile(f, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	info, err := os.Stat(marker)
	if err != nil {
		t.Fatal(err)
	}
	st := info.Sys().(*syscall.Stat_t)
	dev, ino := uint64(st.Dev), uint64(st.Ino)
	start := func(file string) int {
		c := exec.Command("/bin/sh", "-c", "exec 7<"+shellQuote(file)+"; exec sleep 300")
		if err := c.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Process.Kill(); c.Wait() })
		return c.Process.Pid
	}
	holder, bystander := start(marker), start(other)
	deadline := time.Now().Add(5 * time.Second)
	for !procHoldsFile(holder, dev, ino) && time.Now().Before(deadline) {
		time.Sleep(25 * time.Millisecond)
	}
	if !procHoldsFile(holder, dev, ino) {
		t.Fatal("a process holding the marker file was not recognized")
	}
	if procHoldsFile(bystander, dev, ino) {
		t.Fatal("a process holding another file was recognized")
	}
	if procHoldsFile(os.Getpid(), dev, ino) {
		t.Fatal("this process does not hold the marker file")
	}
}

// A detached, environment-cleared process that Kogen itself starts while the run is running is
// not the run's and survives.
func TestAcceptanceLeavesDetachedProcessStartedDuringTheRun(t *testing.T) {
	t.Parallel()
	root, slug := sweepRoot(t)
	s := sys.NewWith(os.Environ(), root)
	var during *exec.Cmd
	started := make(chan struct{})
	go func() {
		defer close(started)
		time.Sleep(300 * time.Millisecond)
		during = exec.Command("sleep", "300")
		during.Env = []string{}
		during.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
		if err := during.Start(); err != nil {
			t.Error(err)
			during = nil
		}
	}()
	if _, err := RunAcceptance(context.Background(), s, root, Tools{}, slug, "sleep 1", filepath.Join(root, "r.ndjson"), nil, nil); err != nil {
		t.Fatal(err)
	}
	<-started
	if during == nil {
		return
	}
	defer func() { during.Process.Kill(); during.Wait() }()
	time.Sleep(100 * time.Millisecond)
	if !sweepAlive(during.Process.Pid) {
		t.Fatal("a process the run did not start was stopped")
	}
}

type sweepLog struct{ events []map[string]any }

func (l *sweepLog) Log(event map[string]any) { l.events = append(l.events, event) }

// The recorded and logged acceptance command is the configured one, not the text holding the marker.
func TestAcceptanceRecordsTheConfiguredCommand(t *testing.T) {
	t.Parallel()
	root, slug := sweepRoot(t)
	s := sys.NewWith(os.Environ(), root)
	const command = "echo 'it''s'; exit 0"
	a := NewAttempt(root, slug, nil)
	log := &sweepLog{}
	if _, err := RunAcceptance(a.Into(context.Background()), s, root, Tools{}, slug, command, filepath.Join(root, "r.ndjson"), nil, log); err != nil {
		t.Fatal(err)
	}
	if len(a.steps) != 1 || a.steps[0].Command != command {
		t.Fatalf("attempt steps = %+v, want one step running %q", a.steps, command)
	}
	var logged []any
	for _, e := range log.events {
		if e["event"] == "command" {
			logged = append(logged, e["command"])
		}
	}
	if len(logged) != 1 || logged[0] != command {
		t.Fatalf("logged commands = %v, want [%q]", logged, command)
	}
}

// The marker file is a private empty file that exists only for the run.
func TestAcceptanceMarkerFileExistsOnlyForTheRun(t *testing.T) {
	t.Parallel()
	python := sweepPython(t)
	root, slug := sweepRoot(t)
	out := filepath.Join(root, "marker")
	script := `import fcntl, os, stat, sys
if sys.platform == "darwin":
    path = fcntl.fcntl(9, 50, b"\0" * 1024).split(b"\0")[0].decode()
else:
    path = os.readlink("/proc/self/fd/9")
st = os.fstat(9)
open(sys.argv[1], "w").write("%s %o %d %d" % (path, stat.S_IMODE(st.st_mode), stat.S_ISREG(st.st_mode), st.st_size))
`
	s := sys.NewWith(os.Environ(), root)
	command := python + " -c '" + strings.ReplaceAll(script, "'", `'\''`) + "' " + out
	if _, err := RunAcceptance(context.Background(), s, root, Tools{}, slug, command, filepath.Join(root, "r.ndjson"), nil, nil); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	f := strings.Fields(string(b))
	if len(f) != 4 || f[1] != "600" || f[2] != "1" || f[3] != "0" {
		t.Fatalf("descriptor 9 holds %q, want a regular empty file of mode 600", b)
	}
	if _, err := os.Stat(f[0]); !os.IsNotExist(err) {
		t.Fatalf("marker file %s still exists after the run (stat error %v)", f[0], err)
	}
}

func stepRun(ctx context.Context, root, command string, l Logger) (sys.Result, error) {
	s := sys.NewWith(os.Environ(), root)
	return runStep(ctx, s, Tools{}, "setup-1", l, command, root, nil)
}

func sweepDetachCommand(python, pidFile, envMode string) string {
	return python + " -c '" + strings.ReplaceAll(sweepDetach, "'", `'\''`) + "' " + pidFile + " " + envMode
}

// A step without an Attempt (a builder pass) and one under an Attempt stop the server they leave
// in a new session, whether or not it kept its environment, and log one step_sweep naming them.
func TestStepStopsDetachedServers(t *testing.T) {
	t.Parallel()
	python := sweepPython(t)
	for _, attempt := range []bool{false, true} {
		for _, envMode := range []string{"clear", "keep"} {
			name := envMode + "/builder"
			if attempt {
				name = envMode + "/attempt"
			}
			t.Run(name, func(t *testing.T) {
				root := t.TempDir()
				pidFile := filepath.Join(root, "pids")
				ctx := context.Background()
				if attempt {
					ctx = NewAttempt(root, "sweep", nil).Into(ctx)
				}
				log := &sweepLog{}
				if _, err := stepRun(ctx, root, sweepDetachCommand(python, pidFile, envMode), log); err != nil {
					t.Fatal(err)
				}
				for _, pid := range sweepPIDs(t, pidFile, 1) {
					if !sweepAlive(pid) {
						continue
					}
					if !sweepGoneSoon(pid) {
						t.Errorf("server %d is still running after the step", pid)
					}
				}
				if len(log.events) != 1 || log.events[0]["event"] != "step_sweep" || log.events[0]["name"] != "setup-1" {
					t.Fatalf("log = %v, want one step_sweep naming setup-1", log.events)
				}
			})
		}
	}
}

// A step that times out under an Attempt is swept too.
func TestStepThatTimesOutIsSwept(t *testing.T) {
	t.Parallel()
	python := sweepPython(t)
	root := t.TempDir()
	pidFile := filepath.Join(root, "pids")
	a := NewAttempt(root, "sweep", nil)
	a.timeout = 500 * time.Millisecond
	log := &sweepLog{}
	_, err := stepRun(a.Into(context.Background()), root, sweepDetachCommand(python, pidFile, "keep")+"; sleep 30", log)
	if err == nil {
		t.Fatal("the step did not time out")
	}
	for _, pid := range sweepPIDs(t, pidFile, 1) {
		if !sweepGoneSoon(pid) {
			t.Errorf("server %d is still running after the timed out step", pid)
		}
	}
	if len(log.events) != 1 || log.events[0]["event"] != "step_sweep" {
		t.Fatalf("log = %v, want one step_sweep", log.events)
	}
}

// A process carrying another step's value, and one started while the step runs, are not touched.
func TestStepLeavesProcessesItDidNotStartAlone(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	other := exec.Command("sleep", "300")
	other.Env = append(os.Environ(), stepMarker+"=0123456789abcdef0123456789abcdef")
	other.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := other.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { other.Process.Kill(); other.Wait() }()
	var during *exec.Cmd
	started := make(chan struct{})
	go func() {
		defer close(started)
		time.Sleep(300 * time.Millisecond)
		during = exec.Command("sleep", "300")
		during.Env = []string{}
		during.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
		if err := during.Start(); err != nil {
			t.Error(err)
			during = nil
		}
	}()
	if _, err := stepRun(context.Background(), root, "sleep 1", nil); err != nil {
		t.Fatal(err)
	}
	<-started
	if during != nil {
		defer func() { during.Process.Kill(); during.Wait() }()
		if !sweepAlive(during.Process.Pid) {
			t.Error("a process the step did not start was stopped")
		}
	}
	if !sweepAlive(other.Process.Pid) {
		t.Error("a process carrying another step's value was stopped")
	}
}

// Every non-acceptance step gets a fresh KOGEN_STEP_RUN replacing an inherited one; the
// acceptance step gets only KOGEN_ACCEPTANCE_RUN.
func TestStepMarkerVariables(t *testing.T) {
	t.Parallel()
	root, slug := sweepRoot(t)
	inherited := "inherited-by-an-enclosing-run"
	s := sys.NewWith(append(os.Environ(), stepMarker+"="+inherited, acceptanceMarker+"="+inherited), root)
	envs := map[string]string{}
	for _, name := range []string{"one", "two"} {
		out := filepath.Join(root, name)
		if _, err := runStep(context.Background(), s, Tools{}, name, nil, `printf '%s|%s' "$KOGEN_STEP_RUN" "${KOGEN_ACCEPTANCE_RUN-unset}" > '`+out+`'`, root, nil); err != nil {
			t.Fatal(err)
		}
		b, _ := os.ReadFile(out)
		envs[name] = string(b)
	}
	hex := regexp.MustCompile(`^[0-9a-f]{32,}\|` + inherited + `$`)
	for name, v := range envs {
		if !hex.MatchString(v) {
			t.Fatalf("step %s saw %q, want a fresh KOGEN_STEP_RUN", name, v)
		}
	}
	if envs["one"] == envs["two"] {
		t.Fatalf("two steps saw the same value %q", envs["one"])
	}
	// The acceptance step: its own value, and no step marker (cleared here so only the step's own matters).
	env := slices.DeleteFunc(os.Environ(), func(kv string) bool { return strings.HasPrefix(kv, stepMarker+"=") })
	s = sys.NewWith(env, root)
	out := filepath.Join(root, "acceptance")
	command := `printf '%s|%s' "${KOGEN_STEP_RUN-unset}" "$KOGEN_ACCEPTANCE_RUN" > '` + out + `'`
	if _, err := RunAcceptance(context.Background(), s, root, Tools{}, slug, command, filepath.Join(root, "r.ndjson"), nil, nil); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(out)
	if !regexp.MustCompile(`^unset\|[0-9a-f]{32,}$`).MatchString(string(b)) {
		t.Fatalf("acceptance step saw %q, want only KOGEN_ACCEPTANCE_RUN", b)
	}
}

// A step's recorded and logged command is the configured one, and its marker file exists only
// for the step.
func TestStepRecordsTheConfiguredCommandAndRemovesItsMarkerFile(t *testing.T) {
	t.Parallel()
	python := sweepPython(t)
	root := t.TempDir()
	out := filepath.Join(root, "marker")
	script := `import fcntl, os, sys
if sys.platform == "darwin":
    path = fcntl.fcntl(9, 50, b"\0" * 1024).split(b"\0")[0].decode()
else:
    path = os.readlink("/proc/self/fd/9")
open(sys.argv[1], "w").write(path)
`
	command := python + " -c '" + strings.ReplaceAll(script, "'", `'\''`) + "' " + out
	a := NewAttempt(root, "sweep", nil)
	log := &sweepLog{}
	if _, err := stepRun(a.Into(context.Background()), root, command, log); err != nil {
		t.Fatal(err)
	}
	if len(a.steps) != 1 || a.steps[0].Command != command {
		t.Fatalf("attempt steps = %+v, want one step running %q", a.steps, command)
	}
	b, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(string(b)); !os.IsNotExist(err) {
		t.Fatalf("marker file %s still exists after the step (stat error %v)", b, err)
	}
}
