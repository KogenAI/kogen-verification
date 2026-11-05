// Acceptance-only Go driver for fix-k-verify-previously-red-first-2; the steps add it to package
// verify with a go build overlay. It is not linked into production.
module.exports = String.raw`package verify

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

// TestFixPreviouslyRedFirst2Driver runs the case named by FIX_PREVIOUS_RED_2_CASE and writes
// its observations as JSON to FIX_PREVIOUS_RED_2_RESULT. It records what happened and never
// fails on product behavior, so an unfixed tree reports its actual outcome.
func TestFixPreviouslyRedFirst2Driver(t *testing.T) {
	mode := os.Getenv("FIX_PREVIOUS_RED_2_CASE")
	result := map[string]any{"mode": mode}
	switch mode {
	case "record-constructed", "record-decoded":
		var p Pass
		if mode == "record-constructed" {
			p = Pass{N: 1, Clean: true, Tree: "t", Model: ModelNone, PulledForward: []string{}}
		} else if err := json.Unmarshal([]byte("{\"n\":1,\"clean\":true,\"green\":false,\"tree\":\"t\",\"setup\":[],\"acceptance\":\"not_run\",\"model\":\"none\",\"checks\":[],\"not_run\":[],\"moved\":[],\"failing\":[],\"pulled_forward\":[\"C\"]}"), &p); err != nil {
			t.Fatal(err)
		}
		b, err := json.Marshal(p)
		if err != nil {
			t.Fatal(err)
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(b, &fields); err != nil {
			t.Fatal(err)
		}
		order, present := fields["execution_order"]
		result["execution_order_present"] = present
		result["execution_order"] = order
		result["pulled_forward"] = fields["pulled_forward"]
	case "cohort-control", "cohort-acceptance-dependency", "cohort-check-dependency":
		p := newProj(t)
		bin := filepath.Join(p.Aux, "bin")
		if err := os.Mkdir(bin, 0o700); err != nil {
			t.Fatal(err)
		}
		marker := shellQuote(filepath.Join(p.Aux, "vet-started"))
		// vet marks that it started; build succeeds only when vet starts while build is running.
		script := "#!/bin/sh\nif test \"$1\" = vet; then : > " + marker + "; echo vet ok; exit 0; fi\n" +
			"i=0; while ! test -f " + marker + "; do i=$((i+1)); test $i -lt 250 || { echo build ran without vet; exit 90; }; sleep .02; done\necho build ok\n"
		if err := os.WriteFile(filepath.Join(bin, "go"), []byte(script), 0o700); err != nil {
			t.Fatal(err)
		}
		p.Env = append(p.Env, "PATH="+bin+":"+os.Getenv("PATH"))
		p.Config.Checks = []project.Check{{Name: "build", Run: "go build ./..."}, {Name: "vet", Run: "go vet ./..."}}
		in := p.input(1)
		switch mode {
		case "cohort-acceptance-dependency":
			in.Dependencies = map[string][]string{"vet": {"acceptance"}}
		case "cohort-check-dependency":
			in.Dependencies = map[string][]string{"vet": {"build"}}
		}
		pass, err := Verify(context.Background(), sys.NewWith(p.Env, p.Root), in)
		if err != nil {
			t.Fatal(err)
		}
		fixPreviousRed2Report(result, pass)
	case "cycle":
		p := newProj(t)
		p.Config.Checks = []project.Check{
			{Name: "A", Run: appendTo(p.trace("order"), "A")},
			{Name: "B", Run: appendTo(p.trace("order"), "B") + "; exit 3"},
			{Name: "C", Run: appendTo(p.trace("order"), "C")},
		}
		in := p.input(1)
		in.Dependencies = map[string][]string{"A": {"B"}, "B": {"A"}}
		s, _ := p.session()
		pass, err := Verify(context.Background(), s, in)
		if err != nil {
			t.Fatal(err)
		}
		fixPreviousRed2Report(result, pass)
		result["trace"] = nonNil(p.ran("order"))
	default:
		t.Fatalf("unknown FIX_PREVIOUS_RED_2_CASE %q", mode)
	}
	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("FIX_PREVIOUS_RED_2_RESULT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

// fixPreviousRed2Report records a pass's outcome; command results are "name=status".
func fixPreviousRed2Report(result map[string]any, pass Pass) {
	names := func(rs []CommandResult) []string {
		out := []string{}
		for _, r := range rs {
			out = append(out, fmt.Sprintf("%s=%d", r.Name, r.Status))
		}
		return out
	}
	result["green"] = pass.Green
	result["checks"] = names(pass.Checks)
	result["speculative"] = names(pass.Speculative)
	result["cancelled"] = names(pass.Cancelled)
	result["not_run"] = nonNil(pass.NotRun)
	result["failing"] = nonNil(pass.Failing)
}
`;
