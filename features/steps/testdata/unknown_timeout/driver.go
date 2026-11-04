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

// Exercise the same bounded command and refusal boundary used by readiness.
func TestUnknownOutputAcceptanceDriver(t *testing.T) {
	p := newProj(t)
	command := "sleep 30 & wait"
	if os.Getenv("UNKNOWN_OUTPUT_MARKER") != "" {
		command = "printf '%s\\n' 'partial-marker'; " + command
	}
	p.Config.Acceptance.Run = command
	a := NewAttempt(p.Root, fixtureSlug, nil)
	a.timeout = time.Second
	a.Plan("acceptance", "check: later")
	s, _ := p.session()
	_, err := run(withStep(a.Into(context.Background()), "acceptance", "acceptance"), s, Tools{}, p.Config.Acceptance.Run, p.Root, nil)
	e, ok := sys.AsError(a.Refuse(err))
	if !ok {
		t.Fatalf("expected refusal: %v", err)
	}
	paths, err := filepath.Glob(filepath.Join(p.Root, ".kogen/local/readiness/attempts/*/attempt.json"))
	if err != nil || len(paths) != 1 {
		t.Fatalf("records: %v %v", paths, err)
	}
	raw, err := os.ReadFile(paths[0])
	if err != nil {
		t.Fatal(err)
	}
	var record any
	if err := json.Unmarshal(raw, &record); err != nil {
		t.Fatal(err)
	}
	result := map[string]any{"text": e.Render(), "reason": e.Reason, "exit": e.Exit, "record": record}
	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("UNKNOWN_OUTPUT_RESULT"), b, 0600); err != nil {
		t.Fatal(err)
	}
}
