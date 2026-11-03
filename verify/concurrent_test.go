package verify

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"kogen-loop/sys"

	"github.com/KogenAI/kogen-coordinator/project"
)

func TestIndependentGoCommands(t *testing.T) {
	for _, tc := range []struct {
		command, flags string
		want           bool
	}{
		{"go build ./...", "", true}, {"go vet ./...", "-trimpath", true},
		{"GOFLAGS=-trimpath go build ./...", "-toolexec=bad", true},
		{"GOFLAGS=-trimpath go vet ./...", "", true},
		{"go build ./...", "-toolexec=bad", false}, {"go vet ./...", "-mod=mod", false},
		{"echo go build ./...", "", false}, {"go test ./...", "", false},
	} {
		s := sys.NewWith([]string{"GOFLAGS=" + tc.flags}, ".")
		if got := independentGo(tc.command, s); got != tc.want {
			t.Errorf("%q GOFLAGS=%q: got %v", tc.command, tc.flags, got)
		}
	}
}

func TestSpeculativeRecordRoundTrip(t *testing.T) {
	p := Pass{N: 1, Model: ModelNone, Speculative: []CommandResult{{Name: "vet", Command: "go vet ./...", Output: "completed\n"}}, Cancelled: []CommandResult{{Name: "later", Command: "go build ./...", Status: -1, Output: "partial\n"}}}
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	var got Pass
	if err = json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(p.Speculative, got.Speculative) || !reflect.DeepEqual(p.Cancelled, got.Cancelled) {
		t.Fatalf("round trip: %s", b)
	}
	for _, text := range []string{"Speculative results", "completed", "Cancelled work", "partial"} {
		if !strings.Contains(got.Feedback("", ""), text) {
			t.Fatalf("missing %q", text)
		}
	}
}

func TestOwnedWatchDoesNotFollowOtherLiveSession(t *testing.T) {
	shortenGrace(t, 50*time.Millisecond)
	dir := t.TempDir()
	ended := sys.NewWith(testEnv(), dir)
	live := sys.NewWith(testEnv(), dir)
	if _, err := ended.Run("true", dir, sys.Options{}); err != nil {
		t.Fatal(err)
	}
	ready := filepath.Join(dir, "ready")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = live.RunContext(ctx, "echo ready > "+shellQuote(ready)+"; exec sleep 30", dir, sys.Options{})
	}()
	t.Cleanup(func() { cancel(); <-done })
	deadline := time.After(3 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		select {
		case <-deadline:
			t.Fatal("live command did not start")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	_, err := awaitResult(ended, nil, "ended", "true", nil, make(chan outcome))
	e, ok := sys.AsError(err)
	if !ok || e.Reason != "command_no_progress" {
		t.Fatalf("watch error: %v", err)
	}
	select {
	case <-done:
		t.Fatal("unrelated live command was stopped")
	default:
	}
}

type vetRecorded struct{ dir string }

func (l vetRecorded) Log(e map[string]any) {
	if e["event"] == "command_result" && e["name"] == "vet" {
		_ = os.WriteFile(filepath.Join(l.dir, "recorded"), []byte("yes"), 0600)
	}
}

func TestSuccessfulSpeculationRetained(t *testing.T) {
	p := newProj(t)
	aux := t.TempDir()
	bin := filepath.Join(aux, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nif test \"$1\" = vet; then echo success; exit 0; fi\ni=0; while ! test -f " + shellQuote(filepath.Join(aux, "recorded")) + "; do i=$((i+1)); test $i -lt 200 || exit 90; sleep .01; done\necho failure; exit 17\n"
	if err := os.WriteFile(filepath.Join(bin, "go"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	p.Env = append(p.Env, "PATH="+bin+":"+os.Getenv("PATH"))
	p.Config.Checks = []project.Check{{Name: "build", Run: "go build ./..."}, {Name: "vet", Run: "go vet ./..."}, {Name: "tail", Run: "true"}}
	s := sys.NewWith(p.Env, p.Root)
	in := p.input(1)
	in.Log = vetRecorded{aux}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pass, err := Verify(ctx, s, in)
	if err != nil {
		t.Fatal(err)
	}
	if len(pass.Checks) != 1 || pass.Checks[0].Name != "build" || pass.Checks[0].Status != 17 || len(pass.Speculative) != 1 || pass.Speculative[0].Name != "vet" || pass.Speculative[0].Output != "success\n" || len(pass.NotRun) != 1 || pass.NotRun[0] != "tail" {
		t.Fatalf("pass: %+v", pass)
	}
}

func TestCohortCancellationAtLaunch(t *testing.T) {
	dir := t.TempDir()
	parent := sys.NewWith(testEnv(), dir)
	stop := make(chan struct{})
	close(stop)
	result := runCohortCheck(context.Background(), stop, parent, Input{}, dir, item{name: "vet", command: "echo partial; exec sleep 30"})
	if result.err != nil {
		t.Fatal(result.err)
	}
	if !result.neverStarted && (!result.cancelled || result.result.Status != -1) {
		t.Fatalf("launch cancellation: %+v", result)
	}
}

func TestCohortCallerInterruptJoins(t *testing.T) {
	dir := t.TempDir()
	parent := sys.NewWith(testEnv(), dir)
	ready := filepath.Join(dir, "ready")
	answer := make(chan cohortResult, 1)
	go func() {
		answer <- runCohortCheck(context.Background(), make(chan struct{}), parent, Input{}, dir, item{name: "vet", command: "echo ready > " + shellQuote(ready) + "; exec sleep 30"})
	}()
	deadline := time.After(3 * time.Second)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		select {
		case <-deadline:
			t.Fatal("command did not start")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	parent.Interrupt("SIGINT")
	select {
	case result := <-answer:
		var interrupted *sys.Interrupted
		if !errors.As(result.err, &interrupted) || interrupted.Signal != "SIGINT" {
			t.Fatalf("interrupt: %+v", result)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("interrupt did not join")
	}
}

func TestCustomChecksAndOverridesKeepHandoffs(t *testing.T) {
	for _, mode := range []string{"names", "override"} {
		t.Run(mode, func(t *testing.T) {
			p := newProj(t)
			if mode == "names" {
				p.Config.Checks = []project.Check{{Name: "compile", Run: "mkdir -p build; echo payload > build/value"}, {Name: "vet", Run: "cat build/value"}}
			} else {
				bin := t.TempDir()
				script := "#!/bin/sh\nif test \"$1\" = build; then mkdir -p build; echo payload > build/value; else cat build/value; fi\n"
				if err := os.WriteFile(filepath.Join(bin, "go"), []byte(script), 0700); err != nil {
					t.Fatal(err)
				}
				p.Env = append(p.Env, "PATH="+bin+":"+os.Getenv("PATH"), "GOFLAGS=-toolexec=not-standard")
				p.Config.Checks = []project.Check{{Name: "compile", Run: "go build ./..."}, {Name: "vet", Run: "go vet ./..."}}
			}
			s := sys.NewWith(p.Env, p.Root)
			pass, err := Verify(context.Background(), s, p.input(1))
			if err != nil {
				t.Fatal(err)
			}
			if !pass.Green || len(pass.Checks) != 2 || pass.Checks[1].Output != "payload\n" {
				t.Fatalf("handoff: %+v", pass)
			}
		})
	}
}
