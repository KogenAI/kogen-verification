package verify

import (
	"context"
	"testing"
	"time"
)

func TestProbeRealTimeoutEscaped(t *testing.T) {
	root := t.TempDir()
	_, restore := ContractProbeDeadline(1500*time.Millisecond, nil)
	defer restore()
	ctx, cancel := context.WithTimeout(context.Background(), 11*time.Second)
	defer cancel()
	r, err := (Probe{Root: root, Command: "python3 -c 'import os,time\nif os.fork()==0:\n os.setsid(); time.sleep(120)' & sleep 1; echo launched; sleep 120"}).Run(ctx, sessionFor(root))
	if err != nil || !r.TimedOut {
		t.Fatalf("r=%+v err=%v", r, err)
	}
}
