package verify

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"kogen-loop/sys"
)

// Installed only in an isolated acceptance copy as verify/shapetimeout_acceptance_test.go. It runs
// one bounded Shape readiness check (BoundShapeAcceptance) of the real fixture project, with a
// contracted acceptance bound and optionally a caller approval Attempt, and writes the refusal
// and every retained attempt record it finds to SHAPETIMEOUT_RESULT.
func TestShapeTimeoutAcceptanceDriver(t *testing.T) {
	out := os.Getenv("SHAPETIMEOUT_RESULT")
	if out == "" {
		t.Fatal("SHAPETIMEOUT_RESULT is required")
	}
	bound, err := strconv.Atoi(os.Getenv("SHAPETIMEOUT_BOUND_MS"))
	if err != nil || bound <= 0 {
		t.Fatalf("SHAPETIMEOUT_BOUND_MS must be a positive number of milliseconds: %q", os.Getenv("SHAPETIMEOUT_BOUND_MS"))
	}
	p := newProj(t)
	if command := os.Getenv("SHAPETIMEOUT_COMMAND"); command != "" {
		if os.Getenv("SHAPETIMEOUT_RED_REPORT") == "1" {
			command = "cp '" + p.Red + "' \"$KOGEN_ACCEPTANCE_REPORT\"; " + command
		}
		p.Config.Acceptance.Run = command
	}
	_, restore := ContractShapeAcceptanceDeadline(time.Duration(bound) * time.Millisecond)
	defer restore()
	r := p.readiness()
	r.BoundShapeAcceptance = true
	if os.Getenv("SHAPETIMEOUT_ATTEMPT") == "1" {
		a := NewAttempt(p.Root, fixtureSlug, nil)
		a.timeout = time.Duration(bound) * time.Millisecond
		r.Attempt = a
	}
	s, _ := p.session()
	began := time.Now().UTC()
	ready, err := r.Check(context.Background(), s, fixtureSlug)
	ended := time.Now().UTC()
	result := map[string]any{"root": p.Root, "bound_ms": bound, "command": p.Config.Acceptance.Run, "began": began, "ended": ended, "refused": err != nil}
	if ready != nil {
		result["acceptance_exit"] = ready.AcceptanceExit
		result["failures"] = ready.Failures()
	}
	if err != nil {
		result["text"] = err.Error()
		if e, ok := sys.AsError(err); ok {
			result["class"], result["reason"], result["detail"], result["exit"] = e.Class, e.Reason, e.Detail, e.Exit
			result["lines"] = append([]string{}, e.Lines...)
			result["text"] = e.Render()
		}
	}
	paths, err := filepath.Glob(filepath.Join(p.Root, ".kogen/local/readiness/attempts/*/attempt.json"))
	if err != nil {
		t.Fatal(err)
	}
	records := []map[string]any{}
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		file, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		dir, err := os.Stat(filepath.Dir(path))
		if err != nil {
			t.Fatal(err)
		}
		records = append(records, map[string]any{"path": path, "file_mode": int(file.Mode().Perm()), "dir_mode": int(dir.Mode().Perm()), "record": json.RawMessage(b)})
	}
	result["records"] = records
	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, b, 0600); err != nil {
		t.Fatal(err)
	}
}
