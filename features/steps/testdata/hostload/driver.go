package verify

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
)

// Installed only in an isolated acceptance copy; uses the real readiness fixture.
func TestHostLoadAcceptanceDriver(t *testing.T) {
	out := os.Getenv("HOSTLOAD_RESULT")
	if out == "" {
		t.Fatal("HOSTLOAD_RESULT is required")
	}
	p := newProj(t)
	p.Config.Setup = []string{"echo setup"}
	mode := os.Getenv("HOSTLOAD_MODE")
	if mode == "timeout" {
		p.Config.Setup = []string{"sleep 2"}
	}
	if mode == "failed" {
		p.Config.Setup = []string{"exit 7"}
	}
	r := p.readiness()
	a := NewAttempt(p.Root, fixtureSlug, nil)
	if mode == "timeout" {
		a.timeout = 100 * time.Millisecond
	}
	r.Attempt = a
	s, _ := p.session()
	began := time.Now().UTC()
	_, err := r.Check(context.Background(), s, fixtureSlug)
	ended := time.Now().UTC()
	text := ""
	if mode == "passed" {
		if err != nil {
			t.Fatal(err)
		}
	} else {
		if err == nil {
			t.Fatal("expected refusal")
		}
		text = err.Error()
		if e, ok := sys.AsError(err); ok {
			text = e.Render()
		}
	}
	paths, err := filepath.Glob(filepath.Join(p.Root, ".kogen/local/readiness/attempts/*/attempt.json"))
	if err != nil {
		t.Fatal(err)
	}
	records := []json.RawMessage{}
	private := true
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		records = append(records, json.RawMessage(b))
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		private = private && info.Mode().Perm() == 0600
		info, err = os.Stat(filepath.Dir(path))
		if err != nil {
			t.Fatal(err)
		}
		private = private && info.Mode().Perm() == 0700
	}
	names := []string{}
	for _, st := range a.steps {
		names = append(names, st.Name)
	}
	result := map[string]any{"records": records, "executed": names, "private": private, "text": text, "began": began, "ended": ended}
	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, b, 0600); err != nil {
		t.Fatal(err)
	}
}
