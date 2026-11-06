// Known-good control for k-verify-wall-time-test-clock: a verify/wall_time_test.go whose
// deadline clock starts when the first setup command starts, with a 30 s fallback deadline.
// The driver overlays it as verify/wall_time_test.go; it is not linked into production.
module.exports = String.raw`package verify

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

func requireWall(t *testing.T, events []map[string]any, names ...string) {
	t.Helper()
	if len(events) != len(names) {
		t.Fatalf("results: %v", events)
	}
	for i, e := range events {
		v, ok := e["wall_ms"].(int64)
		if e["name"] != names[i] || !ok || v < 0 {
			t.Fatalf("result: %v", e)
		}
	}
}

func TestWallTimeStageAndMaintainedFeature(t *testing.T) {
	p := newProj(t)
	s, _ := p.session()
	log := &memLog{}
	in := p.input(1)
	in.Log = log
	in.Stage = &Stage{ID: "one", Checks: []string{"true"}}
	pass, err := Verify(context.Background(), s, in)
	if err != nil || !pass.Green {
		t.Fatalf("stage: %+v %v", pass, err)
	}
	requireWall(t, log.named("command_result"), "stage-one-1")
	if _, ok := log.named("pass")[0]["checks_wall_ms"].(int64); !ok {
		t.Fatal("missing pass timing")
	}
	log = &memLog{}
	in.Log = log
	in.Stage = nil
	in.MaintainedFeatures = []string{project.FeaturePath(fixtureSlug)}
	p.write("maintained.qnt", "module maintained { val Safe = true }\n")
	runner := filepath.Join(p.Aux, "quint-stub")
	if err := os.WriteFile(runner, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	in.Tools = Tools{Node: runner, Quint: "unused"}
	in.MaintainedModels = []project.ModelSpec{{Path: "maintained.qnt", Invariants: []string{"Safe"}}}
	pass, err = Verify(context.Background(), s, in)
	if err != nil || !pass.Green {
		t.Fatalf("maintained: %+v %v", pass, err)
	}
	requireWall(t, log.named("command_result"), "acceptance", "model", "model", "acceptance")
	ids := log.named("check_identity")
	if len(ids) != 1 {
		t.Fatal(ids)
	}
	id := ids[0]
	for _, e := range log.named("command") {
		want := identityHash([]any{e["command"], id["tree"], id["tools"], id["lockfiles"], id["environment"], id["host"]})
		if e["identity_sha256"] != want {
			t.Fatal(e)
		}
	}
}

// setupClock is a context whose deadline starts with the first setup command: once armed it
// ends with context.DeadlineExceeded after its budget; it also ends when its parent does.
type setupClock struct {
	parent context.Context
	done   chan struct{}
	once   sync.Once
	mu     sync.Mutex
	err    error
	end    time.Time
}

func newSetupClock(parent context.Context) *setupClock {
	c := &setupClock{parent: parent, done: make(chan struct{})}
	context.AfterFunc(parent, func() { c.stop(parent.Err()) })
	return c
}

func (c *setupClock) arm(budget time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.end.IsZero() {
		return
	}
	c.end = time.Now().Add(budget)
	time.AfterFunc(budget, func() { c.stop(context.DeadlineExceeded) })
}

func (c *setupClock) armed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return !c.end.IsZero()
}

func (c *setupClock) stop(err error) {
	c.once.Do(func() {
		c.mu.Lock()
		c.err = err
		c.mu.Unlock()
		close(c.done)
	})
}

func (c *setupClock) Deadline() (time.Time, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.end.IsZero() {
		return c.end, true
	}
	return c.parent.Deadline()
}

func (c *setupClock) Done() <-chan struct{} { return c.done }

func (c *setupClock) Err() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.err
}

func (c *setupClock) Value(key any) any { return c.parent.Value(key) }

// setupStartLog is a memLog that arms clock when the first setup command starts.
type setupStartLog struct {
	*memLog
	clock  *setupClock
	budget time.Duration
}

func (l setupStartLog) Log(event map[string]any) {
	l.memLog.Log(event)
	if event["event"] == "command" && event["name"] == "setup-1" {
		l.clock.arm(l.budget)
	}
}

func TestWallTimeDeadlineAndNeverStarted(t *testing.T) {
	p := newProj(t)
	p.Config.Setup = []string{"sleep 30", "echo never"}
	s, _ := p.session()
	// Keep version probes fast so the deadline exercises the setup command.
	bin := t.TempDir()
	if err := os.Symlink("/bin/sleep", filepath.Join(bin, "sleep")); err != nil {
		t.Fatal(err)
	}
	s.Env = append(s.Env, "PATH="+bin)
	// The 300 ms deadline starts when setup-1 starts, so the work before it does not use the
	// budget; the 30 s fallback ends a run whose first setup command never starts.
	fallback, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	clock := newSetupClock(fallback)
	log := setupStartLog{memLog: &memLog{}, clock: clock, budget: 300 * time.Millisecond}
	in := p.input(1)
	in.Log = log
	_, err := Verify(clock, s, in)
	if !clock.armed() {
		t.Fatalf("setup-1 never started before the 30s fallback deadline: %v", err)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline: %v", err)
	}
	aborted := requireAborted(t, log.memLog, "timeout")
	eq(t, "item", aborted["item"], "setup-1")
	events := log.named("command_result")
	requireWall(t, events, "setup-1")
	ms := events[0]["wall_ms"].(int64)
	if ms < 100 || ms >= 3000 {
		t.Fatalf("elapsed %d", ms)
	}
	for _, e := range log.named("command") {
		if strings.Contains(e["name"].(string), "setup-2") {
			t.Fatal("unstarted command logged")
		}
	}
}

func TestWallTimeCancelledCohortBeforeStart(t *testing.T) {
	p := newProj(t)
	s := sys.NewWith(p.Env, p.Root)
	log := &memLog{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := runCohortCheck(ctx, make(chan struct{}), s, Input{Log: log}, p.Root, item{name: "check", command: "echo never"})
	if !errors.Is(result.err, context.Canceled) {
		t.Fatalf("error: %v", result.err)
	}
	if events := log.named("command_result"); len(events) != 0 {
		t.Fatalf("unstarted command results: %v", events)
	}
}
`;
