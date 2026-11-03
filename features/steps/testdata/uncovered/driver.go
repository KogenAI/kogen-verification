package verify

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

func TestUncoveredAcceptanceDriver(t *testing.T) {
	p := newProj(t)
	mode := os.Getenv("UC_MODE")
	paths := []string{"features/ch01.feature", "features/ch02.feature", "features/ch04.feature"}
	if mode == "many" {
		paths = nil
		for i := 0; i < 200; i++ {
			paths = append(paths, fmt.Sprintf("features/ch%03d.feature", i))
		}
	}
	for _, path := range paths {
		p.write(path, fixtureFeature)
	}
	named := []string{"features/ch04.feature"}
	if mode == "all" {
		named = paths
	}
	if mode == "many" || mode == "silent" {
		named = []string{}
	}
	b, _ := json.Marshal(map[string]any{"executed_features": named})
	report := string(b)
	p.Config.Checks = []project.Check{{Name: "stub", Run: "if test -n \"$KOGEN_CHECK_REPORT\"; then printf '%s' '" + report + "' > \"$KOGEN_CHECK_REPORT\"; fi"}}
	p.commit("suite fixtures")
	in := p.input(1)
	location := "features/"
	if mode == "glob" {
		location = "features/*.feature"
	}
	if mode == "missing" {
		location = "missing-features/"
	}
	if mode != "none" {
		b, _ = json.Marshal(map[string]any{"AcceptanceSuite": map[string]any{"Location": location, "RequireFullCoverage": mode == "strict"}})
		if err := json.Unmarshal(b, &in); err != nil {
			t.Fatal(err)
		}
	}
	s, _ := p.session()
	pass, err := Verify(context.Background(), s, in)
	result := map[string]any{"record": pass, "feedback": pass.Feedback(p.Config.Acceptance.Run, ""), "error": ""}
	if err != nil {
		result["error"] = err.Error()
	}
	if mode == "none" {
		other, e := Verify(context.Background(), s, p.input(1))
		if e != nil {
			t.Fatal(e)
		}
		a, _ := json.Marshal(pass)
		b, _ := json.Marshal(other)
		result["sameRecord"] = string(a) == string(b)
		result["sameFeedback"] = pass.Feedback(p.Config.Acceptance.Run, "") == other.Feedback(p.Config.Acceptance.Run, "")
	}
	// Keep refusal text intact, not Go runner diagnostics.
	if strings.TrimSpace(os.Getenv("UC_RESULT")) == "" {
		t.Fatal("UC_RESULT required")
	}
	b, e := json.Marshal(result)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(os.Getenv("UC_RESULT"), b, 0600); e != nil {
		t.Fatal(e)
	}
}
