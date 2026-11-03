package verify

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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

func TestModelInvariantDeclarations(t *testing.T) {
	for _, tc := range []struct {
		name       string
		invariants []string
		wantState  string
		wantCalls  string
		invalid    string
	}{
		{"comma", []string{"A", "A,B", "C"}, "failed", "", "A,B"},
		{"space", []string{"A", "A B", "C"}, "failed", "", "A B"},
		{"tab", []string{"A", "A\tB", "C"}, "failed", "", "A\\tB"},
		{"newline", []string{"A", "A\nB", "C"}, "failed", "", "A\\nB"},
		{"duplicates", []string{"A", "B", "B", "C", "A"}, "ok", "typecheck\nA\nB\nC\n", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "model.qnt"), []byte("module model { val Safe = true }"), 0644); err != nil {
				t.Fatal(err)
			}
			runner := filepath.Join(dir, "runner")
			script := "#!/bin/sh\nshift\nif [ \"$1\" = typecheck ]; then echo typecheck >> calls; else echo \"$6\" >> calls; fi\n"
			if err := os.WriteFile(runner, []byte(script), 0755); err != nil {
				t.Fatal(err)
			}
			got, err := CheckModel(context.Background(), sessionFor(dir), dir, Tools{Node: runner, Quint: "unused"}, &project.ModelSpec{Path: "model.qnt", Invariants: tc.invariants}, nil, &memLog{})
			if err != nil {
				t.Fatal(err)
			}
			eq(t, "state", got.State, tc.wantState)
			calls, err := os.ReadFile(filepath.Join(dir, "calls"))
			if err != nil && !os.IsNotExist(err) {
				t.Fatal(err)
			}
			eq(t, "calls", string(calls), tc.wantCalls)
			if tc.invalid != "" {
				if len(got.Problems) != 1 || strings.ContainsAny(got.Problems[0], "\r\n") || !strings.Contains(got.Problems[0], tc.invalid) {
					t.Fatalf("problems: %#v", got.Problems)
				}
			}
		})
	}
}
