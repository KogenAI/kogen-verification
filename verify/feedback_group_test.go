package verify

import (
	"fmt"
	"strings"
	"testing"
)

func TestFeedbackBudget(t *testing.T) {
	for _, size := range []int{16383, 16384, 16385} {
		text := strings.Repeat("x", size-3) + "é\n"
		got := limitFeedback([]feedbackPart{{text, 1}})
		if size <= 16384 {
			if got != text {
				t.Fatalf("size %d changed", size)
			}
			continue
		}
		want := fmt.Sprintf("left out 1 items, %d bytes", len(text))
		if got != want {
			t.Fatalf("got %q want %q", got, want)
		}
	}
	parts := []feedbackPart{{"head", 0}, {"éé\n" + strings.Repeat("t", 50), 2}, {"last", 1}}
	full := strings.Join([]string{parts[0].text, parts[1].text, parts[2].text}, "\n")
	parts[0].text = strings.Repeat("x", 16345)
	full = strings.Repeat("x", 16345) + full[4:]
	got := limitFeedback(parts)
	if len(got) > 16384 {
		t.Fatal(len(got))
	}
	cut := strings.LastIndex(got, "\n") + 1
	notice := fmt.Sprintf("left out 3 items, %d bytes", len(full)-cut)
	if got[cut:] != notice || !strings.HasPrefix(full, got[:cut]) {
		t.Fatalf("notice %q want %q", got[cut:], notice)
	}
}

func TestFeedbackGroupsCommandsAndSections(t *testing.T) {
	p := Pass{Model: ModelResult{State: "failed", Problems: []string{"bad", "bad", "different"}}, Checks: []CommandResult{{Name: "one", Status: 1, Output: "oops"}, {Name: "two", Status: 1, Output: "oops"}, {Name: "three", Status: 2, Output: "oops"}}}
	got := p.Feedback("run", "")
	for _, s := range []string{"model: failed", "2 scenarios", "2 checks: one, two", "check three", "different"} {
		if !strings.Contains(got, s) {
			t.Errorf("missing %q in %s", s, got)
		}
	}
}

func TestFeedbackInvariantAndSpeculativeFailures(t *testing.T) {
	p := Pass{Model: ModelResult{State: "failed", Problems: []string{"model.qnt: invariant first violated (seed 1)\nerror line 12", "model.qnt: invariant second violated (seed 1)\nerror line 25"}}, Speculative: []CommandResult{{Name: "a", Status: 1, Output: "a: error line 12"}, {Name: "b", Status: 1, Output: "b: error line 25"}, {Name: "ok", Output: "success"}, {Name: "ok2", Output: "success"}}}
	got := p.Feedback("run", "")
	for _, s := range []string{"2 scenarios: first, second", "2 checks: a, b", "ok (): status 0", "ok2 (): status 0"} {
		if !strings.Contains(got, s) {
			t.Errorf("missing %q: %s", s, got)
		}
	}
	if strings.Count(got, "error line") != 2 {
		t.Fatalf("details repeated: %s", got)
	}
}

func TestFeedbackCountsBlankFailuresInOmittedTail(t *testing.T) {
	lines := make([]string, 300)
	for i := range lines {
		lines[i] = fmt.Sprintf("row %03d ", i+1) + strings.Repeat("x", 92)
	}
	big := strings.Join(lines, "\n")
	for blank, want := range map[string]string{"": "left out 2 items, 14731 bytes", " \n\t ": "left out 2 items, 14737 bytes"} {
		got := Pass{N: 1, Model: ModelResult{State: "failed", Problems: []string{big, blank}}}.Feedback("run", "")
		if len(got) > 16384 || got[strings.LastIndex(got, "\n")+1:] != want {
			t.Errorf("blank %q: last line %q want %q", blank, got[strings.LastIndex(got, "\n")+1:], want)
		}
	}
}

func TestFeedbackStripsAdjacentNames(t *testing.T) {
	d := func(s string) *string { return &s }
	p := Pass{N: 1, Model: ModelResult{State: "ok"},
		Acceptance: &Acceptance{Status: 1,
			Scenarios: []ScenarioResult{{Name: "a", Line: 1, Status: "failed", Detail: d("a a has data")}, {Name: "b", Line: 2, Status: "failed", Detail: d("b b has data")}},
			Problems:  []string{"failed: a (line 1): a a has data", "failed: b (line 2): b b has data"}},
		Checks: []CommandResult{{Name: "one", Status: 1, Output: "one one: has data"}, {Name: "two", Status: 1, Output: "two two: has data"}}}
	got := p.Feedback("run", "")
	for _, s := range []string{"2 scenarios: a, b", "2 checks: one, two"} {
		if strings.Count(got, s) != 1 {
			t.Errorf("want one %q in %s", s, got)
		}
	}
	if strings.Count(got, "has data") != 2 {
		t.Fatalf("details not grouped: %s", got)
	}
}
