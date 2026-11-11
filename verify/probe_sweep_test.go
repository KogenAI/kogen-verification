//go:build linux || darwin

package verify

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

type slowProbeLog struct{ events []map[string]any }

func (l *slowProbeLog) Log(e map[string]any) {
	l.events = append(l.events, e)
	time.Sleep(400 * time.Millisecond)
}

func TestProbeSweepsEscapedChildAndPreservesAccounting(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "input"), []byte("before"), 0600); err != nil {
		t.Fatal(err)
	}
	pidfile := filepath.Join(t.TempDir(), "pid")
	bystander := exec.Command("sleep", "120")
	bystander.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := bystander.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { bystander.Process.Kill(); bystander.Wait() }()
	// The child closes its output but retains both the environment and marker descriptor.
	command := fmt.Sprintf(`python3 -c 'import os,time
if os.fork()==0:
 os.setsid(); open(%q,"w").write(str(os.getpid())); os.close(1); os.close(2); time.sleep(120)' & sleep 0.3; printf changed > input; echo launched`, pidfile)
	log := &slowProbeLog{}
	start := time.Now()
	r, err := (Probe{Root: root, Command: command, Inputs: map[string]string{"input": sha("before")}, Log: log}).Run(context.Background(), sessionFor(root))
	elapsed := time.Since(start)
	data, readErr := os.ReadFile(pidfile)
	if readErr != nil {
		t.Fatal(readErr)
	}
	pid, parseErr := strconv.Atoi(strings.TrimSpace(string(data)))
	if parseErr != nil {
		t.Fatal(parseErr)
	}
	defer syscall.Kill(pid, syscall.SIGKILL)
	procs, errProcs := listProcs()
	if errProcs != nil {
		t.Fatal(errProcs)
	}
	for _, p := range procs {
		if p.pid == pid && !p.zombie {
			t.Fatalf("escaped child %d still alive", pid)
		}
	}
	if err := syscall.Kill(bystander.Process.Pid, 0); err != nil {
		t.Fatalf("bystander stopped: %v", err)
	}
	if err != nil || r.Status != 0 || r.TimedOut || r.Output != "launched\n" || len(r.InputChanges) != 1 || r.InputChanges[0] != "input" {
		t.Fatalf("result %+v err %v", r, err)
	}
	if r.Wall < 0.2 || elapsed.Seconds()-r.Wall < 0.3 {
		t.Fatalf("wall %v includes sweep/log overhead, elapsed %v", r.Wall, elapsed)
	}
	if len(log.events) != 1 || log.events[0]["name"] != "probe" || log.events[0]["event"] != "step_sweep" {
		t.Fatalf("events: %+v", log.events)
	}
}

func TestProbeRefusalsDoNotLogSweep(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	log := &sweepLog{}
	r, err := (Probe{Root: root, Command: "kill 1", Log: log}).Run(context.Background(), sessionFor(root))
	if err != nil || r.Status != 126 || len(log.events) != 0 {
		t.Fatalf("result %+v err %v events %+v", r, err, log.events)
	}
	_, err = (Probe{Root: root, Command: "true", Log: log, Files: []ProbeFile{{Path: "../outside"}}}).Run(context.Background(), sessionFor(root))
	if err == nil || len(log.events) != 0 {
		t.Fatalf("err %v events %+v", err, log.events)
	}
}
