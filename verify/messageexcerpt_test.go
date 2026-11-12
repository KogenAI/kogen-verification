package verify

import (
	"fmt"
	"strings"
	"testing"
)

func TestFailedStepDetailKeepsFailureAtEnd(t *testing.T) {
	tc := jmap{"testSteps": []any{jmap{"id": "s1", "pickleStepId": "p1"}}}
	pickle := jmap{"steps": []any{jmap{"id": "p1", "text": "it works", "astNodeIds": []any{"n1"}}}}
	lines := map[string]astNode{"n1": {line: 3, step: true, keyword: "Then "}}
	var b []string
	b = append(b, "AssertionError: compiled regression:", "=== RUN   TestWidget")
	for i := 0; i < 300; i++ {
		b = append(b, fmt.Sprintf("    log line %d", i))
	}
	b = append(b, "    widget_test.go:77: want 1 got 2", "--- FAIL: TestWidget (0.00s)")
	got := stepDetail(tc, pickle, "s1", jmap{"message": strings.Join(b, "\n")}, lines, nil)
	for _, want := range []string{"AssertionError", "widget_test.go:77", "--- FAIL: TestWidget", "lines omitted"} {
		if !strings.Contains(got, want) {
			t.Errorf("detail lost %q", want)
		}
	}
	if n := len(strings.Split(got, "\n")); n > 204 {
		t.Errorf("detail has %d lines, want a bounded excerpt", n)
	}
}
