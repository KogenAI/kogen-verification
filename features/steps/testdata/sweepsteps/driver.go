package verify

import (
	"context"
	"encoding/json"
	"maps"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/project"
	"kogen-loop/sys"
)

// TestStepSweepAcceptanceDriver is installed only in an isolated acceptance copy, as
// verify/sweepsteps_acceptance_test.go. It runs SWEEPSTEPS_COMMAND as the fixture project's
// setup command (and, in builder passes, also as its check command "check") through the real
// verification entry points and writes what it observed to SWEEPSTEPS_RESULT as one JSON
// object; features/steps/sweep_steps_observer.js judges it.
//
//	SWEEPSTEPS_MODE       verify: one builder verification pass (Verify);
//	                      readiness: one approval readiness check (Readiness.Check, Attempt);
//	                      timeout: the same with every step bounded by SWEEPSTEPS_TIMEOUT seconds;
//	                      quiet: SWEEPSTEPS_PASSES builder verification passes
//	SWEEPSTEPS_SERVER     the arguments of the server the command leaves behind ("sleep 301")
//	SWEEPSTEPS_BYSTANDER  a command this test starts in its own session before the run
//
// Before the run, the command runs as many times as there are passes through sys.Session.Run
// with today's per-step guard only (its process group is killed on exit, the same timeout) and
// no sweep: these control runs record status, output, wall time and the servers they left.
func TestStepSweepAcceptanceDriver(t *testing.T) {
	out, mode, command := os.Getenv("SWEEPSTEPS_RESULT"), os.Getenv("SWEEPSTEPS_MODE"), os.Getenv("SWEEPSTEPS_COMMAND")
	if out == "" || mode == "" || command == "" {
		t.Fatal("SWEEPSTEPS_RESULT, SWEEPSTEPS_MODE and SWEEPSTEPS_COMMAND are required")
	}
	server := os.Getenv("SWEEPSTEPS_SERVER")
	passes := 1
	if mode == "quiet" {
		n, err := strconv.Atoi(os.Getenv("SWEEPSTEPS_PASSES"))
		if err != nil || n < 1 {
			t.Fatalf("SWEEPSTEPS_PASSES %q: want a positive number", os.Getenv("SWEEPSTEPS_PASSES"))
		}
		passes = n
	}
	var timeout time.Duration
	if mode == "timeout" {
		n, err := strconv.Atoi(os.Getenv("SWEEPSTEPS_TIMEOUT"))
		if err != nil || n < 1 {
			t.Fatalf("SWEEPSTEPS_TIMEOUT %q: want a positive number of seconds", os.Getenv("SWEEPSTEPS_TIMEOUT"))
		}
		timeout = time.Duration(n) * time.Second
	}
	// macOS has no setsid command: this stand-in starts its arguments in a new session, as
	// util-linux setsid does for a process that is not a process group leader.
	if _, err := exec.LookPath("setsid"); err != nil {
		bin := t.TempDir()
		shim := "#!/bin/sh\nexec /usr/bin/perl -MPOSIX -e 'POSIX::setsid() >= 0 or die \"setsid: $!\\n\"; exec @ARGV or die \"setsid: $ARGV[0]: $!\\n\"' -- \"$@\"\n"
		if err := os.WriteFile(filepath.Join(bin, "setsid"), []byte(shim), 0o755); err != nil {
			t.Fatal(err)
		}
		t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
		// Once, so that a cold start of perl does not outlast the control run.
		if out, err := exec.Command(filepath.Join(bin, "setsid"), "true").CombinedOutput(); err != nil {
			t.Fatalf("setsid stand-in: %v: %s", err, out)
		}
	}
	// Servers already running belong to someone else: they are neither counted nor stopped.
	preexisting := map[int]bool{}
	for _, pid := range sweepStepsServers(server, nil) {
		preexisting[pid] = true
	}
	t.Cleanup(func() {
		for _, pid := range sweepStepsServers(server, preexisting) {
			syscall.Kill(pid, syscall.SIGKILL)
		}
	})

	p := newProj(t)
	p.Config.Setup = []string{command}
	if mode == "verify" || mode == "quiet" {
		p.Config.Checks = []project.Check{{Name: "check", Run: command}}
	}
	s, _ := p.session()
	result := map[string]any{"mode": mode, "command": command, "server": server}

	controls := []map[string]any{}
	for i := 0; i < passes; i++ {
		began := time.Now()
		res, err := s.Run(command, p.Root, sys.Options{KillGroupOnExit: true, Timeout: timeout})
		c := map[string]any{"wall_ms": time.Since(began).Milliseconds(), "status": res.Status, "output": res.Output, "timed_out": res.TimedOut}
		if err != nil {
			c["error"] = err.Error()
		}
		if server != "" {
			var left []int
			for deadline := time.Now().Add(5 * time.Second); len(left) == 0 && time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
				left = sweepStepsServers(server, preexisting)
			}
			c["servers"] = len(left)
			for _, pid := range left {
				syscall.Kill(pid, syscall.SIGKILL)
			}
			for deadline := time.Now().Add(5 * time.Second); len(sweepStepsServers(server, preexisting)) > 0 && time.Now().Before(deadline); time.Sleep(50 * time.Millisecond) {
			}
		}
		controls = append(controls, c)
	}
	result["control"] = controls

	baseline := maps.Clone(preexisting)
	for _, pid := range sweepStepsServers(server, nil) {
		baseline[pid] = true
	}
	bystander := 0
	if words := strings.Fields(os.Getenv("SWEEPSTEPS_BYSTANDER")); len(words) > 0 {
		by := exec.Command(words[0], words[1:]...)
		by.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
		if err := by.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { by.Process.Kill(); by.Wait() })
		bystander = by.Process.Pid
	}

	log := &sweepStepsLog{server: server, baseline: baseline, atResult: map[string]int{}}
	ctx := context.Background()
	var err error
	switch mode {
	case "verify", "quiet":
		for n := 1; n <= passes && err == nil; n++ {
			in := p.input(n)
			in.Log = log
			log.setPass(n)
			_, err = Verify(ctx, s, in)
		}
	case "readiness", "timeout":
		r := p.readiness()
		r.Log = log
		a := NewAttempt(p.Root, fixtureSlug, nil)
		if timeout > 0 {
			a.timeout = timeout
		}
		r.Attempt = a
		_, err = r.Check(ctx, s, fixtureSlug)
		steps := []map[string]any{}
		for _, st := range a.steps {
			steps = append(steps, map[string]any{"name": st.Name, "status": st.Status})
		}
		result["attempt"] = steps
	default:
		t.Fatalf("unknown SWEEPSTEPS_MODE %q", mode)
	}
	if err != nil {
		result["error"] = err.Error()
		if e, ok := sys.AsError(err); ok {
			result["error_reason"] = e.Reason
		}
	}
	if server != "" {
		time.Sleep(time.Second)
		result["final_servers"] = len(sweepStepsServers(server, baseline))
	}
	if bystander != 0 {
		result["bystander"] = sweepStepsState(bystander)
	}
	if e := sweepStepsPSFailure(); e != "" {
		result["ps_error"] = e
	}
	log.mu.Lock()
	result["events"] = log.events
	result["at_result"] = log.atResult
	log.mu.Unlock()
	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, b, 0o600); err != nil {
		t.Fatal(err)
	}
}

// sweepStepsLog keeps every event with its pass, arrival time, sorted field names and encoded
// size. At each command_result it waits 300 ms, then counts the running servers not in baseline.
type sweepStepsLog struct {
	mu       sync.Mutex
	server   string
	baseline map[int]bool
	pass     int
	events   []map[string]any
	atResult map[string]int
}

func (l *sweepStepsLog) setPass(n int) {
	l.mu.Lock()
	l.pass = n
	l.mu.Unlock()
}

func (l *sweepStepsLog) Log(event map[string]any) {
	at := time.Now()
	line, _ := json.Marshal(event)
	l.mu.Lock()
	e := map[string]any{"pass": l.pass, "at_ms": at.UnixMilli(), "fields": slices.Sorted(maps.Keys(event)), "bytes": len(line), "event": event}
	l.events = append(l.events, e)
	l.mu.Unlock()
	if event["event"] == "command_result" && l.server != "" {
		time.Sleep(300 * time.Millisecond)
		name, _ := event["name"].(string)
		n := len(sweepStepsServers(l.server, l.baseline))
		l.mu.Lock()
		l.atResult[name] = n
		l.mu.Unlock()
	}
}

var sweepStepsPS = regexp.MustCompile(`^\s*(\d+)\s+(\S+)\s+(.*)$`)

// sweepStepsPSError is the first failure to list the processes; the report carries it, so a
// listing that failed is never read as "no server running".
var (
	sweepStepsPSMu    sync.Mutex
	sweepStepsPSError string
)

func sweepStepsPSFailure() string {
	sweepStepsPSMu.Lock()
	defer sweepStepsPSMu.Unlock()
	return sweepStepsPSError
}

// sweepStepsServers lists the running (not zombie) processes, other than those in skip, whose
// arguments are server or end in it after a space or a slash.
func sweepStepsServers(server string, skip map[int]bool) []int {
	if server == "" {
		return nil
	}
	out, err := exec.Command("ps", "-axo", "pid=,stat=,args=").Output()
	if err != nil {
		sweepStepsPSMu.Lock()
		if sweepStepsPSError == "" {
			sweepStepsPSError = "ps -axo pid=,stat=,args=: " + err.Error()
		}
		sweepStepsPSMu.Unlock()
		return nil
	}
	var pids []int
	for _, line := range strings.Split(string(out), "\n") {
		m := sweepStepsPS.FindStringSubmatch(line)
		if m == nil || strings.HasPrefix(m[2], "Z") {
			continue
		}
		args := strings.TrimSpace(m[3])
		if args != server && !strings.HasSuffix(args, " "+server) && !strings.HasSuffix(args, "/"+server) {
			continue
		}
		if pid, _ := strconv.Atoi(m[1]); !skip[pid] {
			pids = append(pids, pid)
		}
	}
	return pids
}

// sweepStepsState is "running" for a live process and "stopped" for one that is gone or a zombie.
func sweepStepsState(pid int) string {
	out, err := exec.Command("ps", "-o", "stat=", "-p", strconv.Itoa(pid)).Output()
	if st := strings.TrimSpace(string(out)); err != nil || st == "" || strings.HasPrefix(st, "Z") {
		return "stopped"
	}
	return "running"
}
