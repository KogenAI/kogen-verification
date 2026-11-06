package verify

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

func TestPriorityRunAndStage(t *testing.T) {
	for _, stage := range []bool{false, true} {
		t.Run(map[bool]string{false: "run", true: "stage"}[stage], func(t *testing.T) {
			p := newProj(t)
			p.Config.Fix = []string{appendTo(p.trace("fix"), "fix")}
			p.Config.Setup = []string{appendTo(p.trace("work"), "setup")}
			p.Config.Checks = []project.Check{{Name: "A", Run: appendTo(p.trace("work"), "A")}, {Name: "C", Run: appendTo(p.trace("work"), "C")}}
			in := p.input(1)
			in.PreviousRed = []string{"C"}
			in.Dependencies = map[string][]string{"C": {"setup-1"}}
			calls := 0
			in.Intact = func() error { calls++; return nil }
			if stage {
				in.Stage = &Stage{ID: "x", Checks: []string{p.Config.Checks[0].Run, p.Config.Checks[1].Run}}
				in.PreviousRed = []string{"stage-x-2"}
				in.Dependencies = map[string][]string{"stage-x-2": {"setup-1"}}
			}
			s, _ := p.session()
			pass, err := Run(context.Background(), s, in)
			if err != nil {
				t.Fatal(err)
			}
			if !pass.Green || calls != 2 || !slices.Equal(p.ran("fix"), []string{"fix"}) || !slices.Equal(p.ran("work"), []string{"setup", "C", "A"}) {
				t.Fatalf("pass=%+v calls=%d work=%v", pass, calls, p.ran("work"))
			}
			if !stage && (!pass.Complete(p.Config, mustScenarios(t), nil) || !pass.Valid()) {
				t.Fatal("reordered green evidence must be complete")
			}
			b, err := json.Marshal(pass)
			if err != nil {
				t.Fatal(err)
			}
			var again Pass
			if err = json.Unmarshal(b, &again); err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(again.ExecutionOrder, pass.ExecutionOrder) || !slices.Equal(again.PulledForward, pass.PulledForward) {
				t.Fatal("lost priority metadata")
			}
			if !stage {
				again.Checks[1] = again.Checks[0]
				if again.Complete(p.Config, mustScenarios(t), nil) {
					t.Fatal("duplicate check accepted")
				}
			}
		})
	}
}

func TestPriorityRedRecordsUnexecutedTail(t *testing.T) {
	p := newProj(t)
	p.Config.Checks = []project.Check{{Name: "A", Run: "true"}, {Name: "C", Run: "exit 1"}}
	in := p.input(1)
	in.PreviousRed = []string{"C"}
	log := &memLog{}
	in.Log = log
	s, _ := p.session()
	pass, err := Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	if pass.Green || !slices.Equal(pass.ExecutionOrder, []string{"C"}) || !slices.Equal(pass.NotRun, []string{"acceptance", "A"}) {
		t.Fatalf("pass=%+v", pass)
	}
	b, _ := json.Marshal(pass)
	var again Pass
	if err := json.Unmarshal(b, &again); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(again.PulledForward, []string{"C"}) || !slices.Equal(again.ExecutionOrder, []string{"C"}) {
		t.Fatal("round trip lost order")
	}
	events := log.named("pass")
	if len(events) != 1 || !slices.Equal(events[0]["execution_order"].([]string), pass.ExecutionOrder) {
		t.Fatal("missing pass event order")
	}
}

func TestDeclaredDependenciesWithoutPriorityComplete(t *testing.T) {
	p := newProj(t)
	p.Config.Checks = []project.Check{{Name: "A", Run: "true"}, {Name: "B", Run: "true"}}
	in := p.input(1)
	in.Dependencies = map[string][]string{"A": {"B"}}
	s, _ := p.session()
	pass, err := Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	if !pass.Green || !pass.Complete(p.Config, mustScenarios(t), nil) || pass.ExecutionOrder != nil {
		t.Fatalf("dependency-ordered pass: %+v", pass)
	}
	record, err := json.Marshal(pass)
	if err != nil || !strings.Contains(string(record), `"dependency_reordered":true`) {
		t.Fatalf("record: %s: %v", record, err)
	}
	var reloaded Pass
	if err := json.Unmarshal(record, &reloaded); err != nil {
		t.Fatal(err)
	}
	if !reloaded.Complete(p.Config, mustScenarios(t), nil) {
		t.Fatalf("reloaded dependency-ordered pass is not complete: %s", record)
	}
	again, err := json.Marshal(reloaded)
	if err != nil || string(again) != string(record) {
		t.Fatalf("re-marshalled record: %s != %s: %v", again, record, err)
	}
}
