package verify

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
)

func ts(sec int64, ms int) string {
	return `{"seconds":` + itoa(int(sec)) + `,"nanos":` + itoa(ms*1_000_000) + `}`
}

func partialReport(t *testing.T, lines ...string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "report.ndjson")
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// stepMessages are the messages of a test case whose steps (ids s1..) wait the given
// milliseconds; the last one has no testStepFinished when running is set.
func stepMessages(waits []int, running bool) []string {
	var steps []string
	var pickleSteps []string
	var ast []string
	for i := range waits {
		n := itoa(i + 1)
		ast = append(ast, `{"id":"a`+n+`","keyword":"Given ","location":{"line":`+itoa(i+3)+`}}`)
		pickleSteps = append(pickleSteps, `{"id":"ps`+n+`","text":"wait `+n+`","astNodeIds":["a`+n+`"]}`)
		steps = append(steps, `{"id":"s`+n+`","pickleStepId":"ps`+n+`"}`)
	}
	steps = append(steps, `{"id":"h1","hookId":"hk1"}`)
	out := []string{
		`{"meta":{}}`,
		`{"gherkinDocument":{"feature":{"children":[{"scenario":{"id":"sc","location":{"line":2},"steps":[` + strings.Join(ast, ",") + `]}}]}}}`,
		`{"pickle":{"id":"p1","steps":[` + strings.Join(pickleSteps, ",") + `]}}`,
		`{"hook":{"id":"hk1","sourceReference":{"uri":"features/steps/x.js","location":{"line":7}}}}`,
		`{"hook":{"id":"hk2","sourceReference":{"uri":"features/steps/y.js","location":{"line":2}}}}`,
		`{"testCase":{"id":"tc1","pickleId":"p1","testSteps":[` + strings.Join(steps, ",") + `]}}`,
		`{"testRunHookStarted":{"id":"rh1","hookId":"hk2","timestamp":` + ts(100, 0) + `}}`,
		`{"testRunHookFinished":{"testRunHookStartedId":"rh1","result":{"duration":{"seconds":1,"nanos":500000000}}}}`,
		`{"testCaseStarted":{"id":"c1","testCaseId":"tc1"}}`,
	}
	at := int64(101)
	for i, ms := range waits {
		n := itoa(i + 1)
		out = append(out, `{"testStepStarted":{"testCaseStartedId":"c1","testStepId":"s`+n+`","timestamp":`+ts(at, 0)+`}}`)
		if running && i == len(waits)-1 {
			break
		}
		out = append(out, `{"testStepFinished":{"testCaseStartedId":"c1","testStepId":"s`+n+`","testStepResult":{"duration":{"seconds":`+itoa(ms/1000)+`,"nanos":`+itoa(ms%1000*1_000_000)+`}}}}`)
		at++
	}
	return out
}

func TestReadStepTimes(t *testing.T) {
	endedAt := time.Unix(110, 0).UTC().Format(time.RFC3339Nano)
	t.Run("slowest first, labels, still running, cap of five", func(t *testing.T) {
		lines := append(stepMessages([]int{3000, 0, 800, 200, 0, 60000}, true), `{"testStepSta`)
		got := stepTimeLines(readStepTimes(partialReport(t, lines...), endedAt))
		want := []string{
			"Slowest Cucumber steps before the stop (from its report, slowest first):",
			"  4.0s, still running when stopped: acceptance.feature line 8: Given wait 6",
			"  3.0s: acceptance.feature line 3: Given wait 1",
			"  1.5s: a hook at features/steps/y.js line 2",
			"  0.8s: acceptance.feature line 5: Given wait 3",
			"  0.2s: acceptance.feature line 6: Given wait 4",
		}
		if !slices.Equal(got, want) {
			t.Fatalf("lines =\n%s\nwant\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
		}
	})
	t.Run("a started step after the end never goes below zero, test-step hooks and unresolved steps are labeled", func(t *testing.T) {
		lines := []string{
			`{"hook":{"id":"hk1"}}`,
			`{"testCase":{"id":"tc1","testSteps":[{"id":"s1","hookId":"hk1"}]}}`,
			`{"testCaseStarted":{"id":"c1","testCaseId":"tc1"}}`,
			`{"testStepStarted":{"testCaseStartedId":"c1","testStepId":"s1","timestamp":` + ts(500, 0) + `}}`,
			`{"testStepFinished":{"testCaseStartedId":"c1","testStepId":"s1","testStepResult":{"duration":{"seconds":2,"nanos":0}}}}`,
			`{"testStepStarted":{"testCaseStartedId":"c1","testStepId":"zz","timestamp":` + ts(500, 0) + `}}`,
		}
		got := stepTimeLines(readStepTimes(partialReport(t, lines...), endedAt))
		want := []string{
			"Slowest Cucumber steps before the stop (from its report, slowest first):",
			"  2.0s: a hook (location not reported)",
			"  0.0s, still running when stopped: a step (location not reported)",
		}
		if !slices.Equal(got, want) {
			t.Fatalf("lines = %q, want %q", got, want)
		}
	})
	t.Run("equal wall times keep the order of first appearance (the hook is slower)", func(t *testing.T) {
		got := readStepTimes(partialReport(t, stepMessages([]int{500, 500}, false)...), endedAt)
		if len(got) != 3 || got[0].label != "a hook at features/steps/y.js line 2" || got[1].label != "acceptance.feature line 3: Given wait 1" || got[2].label != "acceptance.feature line 4: Given wait 2" {
			t.Fatalf("entries = %+v", got)
		}
	})
	t.Run("no report or no timed entry says so", func(t *testing.T) {
		want := []string{"Its Cucumber report recorded no step times before the stop."}
		for name, path := range map[string]string{
			"missing": filepath.Join(t.TempDir(), "none.ndjson"),
			"meta":    partialReport(t, `{"meta":{}}`, `{"source":{}}`, `not json`, `[1]`, `{"testCaseSta`),
		} {
			if got := stepTimeLines(readStepTimes(path, endedAt)); !slices.Equal(got, want) {
				t.Errorf("%s: lines = %q", name, got)
			}
		}
	})
}

func TestApprovalAcceptanceTimeoutLines(t *testing.T) {
	root := t.TempDir()
	s := sys.NewWith(os.Environ(), root)
	report := filepath.Join(root, "report.ndjson")
	feature := filepath.Join(root, ".kogen/intents/demo")
	if err := os.MkdirAll(feature, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(feature, "acceptance.feature"), []byte("Feature: F\n  Scenario: S\n    Given x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name, command string
		want          []string
	}{
		{"no report", "echo out-marker; sleep 30", []string{"Its Cucumber report recorded no step times before the stop."}},
		{"report with a step", `printf '%s\n' '{"hook":{"id":"h"}}' '{"testRunHookStarted":{"id":"r","hookId":"h","timestamp":{"seconds":1,"nanos":0}}}' > "$KOGEN_ACCEPTANCE_REPORT"; sleep 30`,
			[]string{"Slowest Cucumber steps before the stop (from its report, slowest first):"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			a := NewAttempt(root, "demo", nil)
			a.timeout = 1500 * time.Millisecond
			a.Plan("acceptance")
			_, err := RunAcceptance(a.Into(context.Background()), s, root, Tools{}, "demo", c.command, report, nil, nil)
			e, ok := sys.AsError(a.Refuse(err))
			if !ok || e.Reason != "step_timeout" {
				t.Fatalf("refusal = %v", e)
			}
			steps := slices.Index(e.Lines, "Steps that ran, with wall time (each step has its own 1s limit):")
			if steps < 0 {
				steps = slices.IndexFunc(e.Lines, func(l string) bool { return strings.HasPrefix(l, "Steps that ran, with wall time") })
			}
			first := slices.Index(e.Lines, c.want[0])
			if first < 0 || steps < 0 || first >= steps || slices.Index(e.Lines, "Command: "+c.command) >= first {
				t.Fatalf("lines = %q", e.Lines)
			}
			if c.name == "no report" && e.Lines[steps-1] != c.want[0] {
				t.Fatalf("the line is not right before the steps that ran: %q", e.Lines)
			}
		})
	}
}
