//go:build linux || darwin

package verify

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestProbeRealTimeoutEscaped(t *testing.T) {
	root := t.TempDir()
	pidfile := filepath.Join(t.TempDir(), "pid")
	_, restore := ContractProbeDeadline(1500*time.Millisecond, nil)
	defer restore()
	ctx, cancel := context.WithTimeout(context.Background(), 11*time.Second)
	defer cancel()
	log := &sweepLog{}
	command := fmt.Sprintf("python3 -c 'import os,time\nif os.fork()==0:\n os.setsid(); open(%q,\"w\").write(str(os.getpid())); time.sleep(120)' & sleep 1; echo launched; sleep 120", pidfile)
	r, err := (Probe{Root: root, Command: command, Log: log}).Run(ctx, sessionFor(root))
	if err != nil || !r.TimedOut {
		t.Fatalf("r=%+v err=%v", r, err)
	}
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
	if len(log.events) != 1 || log.events[0]["event"] != "step_sweep" || log.events[0]["name"] != "probe" {
		t.Fatalf("events: %+v", log.events)
	}
}
