'use strict';

// The Go source of TestApprovalFitAcceptanceDriver, which the steps of
// k-verify-approval-acceptance-fits-step install only in an isolated copy of the checkout as
// verify/approvalfit_acceptance_test.go. Loading this file defines no step and runs nothing.

module.exports.source = `package verify

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

// Installed only in an isolated acceptance copy as verify/approvalfit_acceptance_test.go. It runs
// one approval readiness check (a caller Attempt, with its step bound contracted to
// APPROVALFIT_BOUND_MS when that is set and NewAttempt's own bound otherwise) of the fixture
// project and writes the refusal and every retained attempt record it finds to
// APPROVALFIT_RESULT. The fixture's acceptance runs the real Cucumber (KOGEN_NODE and
// KOGEN_CUCUMBER) over APPROVALFIT_FEATURE with the step file APPROVALFIT_STEPS when both are set;
// otherwise APPROVALFIT_COMMAND replaces the acceptance command, and APPROVALFIT_SETUP adds one
// setup command.
func TestApprovalFitAcceptanceDriver(t *testing.T) {
	out := os.Getenv("APPROVALFIT_RESULT")
	if out == "" {
		t.Fatal("APPROVALFIT_RESULT is required")
	}
	bound := 0
	if v := os.Getenv("APPROVALFIT_BOUND_MS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			t.Fatalf("APPROVALFIT_BOUND_MS must be a positive number of milliseconds: %q", v)
		}
		bound = n
	}
	p := newProj(t)
	tools := Tools{Node: os.Getenv("KOGEN_NODE"), Cucumber: os.Getenv("KOGEN_CUCUMBER")}
	if feature, steps := os.Getenv("APPROVALFIT_FEATURE"), os.Getenv("APPROVALFIT_STEPS"); feature != "" || steps != "" {
		if feature == "" || steps == "" || tools.Node == "" || tools.Cucumber == "" {
			t.Fatal("APPROVALFIT_FEATURE, APPROVALFIT_STEPS, KOGEN_NODE and KOGEN_CUCUMBER are required together")
		}
		p.write(project.FeaturePath(fixtureSlug), feature)
		p.write("features/steps/fixture_steps.js", steps)
		p.commit("timed fixture")
		p.Config.Acceptance = &project.Acceptance{Run: cucumberRun("features/steps"), StepsDir: "features/steps"}
	}
	if command := os.Getenv("APPROVALFIT_COMMAND"); command != "" {
		p.Config.Acceptance.Run = command
	}
	if setup := os.Getenv("APPROVALFIT_SETUP"); setup != "" {
		p.Config.Setup = []string{setup}
	}
	r := p.readiness()
	r.Tools = tools
	a := NewAttempt(p.Root, fixtureSlug, nil)
	if bound > 0 {
		a.timeout = time.Duration(bound) * time.Millisecond
	}
	r.Attempt = a
	s, _ := p.session()
	ready, err := r.Check(context.Background(), s, fixtureSlug)
	result := map[string]any{"root": p.Root, "bound_ms": bound, "command": p.Config.Acceptance.Run, "refused": err != nil}
	if ready != nil {
		result["acceptance_exit"] = ready.AcceptanceExit
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
		records = append(records, map[string]any{"path": path, "record": json.RawMessage(b)})
	}
	result["records"] = records
	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;
