// Acceptance-only Go driver for fix-k-verify-previously-red-first; the steps add it to package
// verify with a go build overlay. It is not linked into production.
module.exports = String.raw`package verify

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

// TestFixPreviouslyRedFirstReloadDriver runs a real pass for the case named by
// FIX_PREVIOUS_RED_RELOAD_CASE, records and reloads it, and writes its observations as JSON to
// FIX_PREVIOUS_RED_RELOAD_RESULT. It records what happened and never fails on product
// behavior, so an unfixed tree reports its actual outcome.
func TestFixPreviouslyRedFirstReloadDriver(t *testing.T) {
	mode := os.Getenv("FIX_PREVIOUS_RED_RELOAD_CASE")
	result := map[string]any{"mode": mode}
	p := newProj(t)
	p.Config.Checks = []project.Check{{Name: "A", Run: appendTo(p.trace("order"), "A")}, {Name: "B", Run: appendTo(p.trace("order"), "B")}}
	in := p.input(1)
	switch mode {
	case "dependency-ordered":
		in.Dependencies = map[string][]string{"A": {"B"}}
	case "config-ordered":
	default:
		t.Fatalf("unknown FIX_PREVIOUS_RED_RELOAD_CASE %q", mode)
	}
	s, _ := p.session()
	pass, err := Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	expected := mustScenarios(t)
	checks := []string{}
	for _, c := range pass.Checks {
		checks = append(checks, fmt.Sprintf("%s=%d", c.Name, c.Status))
	}
	result["green"] = pass.Green
	result["checks"] = checks
	result["trace"] = nonNil(p.ran("order"))
	result["complete"] = pass.Complete(p.Config, expected, nil)
	record, err := json.Marshal(pass)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(record, &fields); err != nil {
		t.Fatal(err)
	}
	if v, ok := fields["dependency_reordered"]; ok {
		result["record_dependency_reordered"] = v
	} else {
		result["record_dependency_reordered"] = "absent"
	}
	var reloaded Pass
	if err := json.Unmarshal(record, &reloaded); err != nil {
		t.Fatal(err)
	}
	result["reloaded_complete"] = reloaded.Complete(p.Config, expected, nil)
	again, err := json.Marshal(reloaded)
	if err != nil {
		t.Fatal(err)
	}
	result["rerecorded_identical"] = bytes.Equal(again, record)
	// The same record with its two checks swapped, recorded and reloaded again.
	var reversed Pass
	if err := json.Unmarshal(record, &reversed); err != nil {
		t.Fatal(err)
	}
	reversed.Checks[0], reversed.Checks[1] = reversed.Checks[1], reversed.Checks[0]
	swapped, err := json.Marshal(reversed)
	if err != nil {
		t.Fatal(err)
	}
	var swappedReloaded Pass
	if err := json.Unmarshal(swapped, &swappedReloaded); err != nil {
		t.Fatal(err)
	}
	result["swapped_reloaded_complete"] = swappedReloaded.Complete(p.Config, expected, nil)
	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("FIX_PREVIOUS_RED_RELOAD_RESULT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;
