package verify

import (
	"context"
	"encoding/json"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
)

func TestAttemptBoundsEachStepAndKeepsEvidence(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	s := sys.NewWith(os.Environ(), root)
	a := NewAttempt(root, "demo", nil)
	a.timeout = time.Second
	ctx := a.Into(context.Background())

	// A step within its bound passes; the bound is per step, not shared.
	for _, name := range []string{"setup-1", "setup-2"} {
		res, err := run(withStep(ctx, name, "setup"), s, Tools{}, "sleep 0.7; echo ok", root, nil)
		if err != nil || res.Status != 0 {
			t.Fatalf("%s: %v %+v", name, err, res)
		}
	}
	a.Plan("setup-1", "setup-2", "setup-3", "acceptance")
	_, err := run(withStep(ctx, "setup-3", "setup"), s, Tools{}, "echo started-then-blocked >&2; sleep 30 & wait", root, nil)
	refusal := a.Refuse(err)
	e, ok := sys.AsError(refusal)
	if !ok || e.Reason != "step_timeout" {
		t.Fatalf("error = %v, want a step timeout refusal", refusal)
	}
	text := e.Render()
	for _, want := range []string{"setup-3", "timed out after ", "started-then-blocked", "setup-1: passed in 0.", "Not run: acceptance", "does not establish the cause", "Evidence: "} {
		if !strings.Contains(text, want) {
			t.Errorf("the refusal lacks %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "git add") {
		t.Errorf("the refusal blames Git:\n%s", text)
	}
	path := text[strings.LastIndex(text, "Evidence: ")+len("Evidence: "):]
	raw, readErr := os.ReadFile(strings.TrimSpace(path))
	if readErr != nil {
		t.Fatal(readErr)
	}
	var rec struct {
		Outcome string `json:"outcome"`
		Steps   []struct {
			Name     string `json:"name"`
			TimedOut bool   `json:"timed_out"`
		} `json:"steps"`
		NotRun []string `json:"not_run"`
	}
	if err := json.Unmarshal(raw, &rec); err != nil || rec.Outcome != "refused" || len(rec.Steps) != 3 || !rec.Steps[2].TimedOut || rec.Steps[0].TimedOut {
		t.Errorf("evidence = %v %+v", err, rec)
	}
	if len(rec.NotRun) != 1 || rec.NotRun[0] != "acceptance" {
		t.Errorf("not_run = %v", rec.NotRun)
	}
}

func TestAttemptRefusalPassesInterruptsAndNonRefusalsThrough(t *testing.T) {
	t.Parallel()
	a := NewAttempt(t.TempDir(), "demo", nil)
	for _, err := range []error{context.Canceled, &sys.Interrupted{Signal: "SIGINT"}, os.ErrNotExist} {
		if got := a.Refuse(err); got != err {
			t.Errorf("Refuse(%v) = %v, want it unchanged", err, got)
		}
	}
	// A refusal before any command ran (a lint error) is not an attempt's failure.
	lint := sys.Fail("intent", "lint", "bad", 1)
	if got := a.Refuse(lint); got != error(lint) {
		t.Errorf("a refusal before any step = %v", got)
	}
}

func TestAttemptUnknownTimeoutOutput(t *testing.T) {
	t.Parallel()
	for _, partial := range []bool{false, true} {
		t.Run(map[bool]string{false: "unavailable", true: "partial"}[partial], func(t *testing.T) {
			root := t.TempDir()
			a := NewAttempt(root, "demo", NewRedactor([]string{"TOKEN=secret-value"}, ""))
			st := &AttemptStep{Name: "acceptance", Kind: "acceptance", Command: "test", Status: "timed_out", TimedOut: true, OutputUnavailable: true}
			if partial {
				st.Output = Cap(a.Redact("partial-marker secret-value " + strings.Repeat("x", 2<<20)))
			}
			a.add(st, a.started, time.Now())
			timeout := &stepTimeout{step: st, unknown: true}
			wantTimes := []string{"Its Cucumber report recorded no step times before the stop."}
			if partial {
				timeout.stepTimes = []timedEntry{{label: "acceptance.feature line 3: Given secret-value", wall: 2500 * time.Millisecond, running: true}}
				wantTimes = []string{"Slowest Cucumber steps before the stop (from its report, slowest first):", "  2.5s, still running when stopped: acceptance.feature line 3: Given " + Redacted}
			}
			err := a.Refuse(timeout)
			e, ok := sys.AsError(err)
			if !ok || e.Class != "environment" || e.Reason != "step_timeout" {
				t.Fatalf("refusal: %v", err)
			}
			// Even when the group could not be observed to end, the report's step times come right
			// before the steps that ran.
			ran := slices.IndexFunc(e.Lines, func(l string) bool { return strings.HasPrefix(l, "Steps that ran, with wall time") })
			if ran < len(wantTimes) || !slices.Equal(e.Lines[ran-len(wantTimes):ran], wantTimes) {
				t.Fatalf("step time lines = %q, want %q right before the steps that ran", e.Lines, wantTimes)
			}
			text := e.Render()
			if !strings.Contains(text, "Its output could not be read.") || strings.Contains(text, "It wrote no output") || strings.Contains(text, "secret-value") {
				t.Fatalf("refusal: %s", text)
			}
			if partial && (!strings.Contains(text, "Its output before it was stopped") || !strings.Contains(text, "partial-marker") || !strings.Contains(text, Redacted)) {
				t.Fatalf("missing partial output: %s", text)
			}
			path := strings.TrimSpace(text[strings.LastIndex(text, "Evidence: ")+len("Evidence: "):])
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var rec attemptRecord
			if err := json.Unmarshal(raw, &rec); err != nil {
				t.Fatal(err)
			}
			if len(rec.Steps) != 1 || !rec.Steps[0].OutputUnavailable || rec.Steps[0].Exit != nil || rec.Steps[0].Output != st.Output {
				t.Fatalf("bad retained step: %+v", rec.Steps)
			}
			if partial && (len(st.Output) >= 2<<20 || strings.Contains(string(raw), "secret-value")) {
				t.Fatal("output not capped or redacted")
			}
		})
	}
}
