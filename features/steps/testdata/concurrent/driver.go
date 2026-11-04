package verify

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

// The marker records real check completion, including custody cleanup, rather
// than guessing that a shell's last write means its result has reached Verify.
type concurrentIntentLog struct{ aux string }

func (l concurrentIntentLog) Log(e map[string]any) {
	if e["event"] == "command_result" && e["name"] == "vet" {
		// A failed write leaves the bounded rendezvous red; it cannot false-pass.
		_ = os.WriteFile(filepath.Join(l.aux, "vet.recorded"), []byte("done\n"), 0600)
	}
}

// This acceptance-only driver is overlaid into package verify so it can reuse
// the existing synthetic repository and Cucumber-message fixtures.
func TestConcurrentIntentDriver(t *testing.T) {
	mode := os.Getenv("CONCURRENT_CASE")
	report := os.Getenv("CONCURRENT_REPORT")
	if report == "" {
		t.Fatal("CONCURRENT_REPORT required")
	}
	p := newProj(t)
	aux := t.TempDir()
	bin := filepath.Join(aux, "bin")
	if err := os.Mkdir(bin, 0700); err != nil {
		t.Fatal(err)
	}
	q := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'" }
	// All rendezvous loops are bounded. Their expiry is a failed fixture/check,
	// not evidence of overlap. No project command or production option is added.
	script := "#!/bin/sh\nset -eu\nd=" + q(aux) + "\nn=$1\nprintf '%s\\n' \"$$\" > \"$d/$n.pid\"\ntouch \"$d/$n.started\"\n"
	script += "waitfor() { i=0; while test ! -e \"$d/$1\"; do i=$((i+1)); if test $i -ge 200; then echo rendezvous-expired; exit 91; fi; sleep 0.01; done; }\n"
	switch mode {
	case "overlap":
		script += "waitfor build.started; waitfor vet.started; printf '%s-output\\n' \"$n\"\n"
	case "speculative":
		script += "if test \"$n\" = build; then waitfor vet.recorded; echo build-output; exit 17; fi\necho vet-output; exit 19\n"
	case "ordered":
		script += "if test \"$n\" = build; then waitfor vet.recorded; echo build-output; exit 0; fi\necho vet-output; exit 19\n"
	case "cancel":
		script += "if test \"$n\" = build; then waitfor child.pid; echo build-output; exit 17; fi\nsleep 30 & child=$!; echo vet-partial; echo $child > \"$d/child.pid\"; wait\n"
	case "cheap", "handoff":
		script += "echo unexpected-go; exit 92\n"
	default:
		t.Fatalf("unknown case %q", mode)
	}
	if err := os.WriteFile(filepath.Join(bin, "go"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	p.Env = append(p.Env, "PATH="+bin+":"+os.Getenv("PATH"))
	p.Config.Checks = []project.Check{{Name: "compile", Run: "go build ./..."}, {Name: "vet", Run: "go vet ./..."}, {Name: "tail", Run: "echo tail"}}
	if mode == "cheap" {
		p.Config.Checks = append([]project.Check{{Name: "format", Run: "echo cheap-output; exit 7"}}, p.Config.Checks...)
	}
	if mode == "handoff" {
		p.Config.Checks = []project.Check{{Name: "producer", Run: "mkdir -p build; echo payload > build/handoff"}, {Name: "consumer", Run: "cat build/handoff"}}
	}
	s := sys.NewWith(p.Env, p.Root)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	// A different command in the caller's Session must not become a check's
	// watcher or cancellation target. Keep it live until the pass has returned.
	byCtx, byCancel := context.WithCancel(context.Background())
	byDone := make(chan error, 1)
	go func() {
		_, e := s.RunContext(byCtx, "echo $$ > "+q(filepath.Join(aux, "bystander.pid"))+"; exec sleep 30", aux, sys.Options{})
		byDone <- e
	}()
	defer func() { byCancel(); <-byDone }()
	deadline := time.Now().Add(3 * time.Second)
	for {
		if _, e := os.Stat(filepath.Join(aux, "bystander.pid")); e == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("bystander failed to start")
		}
		time.Sleep(time.Millisecond)
	}
	in := p.input(1)
	in.Log = concurrentIntentLog{aux: aux}
	pass, err := Verify(ctx, s, in)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	alive := func(file string) bool {
		b, e := os.ReadFile(filepath.Join(aux, file))
		if e != nil {
			return false
		}
		out, e := exec.Command("ps", "-o", "stat=", "-p", strings.TrimSpace(string(b))).CombinedOutput()
		return e == nil && strings.TrimSpace(string(out)) != "" && !strings.HasPrefix(strings.TrimSpace(string(out)), "Z")
	}
	exists := func(file string) bool { _, e := os.Stat(filepath.Join(aux, file)); return e == nil }
	result := map[string]any{"pass": pass, "feedback": pass.Feedback("fixture acceptance", "finish"), "build_started": exists("build.started"), "vet_started": exists("vet.started"), "child_alive": alive("child.pid"), "bystander_alive": alive("bystander.pid")}
	b, e := json.Marshal(result)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(report, b, 0600); e != nil {
		t.Fatal(e)
	}
	fmt.Println("concurrent driver report written")
}
