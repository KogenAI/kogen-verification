package verify

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

// ModelResult is the Quint model check of one pass: not applicable ("none"), not run
// ("not_run"), passed ("ok") or failed with the problems found. Its JSON is `"none"`,
// `"not_run"`, `{"ok":[]}` or `{"failed":[problem, ...]}`, the values Kogen's records hold.
type ModelResult struct {
	State    string   `json:"state"` // "none", "not_run", "ok", "failed"
	Problems []string `json:"problems"`
}

var (
	ModelNone   = ModelResult{State: "none"}
	ModelNotRun = ModelResult{State: "not_run"}
)

// Failed reports whether the model check found problems.
func (m ModelResult) Failed() bool { return m.State == "failed" }

var hasModelTests = regexp.MustCompile(`\brun\s+\w*Test\w*\b`)

// Ignore comments and string literals while finding run declarations. Replacing them
// with whitespace also permits comments between the run keyword and its name.
var modelTrivia = regexp.MustCompile(`(?s)"(?:\\.|[^"\\])*"|//[^\n]*|/\*.*?\*/`)

var modelTestResults = regexp.MustCompile(`(?m)^\s*(?:ok|\d+\))\s+(\w+)\s+(?:passed|failed after)\s+\d+\s+test\(s\)`)

// CheckModel runs the Intent's Quint model in dir with Kogen's own Node and Quint and the
// TypeScript backend (VER-5): typecheck, test when the model has tests, and one run per
// declared invariant with the recorded seed and bounds. Every step runs; any failure fails
// the model, with Quint's output kept at both ends.
func CheckModel(ctx context.Context, s *sys.Session, dir string, tools Tools, m *project.ModelSpec, ev Evidence, log Logger) (ModelResult, error) {
	for _, inv := range m.Invariants {
		if strings.ContainsRune(inv, ',') || strings.IndexFunc(inv, unicode.IsSpace) >= 0 {
			return ModelResult{State: "failed", Problems: []string{"model.qnt: invalid invariant declaration " + strconv.Quote(inv)}}, nil
		}
	}
	text, err := os.ReadFile(filepath.Join(dir, m.Path))
	if err != nil {
		return ModelResult{}, err
	}
	type step struct {
		args      []string
		what      string // typecheck, test or run
		invariant string
	}
	steps := []step{{args: []string{"typecheck", m.Path}, what: "typecheck"}}
	if hasModelTests.Match(modelTrivia.ReplaceAll(text, []byte(" "))) {
		steps = append(steps, step{args: []string{"test", m.Path, "--backend", "typescript", "--match", "Test"}, what: "test"})
	}
	seen := make(map[string]bool)
	for _, inv := range m.Invariants {
		if seen[inv] {
			continue
		}
		seen[inv] = true
		steps = append(steps, step{
			args:      []string{"run", m.Path, "--backend", "typescript", "--invariant", inv, "--seed", m.Seed, "--max-samples", m.Samples, "--max-steps", m.Steps},
			what:      "run",
			invariant: inv,
		})
	}
	var problems []string
	for _, st := range steps {
		logEvent(log, map[string]any{"event": "command", "name": "model", "command": strings.Join(append([]string{"quint"}, st.args...), " "), "node": tools.Node})
		count(ev, "quint")
		words := []string{shellQuote(tools.Node), shellQuote(tools.Quint)}
		for _, a := range st.args {
			words = append(words, shellQuote(a))
		}
		name := "model-" + st.what
		if st.invariant != "" {
			name += "-" + st.invariant
		}
		timed, timing := timedContext(withStep(ctx, name, "model"))
		r, err := runStep(timed, s, tools, name, log, strings.Join(words, " "), dir, nil)
		event := map[string]any{"event": "command_result", "name": "model", "status": r.Status, "output": Cap(r.Output), "wall_ms": timing.wallMS}
		if err != nil {
			if timing.started {
				logEvent(log, event)
			}
			return ModelResult{}, err
		}
		if st.what == "test" {
			matches := modelTestResults.FindAllStringSubmatch(r.Output, -1)
			names := []string{}
			for _, match := range matches {
				names = append(names, match[1])
			}
			event["executed_tests"] = names
			event["executed_test_count"] = len(names)
			if r.Status == 0 && len(names) == 0 {
				problems = append(problems, "model.qnt: quint test executed no tests")
			}
		}
		logEvent(log, event)
		switch {
		case r.Status == 0:
		case st.invariant != "" && strings.Contains(r.Output, "[violation]"):
			problems = append(problems, "model.qnt: invariant "+st.invariant+" violated (seed "+m.Seed+")\n"+Diagnostic(r.Output))
		default:
			problems = append(problems, "model.qnt: quint "+st.what+" failed (status "+itoa(r.Status)+")\n"+Diagnostic(r.Output))
		}
	}
	if len(problems) == 0 {
		return ModelResult{State: "ok", Problems: []string{}}, nil
	}
	return ModelResult{State: "failed", Problems: problems}, nil
}
