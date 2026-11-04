package verify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
	_ "unsafe"

	"github.com/KogenAI/kogen-loop/sys"
)

// This hook already exists in the pinned sys dependency. Link only in the isolated
// acceptance test binary; do not add a production hook or change module-cache bytes.
//
//go:linkname cancelCommandStartHook github.com/KogenAI/kogen-loop/sys.startHook
var cancelCommandStartHook func(string)

func cancelCommandAlive(pid int) (bool, error) {
	out, err := exec.Command("ps", "-o", "stat=", "-p", strconv.Itoa(pid)).CombinedOutput()
	state := strings.TrimSpace(string(out))
	if state == "" {
		if err == nil {
			return false, nil
		}
		if e, ok := err.(*exec.ExitError); ok && e.ExitCode() == 1 {
			return false, nil
		}
		return false, fmt.Errorf("ps: %v: %s", err, out)
	}
	if err != nil {
		return false, fmt.Errorf("ps: %v: %s", err, out)
	}
	return !strings.HasPrefix(state, "Z"), nil
}

// TestCancelCommandDriver emits observations, not test-runner summary evidence.
// The JS harness requires a nonce-bound report and judges the real outcomes.
func TestCancelCommandDriver(t *testing.T) {
	out := os.Getenv("CANCEL_REPORT")
	if out == "" {
		t.Fatal("CANCEL_REPORT required")
	}
	route, mode, control := os.Getenv("CANCEL_ROUTE"), os.Getenv("CANCEL_MODE"), os.Getenv("CANCEL_CONTROL")
	dir := t.TempDir()
	s := sys.NewWith(append(os.Environ(), "HOME="+dir), dir)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	by := exec.Command("sleep", "60")
	by.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := by.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { by.Process.Kill(); by.Wait() }()
	byBefore, err := cancelCommandAlive(by.Process.Pid)
	if err != nil {
		t.Fatal(err)
	}
	q := func(name string) string { return shellQuote(filepath.Join(dir, name)) }
	command := "(sleep 0.6 & echo $! > " + q("grandchild") + "; wait; echo late > " + q("second") + ") & echo $! > " + q("child") + "; echo $$ > " + q("parent") + "; while test ! -s " + q("grandchild") + "; do sleep 0.001; done; echo ready > " + q("ready") + "; wait"
	if mode == "success" || mode == "nonzero" {
		status := "0"
		if mode == "nonzero" {
			status = "7"
		}
		command = "printf 'original\\n'; exit " + status
	}
	if mode == "before" || mode == "interrupt-before" {
		cancel()
	}
	if mode == "interrupt-before" {
		s.Interrupt("SIGINT")
	}
	handoff := 0
	cancelCommandStartHook = func(stage string) {
		if stage == mode {
			handoff++
			cancel()
		}
	}
	defer func() { cancelCommandStartHook = nil }()
	old, restore := ContractProbeDeadline(150*time.Millisecond, nil)
	defer restore()
	if mode != "timeout" {
		_, undo := ContractProbeDeadline(old, nil)
		defer undo()
	}
	type answer struct {
		status int
		output string
		timed  bool
		err    error
	}
	done := make(chan answer, 1)
	go func() {
		if control != "" {
			opts := sys.Options{KillGroupOnExit: true, Context: ctx}
			if mode == "timeout" {
				opts.Timeout = 150 * time.Millisecond
			}
			var r sys.Result
			var e error
			if control == "good" {
				r, e = s.RunContext(ctx, command, dir, opts)
			} else {
				r, e = s.Run(command, dir, opts)
			}
			done <- answer{r.Status, r.Output, r.TimedOut, e}
			return
		}
		switch route {
		case "probe":
			r, e := (Probe{Root: t.TempDir(), Command: command}).Run(ctx, s)
			done <- answer{r.Status, r.Output, r.TimedOut, e}
		case "ordinary", "approval":
			callCtx := ctx
			if route == "approval" {
				a := NewAttempt(dir, "cancel-fixture", nil)
				if mode == "timeout" {
					a.timeout = 150 * time.Millisecond
				}
				callCtx = a.Into(ctx)
			}
			r, e := runStep(callCtx, s, Tools{}, "cancel-fixture", nil, command, dir, nil)
			var timeout *stepTimeout
			done <- answer{r.Status, r.Output, r.TimedOut || errors.As(e, &timeout), e}
		default:
			done <- answer{err: fmt.Errorf("unknown route %q", route)}
		}
	}()
	ready := func() bool { _, e := os.Stat(filepath.Join(dir, "ready")); return e == nil }
	if mode == "running" || mode == "interrupt-running" {
		deadline := time.Now().Add(10 * time.Second)
		for !ready() && time.Now().Before(deadline) {
			time.Sleep(time.Millisecond)
		}
		if !ready() {
			t.Fatal("readiness marker did not appear before cancellation")
		}
		if mode == "interrupt-running" {
			s.Interrupt("SIGINT")
		} else {
			cancel()
		}
	}
	var a answer
	select {
	case a = <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("command did not return within fixture bound")
	}
	kind := "none"
	var intr *sys.Interrupted
	var timeout *stepTimeout
	switch {
	case errors.As(a.err, &intr):
		kind = intr.Signal
	case errors.Is(a.err, context.Canceled):
		kind = "canceled"
	case errors.As(a.err, &timeout):
		kind = "timed_out"
	case a.err != nil:
		kind = a.err.Error()
	}
	live := 0
	for _, name := range []string{"parent", "child", "grandchild"} {
		b, e := os.ReadFile(filepath.Join(dir, name))
		if os.IsNotExist(e) {
			continue
		}
		pid, pe := strconv.Atoi(strings.TrimSpace(string(b)))
		if e != nil || pe != nil || pid <= 1 {
			t.Fatalf("invalid %s pid: %s: %v %v", name, b, e, pe)
		}
		alive, e := cancelCommandAlive(pid)
		if e != nil {
			t.Fatal(e)
		}
		if alive {
			live++
		}
		defer syscall.Kill(pid, syscall.SIGKILL)
	}
	byAfter, err := cancelCommandAlive(by.Process.Pid)
	if err != nil {
		t.Fatal(err)
	}
	// Deliberately wait beyond the fixture write, without cleaning up owned pids:
	// an early-return-only implementation must not pass this observation.
	time.Sleep(800 * time.Millisecond)
	_, secondErr := os.Stat(filepath.Join(dir, "second"))
	if secondErr != nil && !os.IsNotExist(secondErr) {
		t.Fatal(secondErr)
	}
	report := map[string]any{"nonce": os.Getenv("CANCEL_NONCE"), "route": route, "mode": mode, "error": kind, "status": a.status, "output": a.output, "timed_out": a.timed, "ready": ready(), "second": secondErr == nil, "live": live, "bystander": byBefore && byAfter, "handoff": handoff, "probe_limit_seconds": int(old.Seconds()), "approval_limit_seconds": int(StepTimeout.Seconds())}
	b, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, b, 0o600); err != nil {
		t.Fatal(err)
	}
}
