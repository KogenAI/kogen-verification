package verify

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

func TestMaintainedFeaturesDriver(t *testing.T) {
	out := os.Getenv("MF_RESULT")
	if out == "" {
		t.Fatal("MF_RESULT required")
	}
	p := newProj(t)
	mode := os.Getenv("MF_MODE")
	trace := p.trace("items")
	feature := "Feature: Maintained\n  Scenario: First\n    Then the candidate succeeds\n  Scenario: Later\n    Then the candidate succeeds\n"
	paths := []string{"spec/green.feature", "spec/red.feature"}
	p.write(paths[0], feature)
	p.write(paths[1], feature)
	p.write("spec/unlisted.feature", feature)
	expected, err := project.ParseGherkin(feature)
	if err != nil {
		t.Fatal(err)
	}
	green := writeReport(t, p.Aux, "mf-green", simpleMessages(paths[0], expected, reportOpts{}))
	red := writeReport(t, p.Aux, "mf-red", simpleMessages(paths[1], expected, reportOpts{results: statuses("FAILED")}))
	// Each report is bound to the requested URI, not a historical Intent report.
	p.Config.Acceptance.Run = "printf '%s\\n' \"$KOGEN_ACCEPTANCE_FEATURES\" >> '" + trace + "'; case \"$KOGEN_ACCEPTANCE_FEATURES\" in spec/green.feature) cp '" + green + "' \"$KOGEN_ACCEPTANCE_REPORT\";; spec/red.feature) cp '" + red + "' \"$KOGEN_ACCEPTANCE_REPORT\"; exit 1;; *) cp '" + p.Green + "' \"$KOGEN_ACCEPTANCE_REPORT\";; esac"
	p.Config.Checks = []project.Check{{Name: "after", Run: appendTo(trace, "check")}}
	p.write("maintained.qnt", "module maintained {}\n")
	tool := filepath.Join(p.Aux, "node")
	if err := os.WriteFile(tool, []byte("#!/bin/sh\nprintf '%s\\n' model >> '"+trace+"'\n"), 0755); err != nil {
		t.Fatal(err)
	}
	p.commit("maintained fixtures")
	in := p.input(1)
	in.Tools.Node, in.Tools.Quint = tool, "quint"
	in.MaintainedModels = []project.ModelSpec{{Path: "maintained.qnt", Invariants: []string{"Safe"}, Seed: "1", Samples: "1", Steps: "1"}}
	switch mode {
	case "missing":
		paths = []string{"spec/missing.feature"}
	case "move":
		paths = paths[:1]
		p.Config.Checks[0].Run = appendTo(trace, "check") + "; printf changed >> '" + filepath.Join(p.Root, paths[0]) + "'"
	case "empty":
		paths = []string{}
	}
	b, _ := json.Marshal(map[string]any{"MaintainedFeatures": paths})
	if err := json.Unmarshal(b, &in); err != nil {
		t.Fatal(err)
	}
	s, _ := p.session()
	pass, err := Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(pass)
	if err != nil {
		t.Fatal(err)
	}
	var record map[string]any
	if err := json.Unmarshal(raw, &record); err != nil {
		t.Fatal(err)
	}
	result := map[string]any{"record": record, "trace": p.ran("items"), "feedback": pass.Feedback(p.Config.Acceptance.Run, "")}
	if mode == "empty" {
		os.Remove(trace)
		control := p.input(1)
		control.Tools = in.Tools
		control.MaintainedModels = in.MaintainedModels
		other, err := Verify(context.Background(), s, control)
		if err != nil {
			t.Fatal(err)
		}
		bytes, err := json.Marshal(other)
		if err != nil {
			t.Fatal(err)
		}
		result["sameRecord"] = string(raw) == string(bytes)
		result["sameFeedback"] = pass.Feedback(p.Config.Acceptance.Run, "") == other.Feedback(p.Config.Acceptance.Run, "")
	}
	b, err = json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, b, 0600); err != nil {
		t.Fatal(err)
	}
}
