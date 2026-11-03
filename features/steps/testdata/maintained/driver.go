package verify

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

// Copied into package verify only in an isolated acceptance working tree.
func TestMaintainedAcceptanceDriver(t *testing.T) {
	out := os.Getenv("MAINTAINED_RESULT")
	if out == "" {
		return
	}
	p := newProj(t)
	mode := os.Getenv("MAINTAINED_MODE")
	trace := p.trace("quint")
	tool := filepath.Join(p.Aux, "node")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '" + trace + "'\ncase \"$*\" in *broken.qnt*) echo synthetic-typecheck-failure; exit 1;; *violated.qnt*run*|*run*violated.qnt*) echo '[violation]'; exit 1;; esac\n"
	if err := os.WriteFile(tool, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	in := p.input(1)
	in.Tools.Node, in.Tools.Quint = tool, "quint"
	own := &project.ModelSpec{Path: "own.qnt", Invariants: []string{"Own"}, Seed: "3", Samples: "4", Steps: "5"}
	in.Intent.Model = own
	models := []project.ModelSpec{}
	if mode != "empty" {
		models = append(models, project.ModelSpec{Path: "first.qnt", Invariants: []string{"A", "B"}, Seed: "11", Samples: "12", Steps: "13"})
		path := "second.qnt"
		if mode == "typecheck" {
			path = "broken.qnt"
		}
		if mode == "invariant" {
			path = "violated.qnt"
		}
		models = append(models, project.ModelSpec{Path: path, Invariants: []string{"C"}, Seed: "21", Samples: "22", Steps: "23"})
	}
	// Decode through the public Input shape: the old API ignores this field.
	b, _ := json.Marshal(map[string]any{"MaintainedModels": models})
	if err := json.Unmarshal(b, &in); err != nil {
		t.Fatal(err)
	}
	p.write("own.qnt", "module own {}\n")
	for _, m := range models {
		p.write(m.Path, "module fixture {}\n")
	}
	p.Config.Checks = []project.Check{{Name: "after", Run: "echo checked"}}
	s, _ := p.session()
	pass, err := Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	calls, _ := os.ReadFile(trace)
	result := map[string]any{"green": pass.Green, "calls": string(calls), "failing": pass.Failing, "feedback": pass.Feedback(p.Config.Acceptance.Run, ""), "checks": len(pass.Checks)}
	b, err = json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, b, 0600); err != nil {
		t.Fatal(err)
	}
}
