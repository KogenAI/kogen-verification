package verify

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

func TestClassifySpecUpdate(t *testing.T) {
	t.Parallel()
	m := &MaintainedSpecs{Specs: []string{"spec/features/", "spec/model.qnt", "both"}, Implementation: []string{"src", "both", "spec/model.qnt"}}
	u := classifySpecUpdate([]string{"src/b.go", "src/a.go", "spec/features/x.feature", "both/f", "docs/notes.md", "src/a_test.go.md", "spec/featuresx/y"}, m)
	eq(t, "implementation count", u.ImplementationChangedCount, 3)
	eqSlice(t, "implementation", u.ImplementationChanged, []string{"src/a.go", "src/a_test.go.md", "src/b.go"})
	eqSlice(t, "specs", u.SpecsChanged, []string{"both/f", "spec/features/x.feature"})
	eqSlice(t, "unchanged", u.SpecsUnchanged, []string{"spec/model.qnt"})
	eq(t, "flag", u.SpecsNotUpdated, false)

	// "." declares everything; the specification path wins over an implementation path.
	u = classifySpecUpdate([]string{"a", "docs/x"}, &MaintainedSpecs{Specs: []string{"docs"}, Implementation: []string{"."}})
	eq(t, "dot impl", u.ImplementationChangedCount, 1)
	eqSlice(t, "dot specs", u.SpecsChanged, []string{"docs/x"})
	eq(t, "dot flag", u.SpecsNotUpdated, false)

	// An undeclared documentation or test file is neither.
	u = classifySpecUpdate([]string{"docs/notes.md", "src/a_test.go"}, &MaintainedSpecs{Specs: []string{"spec"}, Implementation: []string{"lib"}})
	eq(t, "neither", u.ImplementationChangedCount+u.SpecsChangedCount, 0)
	eq(t, "neither flag", u.SpecsNotUpdated, false)
	eqSlice(t, "neither unchanged", u.SpecsUnchanged, []string{"spec"})
	if u.ImplementationChanged == nil || u.SpecsChanged == nil {
		t.Fatal("lists are never nil")
	}

	// The bound is 20, the total is kept.
	var many []string
	for i := 20; i >= 0; i-- {
		many = append(many, fmt.Sprintf("src/f%02d.go", i))
	}
	u = classifySpecUpdate(many, &MaintainedSpecs{Implementation: []string{"src"}})
	eq(t, "count", u.ImplementationChangedCount, 21)
	eq(t, "bound", len(u.ImplementationChanged), 20)
	eq(t, "first", u.ImplementationChanged[0], "src/f00.go")
	eq(t, "last", u.ImplementationChanged[19], "src/f19.go")
	eq(t, "flag", u.SpecsNotUpdated, true)
}

func TestSpecUpdateNoticeLine(t *testing.T) {
	t.Parallel()
	u := SpecUpdate{ImplementationChangedCount: 1, ImplementationChanged: []string{"src/a.go"}, SpecsChanged: []string{}, SpecsUnchanged: []string{"spec/model.qnt", "spec/features/a.feature"}, SpecsNotUpdated: true}
	want := "specs not updated: implementation files changed: 1 (src/a.go); maintained specifications unchanged: spec/model.qnt, spec/features/a.feature"
	eq(t, "notice", u.Notice(), want)

	var files []string
	for i := 0; i < 20; i++ {
		files = append(files, fmt.Sprintf("f%d", i))
	}
	u = SpecUpdate{ImplementationChangedCount: 21, ImplementationChanged: files, SpecsUnchanged: []string{"s"}, SpecsNotUpdated: true}
	if got := u.Notice(); !strings.Contains(got, "f19, and 1 more); maintained") || !strings.HasPrefix(got, "specs not updated: implementation files changed: 21 (f0, f1") {
		t.Fatal(got)
	}
	u.ImplementationChangedCount = 20
	if strings.Contains(u.Notice(), "more") {
		t.Fatal("no `and N more` at the bound")
	}
}

func TestSpecUpdateInResultsAndFeedback(t *testing.T) {
	t.Parallel()
	flagged := &SpecUpdate{ImplementationChangedCount: 1, ImplementationChanged: []string{"src/a.go"}, SpecsChanged: []string{}, SpecsUnchanged: []string{"s.qnt"}, SpecsNotUpdated: true}
	line := flagged.Notice()
	base := Pass{N: 2, Model: ModelNone, Checks: []CommandResult{{Name: "lint", Command: "lint", Status: 1, Output: "bad\n"}}, Failing: []string{"lint"}, Moved: []string{"x"}, NotRun: []string{"later"}}
	plain := base
	flaggedPass := base
	flaggedPass.SpecUpdate = flagged
	eq(t, "results unflagged", plain.Results(), "acceptance: passed (0 scenarios)\nmodel: not applicable\ncheck lint: passed")
	if got := flaggedPass.Results(); got != plain.Results()+"\n"+line {
		t.Fatal(got)
	}
	unflagged := base
	unflagged.SpecUpdate = &SpecUpdate{ImplementationChanged: []string{}, SpecsChanged: []string{}, SpecsUnchanged: []string{}}
	eq(t, "unflagged record feedback", unflagged.Feedback("acc", ""), plain.Feedback("acc", ""))
	eq(t, "unflagged record results", unflagged.Results(), plain.Results())

	fb := flaggedPass.Feedback("acc", "")
	eq(t, "feedback count", strings.Count(fb, line), 1)
	lines := strings.Split(fb, "\n")
	i := slices.Index(lines, line)
	if i < 0 || !strings.HasPrefix(lines[i+1], "files changed while checks ran") || !strings.HasPrefix(lines[i+2], "not run because") {
		t.Fatalf("placement: %q", lines)
	}

	// With "require spec update" the line is also a failing entry but shows once in feedback.
	required := flaggedPass
	required.Failing = []string{"lint", line}
	eq(t, "required feedback count", strings.Count(required.Feedback("acc", ""), line), 1)
	eq(t, "required summary", required.Summary(), "kogen: pass 2: lint, "+line+" failed; not run because an earlier item failed: later")
}

func TestSpecUpdateJSON(t *testing.T) {
	t.Parallel()
	p := Pass{Model: ModelNone}
	data, err := json.Marshal(p)
	if err != nil || strings.Contains(string(data), "spec_update") {
		t.Fatalf("absent when nil: %s %v", data, err)
	}
	p.SpecUpdate = &SpecUpdate{ImplementationChangedCount: 2, ImplementationChanged: []string{"src/a.go", "src/b.go"}, SpecsNotUpdated: true}
	data, err = json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	want := `"spec_update":{"implementation_changed_count":2,"implementation_changed":["src/a.go","src/b.go"],"specs_changed_count":0,"specs_changed":[],"specs_unchanged":[],"specs_not_updated":true}`
	if !strings.Contains(string(data), want) {
		t.Fatalf("%s", data)
	}
	var got Pass
	if err := json.Unmarshal(data, &got); err != nil || got.SpecUpdate == nil || got.SpecUpdate.ImplementationChangedCount != 2 || !got.SpecUpdate.SpecsNotUpdated {
		t.Fatalf("read back: %+v %v", got.SpecUpdate, err)
	}
	again, err := json.Marshal(got)
	if err != nil || string(again) != string(data) {
		t.Fatalf("round trip bytes: %s != %s: %v", again, data, err)
	}
}

// specProj is a synthetic repository like the acceptance one: base files committed, one check.
func specProj(t *testing.T) (*proj, *MaintainedSpecs) {
	p := newProj(t)
	p.write("src/a.go", "package a\n")
	p.write("spec/model.qnt", "module a {}\n")
	p.write("spec/features/a.feature", "Feature: A\n")
	p.write("docs/notes.md", "notes\n")
	p.commit("base")
	p.Config.Checks = []project.Check{{Name: "lint", Run: "true"}}
	return p, &MaintainedSpecs{Specs: []string{"spec/model.qnt", "spec/features/a.feature"}, Implementation: []string{"src/a.go"}}
}

func TestVerifyMeasuresSpecUpdateAgainstStart(t *testing.T) {
	t.Parallel()
	p, specs := specProj(t)
	p.write("src/a.go", "changed\n")
	s, _ := p.session()
	in := p.input(1)
	in.MaintainedSpecs = specs
	pass, err := Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	if !pass.Green || len(pass.Failing) != 0 {
		t.Fatalf("flagged pass stays green: %+v", pass.Failing)
	}
	want := SpecUpdate{ImplementationChangedCount: 1, ImplementationChanged: []string{"src/a.go"}, SpecsChanged: []string{}, SpecsUnchanged: []string{"spec/model.qnt", "spec/features/a.feature"}, SpecsNotUpdated: true}
	if pass.SpecUpdate == nil || !slices.Equal(pass.SpecUpdate.SpecsUnchanged, want.SpecsUnchanged) || pass.SpecUpdate.ImplementationChangedCount != 1 || !pass.SpecUpdate.SpecsNotUpdated {
		t.Fatalf("%+v", pass.SpecUpdate)
	}
	eq(t, "results", pass.Results()[strings.LastIndex(pass.Results(), "\n")+1:], want.Notice())

	// A committed spec change after Start still counts; a new spec file in a directory too.
	p.write("spec/features/a.feature", "Feature: A2\n")
	pass, err = Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	eq(t, "spec changed", pass.SpecUpdate.SpecsChangedCount, 1)
	eq(t, "no flag", pass.SpecUpdate.SpecsNotUpdated, false)
	eqSlice(t, "unchanged", pass.SpecUpdate.SpecsUnchanged, []string{"spec/model.qnt"})

	// RequireUpdate turns a flagged pass red, once.
	p.write("spec/features/a.feature", "Feature: A\n")
	in.MaintainedSpecs = &MaintainedSpecs{Specs: specs.Specs, Implementation: specs.Implementation, RequireUpdate: true}
	pass, err = Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	line := pass.SpecUpdate.Notice()
	if pass.Green || !slices.Equal(pass.Failing, []string{line}) {
		t.Fatalf("require: green=%v %q", pass.Green, pass.Failing)
	}
	eq(t, "feedback once", strings.Count(pass.Feedback("acc", ""), line), 1)
	eq(t, "checks still ran", len(pass.Checks), 1)
	eq(t, "nothing unrun", len(pass.NotRun), 0)

	// RequireUpdate without a flag stays green.
	p.write("src/a.go", "package a\n")
	pass, err = Verify(context.Background(), s, in)
	if err != nil || !pass.Green {
		t.Fatalf("unflagged require: %v %+v", err, pass.Failing)
	}
}

func TestVerifyRefusesMissingDeclaredPathBeforeSetup(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name  string
		specs MaintainedSpecs
		want  string
	}{
		{"spec", MaintainedSpecs{Specs: []string{"spec/model.qnt", "spec/missing.qnt"}, Implementation: []string{"src/nope"}}, "maintained specification path does not exist in the candidate: spec/missing.qnt"},
		{"implementation", MaintainedSpecs{Specs: []string{"spec/"}, Implementation: []string{"src/a.go", "src/nope"}}, "implementation path does not exist in the candidate: src/nope"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, _ := specProj(t)
			p.Config.Setup = []string{appendTo(p.trace("order"), "setup")}
			in := p.input(1)
			in.MaintainedSpecs = &tc.specs
			s, _ := p.session()
			pass, err := Run(context.Background(), s, in)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error: %v", err)
			}
			eq(t, "no pass", pass.N, 0)
			eq(t, "setup ran", len(p.ran("order")), 0)
		})
	}
}

func TestVerifyNothingDeclaredKeepsRecordFeedbackAndResults(t *testing.T) {
	t.Parallel()
	p, _ := specProj(t)
	p.write("src/a.go", "changed\n")
	s, _ := p.session()
	in := p.input(1)
	control, err := Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	for _, specs := range []*MaintainedSpecs{{}, {RequireUpdate: true}} {
		in.MaintainedSpecs = specs
		got, err := Verify(context.Background(), s, in)
		if err != nil {
			t.Fatal(err)
		}
		a, _ := json.Marshal(control)
		b, _ := json.Marshal(got)
		eq(t, "record", string(a), string(b))
		eq(t, "feedback", control.Feedback("acc", ""), got.Feedback("acc", ""))
		eq(t, "results", control.Results(), got.Results())
		if got.SpecUpdate != nil {
			t.Fatal("nothing declared leaves spec_update nil")
		}
	}

	// Scoped stage passes ignore the input, even a missing path.
	in.Stage = &Stage{ID: "m1", Checks: []string{"true"}}
	in.MaintainedSpecs = &MaintainedSpecs{Specs: []string{"nope"}}
	got, err := Verify(context.Background(), s, in)
	if err != nil || got.SpecUpdate != nil || !got.Green {
		t.Fatalf("stage: %v %+v", err, got.SpecUpdate)
	}
}
