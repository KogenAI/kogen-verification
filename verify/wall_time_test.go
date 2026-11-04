package verify

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
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
}

func TestWallTimeDeadlineAndNeverStarted(t *testing.T) {
	p := newProj(t)
	p.Config.Setup = []string{"sleep 30", "echo never"}
	s, _ := p.session()
	log := &memLog{}
	in := p.input(1)
	in.Log = log
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	_, err := Verify(ctx, s, in)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline: %v", err)
	}
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
