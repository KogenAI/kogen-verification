// Acceptance-only Go driver for k-verify-maintained-spec-unchanged-notice; the steps add it to
// package verify with a go build overlay. It is not linked into production.
module.exports = String.raw`
package verify

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

// specUpdateDeclare sets Input.MaintainedSpecs by reflection, so this driver compiles on a
// tree without the field and reports it as not declarable.
func specUpdateDeclare(in *Input, specs, impl []string, require bool) bool {
	f := reflect.ValueOf(in).Elem().FieldByName("MaintainedSpecs")
	if !f.IsValid() || !f.CanSet() || f.Kind() != reflect.Pointer || f.Type().Elem().Kind() != reflect.Struct {
		return false
	}
	v := reflect.New(f.Type().Elem())
	for _, field := range []struct {
		name  string
		value any
	}{{"Specs", specs}, {"Implementation", impl}, {"RequireUpdate", require}} {
		g := v.Elem().FieldByName(field.name)
		if !g.IsValid() || !g.CanSet() || g.Type() != reflect.TypeOf(field.value) {
			return false
		}
		g.Set(reflect.ValueOf(field.value))
	}
	f.Set(v)
	return true
}

func TestSpecUpdateNoticeDriver(t *testing.T) {
	mode := os.Getenv("SPEC_UPDATE_CASE")
	p := newProj(t)
	p.write("src/a.go", "package a\n")
	p.write("spec/model.qnt", "module a {}\n")
	p.write("spec/features/a.feature", "Feature: A\n")
	p.write("docs/notes.md", "notes\n")
	p.commit("base")
	p.Config.Checks = []project.Check{{Name: "lint", Run: "true"}}
	impl := []string{"src/a.go"}
	specs := []string{"spec/model.qnt", "spec/features/a.feature"}
	require := false
	edit := func(paths ...string) {
		for _, path := range paths {
			p.write(path, "changed by the candidate\n")
		}
	}
	switch mode {
	case "implementation", "control":
		edit("src/a.go")
	case "red-check":
		edit("src/a.go")
		p.Config.Checks[0].Run = "echo lint-broke; exit 3"
	case "both":
		edit("src/a.go", "spec/features/a.feature")
	case "spec":
		edit("spec/model.qnt")
	case "docs":
		edit("docs/notes.md")
	case "require":
		edit("src/a.go")
		require = true
	case "missing":
		edit("src/a.go")
		specs = append(specs, "spec/missing.qnt")
	case "many":
		impl = []string{"src"}
		for i := 0; i < 300; i++ {
			edit(fmt.Sprintf("src/gen/f%03d.go", i))
		}
	default:
		t.Fatalf("unknown SPEC_UPDATE_CASE %q", mode)
	}
	in := p.input(1)
	s, _ := p.session()
	result := map[string]any{"error": ""}
	if mode == "control" {
		control, err := Verify(context.Background(), s, in)
		if err != nil {
			t.Fatal(err)
		}
		result["declarable"] = specUpdateDeclare(&in, nil, nil, false)
		empty, err := Verify(context.Background(), s, in)
		if err != nil {
			t.Fatal(err)
		}
		a, err := json.Marshal(control)
		if err != nil {
			t.Fatal(err)
		}
		b, err := json.Marshal(empty)
		if err != nil {
			t.Fatal(err)
		}
		result["sameRecord"] = string(a) == string(b)
		result["sameFeedback"] = control.Feedback("acc", "") == empty.Feedback("acc", "")
		result["sameResults"] = control.Results() == empty.Results()
		result["green"] = empty.Green
		result["results"] = empty.Results()
		result["feedback"] = empty.Feedback("acc", "")
	} else {
		result["declarable"] = specUpdateDeclare(&in, specs, impl, require)
		pass, err := Verify(context.Background(), s, in)
		if err != nil {
			result["error"] = err.Error()
		} else {
			raw, err := json.Marshal(pass)
			if err != nil {
				t.Fatal(err)
			}
			var record map[string]any
			if err := json.Unmarshal(raw, &record); err != nil {
				t.Fatal(err)
			}
			result["record"] = record
			result["green"] = pass.Green
			result["failing"] = pass.Failing
			result["results"] = pass.Results()
			result["feedback"] = pass.Feedback("acc", "")
		}
	}
	b, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("SPEC_UPDATE_RESULT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;
