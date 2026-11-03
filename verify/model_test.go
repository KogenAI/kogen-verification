package verify

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

func TestModelRequiresExecutedTestsAndAllowsNoTests(t *testing.T) {
	dir := t.TempDir()
	// A successful runner with no test output cannot establish execution.
	runner := filepath.Join(dir, "runner")
	if err := os.WriteFile(runner, []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		source, want string
		count        int
	}{
		{"module model { run TestExample = true }", "failed", 1},
		{"module model { val Safe = true }", "ok", 0},
		{"module model { // run FakeTest = true\n val Safe = true }", "ok", 0},
		{"module model { run /* comment */ TestExample = true }", "failed", 1},
	} {
		if err := os.WriteFile(filepath.Join(dir, "model.qnt"), []byte(tc.source), 0644); err != nil {
			t.Fatal(err)
		}
		log := &memLog{}
		got, err := CheckModel(context.Background(), sessionFor(dir), dir, Tools{Node: runner, Quint: "unused"}, &project.ModelSpec{Path: "model.qnt"}, nil, log)
		if err != nil {
			t.Fatal(err)
		}
		eq(t, "state", got.State, tc.want)
		n := 0
		for _, event := range log.named("command_result") {
			if count, ok := event["executed_test_count"]; ok {
				n++
				eq(t, "executions", count, 0)
			}
		}
		eq(t, "test commands", n, tc.count)
	}
}
