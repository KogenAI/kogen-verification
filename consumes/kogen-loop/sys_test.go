package kogenloop_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
)

func TestCommand(t *testing.T) {
	// The shell reports $PWD with symlinks resolved (/var is /private/var on macOS).
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := sys.NewWith([]string{"PATH=/bin:/usr/bin", "VALUE=base"}, dir)
	if s.Getenv("VALUE") != "base" {
		t.Fatal(s.Env)
	}
	r, err := s.RunContext(context.Background(), `printf '%s:%s:' "$VALUE" "$PWD"; printf err >&2; exit 7`, dir, sys.Options{Env: map[string]string{"VALUE": "extra"}, KillGroupOnExit: true})
	if err != nil || r.Status != 7 || r.Output != "extra:"+dir+":err" || r.TimedOut || r.Rule != "" {
		t.Fatalf("%+v %v", r, err)
	}
	r, err = s.RunContext(context.Background(), "if read x; then printf open; else printf closed; fi", dir, sys.Options{})
	if err != nil || r.Status != 0 || r.Output != "closed" {
		t.Fatalf("%+v %v", r, err)
	}
	r, err = s.RunContext(context.Background(), "printf start; exec sleep 5", dir, sys.Options{Timeout: 100 * time.Millisecond, KillGroupOnExit: true})
	if err != nil || !r.TimedOut || !strings.Contains(r.Output, "start") {
		t.Fatalf("%+v %v", r, err)
	}
	if len(s.Groups()) == 0 {
		t.Fatal("command groups were not recorded")
	}
	if len(s.LiveGroups()) != 0 {
		t.Fatal(s.LiveGroups())
	}
}
func TestInterruptAndError(t *testing.T) {
	s := sys.NewWith(nil, t.TempDir())
	ctx := s.Context()
	if !s.Interrupt("SIGINT") || s.Interrupt("SIGTERM") {
		t.Fatal("interrupt")
	}
	select {
	case <-ctx.Done():
	default:
		t.Fatal("session context was not cancelled")
	}
	var intr *sys.Interrupted
	if !errors.As(s.Err(), &intr) || intr.Signal != "SIGINT" {
		t.Fatal(s.Err())
	}
	_, err := s.RunContext(context.Background(), "true", s.Cwd, sys.Options{})
	if !errors.As(err, &intr) {
		t.Fatal(err)
	}
	e := sys.Fail("intent", "not_ready", "bad", 1)
	e.Lines = []string{"detail"}
	got, ok := sys.AsError(fmt.Errorf("wrapped: %w", e))
	if !ok || got.Class != "intent" || got.Reason != "not_ready" || got.Detail != "bad" || got.Exit != 1 || got.Render() != "intent/not_ready: bad\n  detail\n" {
		t.Fatal(got)
	}
	if !errors.Is(fmt.Errorf("wrap: %w", sys.ErrTimeoutObservation), sys.ErrTimeoutObservation) {
		t.Fatal("timeout identity")
	}
}
func TestTmpPath(t *testing.T) {
	p := sys.TmpPath("verify-contract")
	defer os.RemoveAll(p)
	if filepath.Base(p) == "" {
		t.Fatal(p)
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatal(err)
	}
}
