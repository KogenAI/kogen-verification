package verify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/KogenAI/kogen-coordinator/project"
)

// CommandResult is one setup command or project check that ran.
type CommandResult struct {
	Name    string `json:"name"`
	Command string `json:"command"`
	Status  int    `json:"status"`
	Output  string `json:"output"`
}

// MaintainedModelResult records the outcome for one supplied model.
type MaintainedModelResult struct {
	Path   string      `json:"path"`
	Result ModelResult `json:"result"`
}

// MaintainedFeatureResult records an acceptance result, or nil when not run.
type MaintainedFeatureResult struct {
	Path   string      `json:"path"`
	Result *Acceptance `json:"-"`
}

func (m MaintainedFeatureResult) MarshalJSON() ([]byte, error) {
	var result any = "not_run"
	if m.Result != nil {
		result = m.Result
	}
	return json.Marshal(struct {
		Path   string `json:"path"`
		Result any    `json:"result"`
	}{m.Path, result})
}

func (m *MaintainedFeatureResult) UnmarshalJSON(data []byte) error {
	var v struct {
		Path   string          `json:"path"`
		Result json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	m.Path, m.Result = v.Path, nil
	if string(v.Result) != `"not_run"` {
		var a Acceptance
		if err := json.Unmarshal(v.Result, &a); err != nil {
			return err
		}
		m.Result = &a
	}
	return nil
}

// Pass is one verification pass over the exact clean candidate Tree (VER-6 .. VER-9). Its
// JSON is what Kogen records for a pass: `acceptance` is `"not_run"` or the acceptance
// object, `model` is `"none"`, `"not_run"`, `{"ok":[]}` or `{"failed":[...]}`, and `not_run`
// names the required items an earlier failure kept from running.
type Pass struct {
	UncoveredAcceptance      []string
	UncoveredAcceptanceCount *int
	N                        int
	Clean                    bool
	Green                    bool
	Tree                     string
	Setup                    []CommandResult
	Acceptance               *Acceptance // nil: not run
	Model                    ModelResult
	MaintainedModels         []MaintainedModelResult
	MaintainedFeatures       []MaintainedFeatureResult
	Checks                   []CommandResult
	Speculative              []CommandResult
	Cancelled                []CommandResult
	NotRun                   []string
	Moved                    []string
	Failing                  []string

	// Legacy marks a recorded pass from before `setup` and `not_run` existed: complete clean
	// evidence of that kind stays reusable (VER-7).
	Legacy bool
}

type passJSON struct {
	UncoveredAcceptance      *[]string                 `json:"uncovered_acceptance,omitempty"`
	UncoveredAcceptanceCount *int                      `json:"uncovered_acceptance_count,omitempty"`
	N                        int                       `json:"n"`
	Clean                    bool                      `json:"clean"`
	Green                    bool                      `json:"green"`
	Tree                     string                    `json:"tree"`
	Setup                    any                       `json:"setup,omitempty"` // absent in a legacy record
	Acceptance               any                       `json:"acceptance"`
	Model                    any                       `json:"model"`
	MaintainedModels         []MaintainedModelResult   `json:"maintained_models,omitempty"`
	MaintainedFeatures       []MaintainedFeatureResult `json:"maintained_features,omitempty"`
	Checks                   []CommandResult           `json:"checks"`
	Speculative              []CommandResult           `json:"speculative,omitempty"`
	Cancelled                []CommandResult           `json:"cancelled,omitempty"`
	NotRun                   any                       `json:"not_run,omitempty"` // absent in a legacy record
	Moved                    []string                  `json:"moved"`
	Failing                  []string                  `json:"failing"`
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

// MarshalJSON writes the record Kogen keeps for a pass.
func (p Pass) MarshalJSON() ([]byte, error) {
	j := passJSON{N: p.N, Clean: p.Clean, Green: p.Green, Tree: p.Tree, Checks: nonNil(p.Checks),
		Speculative: p.Speculative, Cancelled: p.Cancelled, Moved: nonNil(p.Moved), Failing: nonNil(p.Failing), MaintainedModels: p.MaintainedModels, MaintainedFeatures: p.MaintainedFeatures}
	if p.UncoveredAcceptanceCount != nil {
		j.UncoveredAcceptance = &p.UncoveredAcceptance
		j.UncoveredAcceptanceCount = p.UncoveredAcceptanceCount
	}
	if !p.Legacy {
		j.Setup, j.NotRun = nonNil(p.Setup), nonNil(p.NotRun)
	}
	if p.Acceptance == nil {
		j.Acceptance = "not_run"
	} else {
		a := *p.Acceptance
		a.Scenarios, a.Problems, a.BindingProblems = nonNil(a.Scenarios), nonNil(a.Problems), nonNil(a.BindingProblems)
		j.Acceptance = a
	}
	switch p.Model.State {
	case "ok":
		j.Model = jmap{"ok": nonNil(p.Model.Problems)}
	case "failed":
		j.Model = jmap{"failed": nonNil(p.Model.Problems)}
	case "":
		j.Model = "not_run"
	default:
		j.Model = p.Model.State
	}
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(j); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(b.Bytes(), []byte("\n")), nil
}

// UnmarshalJSON reads a recorded pass.
func (p *Pass) UnmarshalJSON(data []byte) error {
	var present map[string]json.RawMessage
	if err := json.Unmarshal(data, &present); err != nil {
		return err
	}
	var j struct {
		UncoveredAcceptance      []string                  `json:"uncovered_acceptance"`
		UncoveredAcceptanceCount *int                      `json:"uncovered_acceptance_count"`
		N                        int                       `json:"n"`
		Clean                    bool                      `json:"clean"`
		Green                    bool                      `json:"green"`
		Tree                     string                    `json:"tree"`
		Setup                    []CommandResult           `json:"setup"`
		Acceptance               json.RawMessage           `json:"acceptance"`
		Model                    json.RawMessage           `json:"model"`
		MaintainedModels         []MaintainedModelResult   `json:"maintained_models"`
		MaintainedFeatures       []MaintainedFeatureResult `json:"maintained_features"`
		Checks                   []CommandResult           `json:"checks"`
		Speculative              []CommandResult           `json:"speculative"`
		Cancelled                []CommandResult           `json:"cancelled"`
		NotRun                   []string                  `json:"not_run"`
		Moved                    []string                  `json:"moved"`
		Failing                  []string                  `json:"failing"`
	}
	if err := json.Unmarshal(data, &j); err != nil {
		return err
	}
	*p = Pass{N: j.N, Clean: j.Clean, Green: j.Green, Tree: j.Tree, Setup: j.Setup, Checks: j.Checks,
		Speculative: j.Speculative, Cancelled: j.Cancelled, NotRun: j.NotRun, Moved: j.Moved, Failing: j.Failing, MaintainedModels: j.MaintainedModels, MaintainedFeatures: j.MaintainedFeatures}
	p.UncoveredAcceptance, p.UncoveredAcceptanceCount = j.UncoveredAcceptance, j.UncoveredAcceptanceCount
	_, hasSetup := present["setup"]
	_, hasNotRun := present["not_run"]
	p.Legacy = !hasSetup && !hasNotRun
	if len(j.Acceptance) > 0 && string(j.Acceptance) != `"not_run"` && string(j.Acceptance) != "null" {
		var a Acceptance
		if err := json.Unmarshal(j.Acceptance, &a); err != nil {
			return fmt.Errorf("pass acceptance: %w", err)
		}
		p.Acceptance = &a
	}
	var name string
	if err := json.Unmarshal(j.Model, &name); err == nil {
		p.Model = ModelResult{State: name}
		return nil
	}
	var tagged map[string][]string
	if err := json.Unmarshal(j.Model, &tagged); err != nil || len(tagged) != 1 {
		return fmt.Errorf("pass model: unreadable %s", j.Model)
	}
	for state, problems := range tagged {
		p.Model = ModelResult{State: state, Problems: problems}
	}
	if p.Model.State != "ok" && p.Model.State != "failed" {
		return fmt.Errorf("pass model: unknown %s", j.Model)
	}
	return nil
}

// Valid is the shape a recorded pass must have to be resumed from: clean, numbered, with a
// tree, a model value and well-formed acceptance, checks and not_run.
func (p Pass) Valid() bool {
	if !p.Clean || p.Tree == "" || p.Model.State == "" {
		return false
	}
	if p.Acceptance != nil && p.Acceptance.Scenarios == nil {
		return false
	}
	return true
}

// Complete is whether a recorded pass proves every required gate green for the current
// configuration, Intent and its expected scenarios, rather than trusting its Green flag
// (VER-7): clean, nothing moved or failing, nothing left unrun, acceptance exit 0 with every
// expected scenario passed exactly once, the model passed or not applicable, every check
// and (when the record has them) every setup command passed in declared order. Old clean
// passes without `setup` and `not_run` stay reusable.
func (p Pass) Complete(cfg *project.Config, expected []project.Scenario, model *project.ModelSpec) bool {
	if !p.Clean || !p.Green || len(p.Moved) != 0 || len(p.Failing) != 0 || p.Acceptance == nil || len(p.NotRun) != 0 || len(p.Speculative) != 0 || len(p.Cancelled) != 0 {
		return false
	}
	a := p.Acceptance
	if a.Status != 0 || len(a.Problems) != 0 || len(a.Scenarios) != len(expected) {
		return false
	}
	for i, e := range expected {
		s := a.Scenarios[i]
		if s.Line != e.Line || s.Name != e.Name || s.Status != "passed" {
			return false
		}
	}
	if a.Passed != len(expected) {
		return false
	}
	want := "ok"
	if model == nil || model.None {
		want = "none"
	}
	if p.Model.State != want || (want == "ok" && len(p.Model.Problems) != 0) {
		return false
	}
	if len(p.Checks) != len(cfg.Checks) {
		return false
	}
	for i, c := range cfg.Checks {
		if got := p.Checks[i]; got.Name != c.Name || got.Command != c.Run || got.Status != 0 {
			return false
		}
	}
	if p.Legacy {
		return true
	}
	if len(p.Setup) != len(cfg.Setup) {
		return false
	}
	for i, cmd := range cfg.Setup {
		if got := p.Setup[i]; got.Name != fmt.Sprintf("setup-%d", i+1) || got.Command != cmd || got.Status != 0 {
			return false
		}
	}
	return true
}

// NotRunSummary is `; not run because an earlier item failed: a, b` (empty for none), the
// tail of progress and stopped lines.
func NotRunSummary(names []string) string {
	if len(names) == 0 {
		return ""
	}
	return "; not run because an earlier item failed: " + strings.Join(names, ", ")
}

// NotRunNotice is NotRunSummary without its leading separator, for lines of its own.
func NotRunNotice(names []string) string {
	return strings.TrimPrefix(NotRunSummary(names), "; ")
}

// Summary is the progress line of a finished pass.
func (p Pass) Summary() string {
	var what string
	switch {
	case p.Green:
		what = "all checks passed"
	case len(p.Failing) > 0:
		what = strings.Join(p.Failing, ", ") + " failed"
	default:
		what = "files changed while the checks ran: " + strings.Join(p.Moved, ", ")
	}
	for _, section := range []struct {
		label   string
		results []CommandResult
	}{{"Speculative results", p.Speculative}, {"Cancelled work", p.Cancelled}} {
		if len(section.results) > 0 {
			names := make([]string, 0, len(section.results))
			for _, r := range section.results {
				names = append(names, r.Name)
			}
			what += "; " + section.label + ": " + strings.Join(names, ", ")
		}
	}
	return fmt.Sprintf("kogen: pass %d: %s%s", p.N, what, NotRunSummary(p.NotRun))
}

// ChecksLine is the commit report's account of a green pass.
func (p Pass) ChecksLine() string {
	model := "model passed"
	if p.Model.State == "none" {
		model = "model not applicable"
	}
	passed, total := 0, 0
	if p.Acceptance != nil {
		passed, total = p.Acceptance.Passed, len(p.Acceptance.Scenarios)
	}
	parts := []string{fmt.Sprintf("acceptance %d/%d", passed, total), model}
	for _, c := range p.Checks {
		parts = append(parts, c.Name+" passed")
	}
	return strings.Join(parts, ", ")
}

func indent(text string) string {
	lines := strings.Split(text, "\n")
	for i, l := range lines {
		lines[i] = "  " + l
	}
	return strings.Join(lines, "\n")
}

// Feedback is what goes back to the repair owner after a red pass. It is limited to
// 16,384 UTF-8 bytes, including a final omission notice. Only complete lines are
// retained; the notice counts original failing items with any omitted content once,
// and bytes omitted from the unbounded rendered tail. Records are not changed.
func (p Pass) Feedback(acceptanceRun, completion string) string {
	if completion == "" {
		completion = "finish"
	}
	var parts []feedbackPart
	add := func(text string, count int) { parts = append(parts, feedbackPart{text, count}) }
	add(fmt.Sprintf("Verification pass %d is not green. Fix the implementation (the approved acceptance files cannot change), then call %s again.", p.N, completion), 0)
	problems := func(ps []string, scenarios []ScenarioResult) {
		items := make([]feedbackItem, 0, len(ps))
		for _, problem := range ps {
			item := feedbackItem{text: indent(problem), detail: strings.TrimSpace(problem), name: problem}
			if match := feedbackInvariant.FindStringSubmatch(problem); match != nil {
				item.name = match[1]
				item.display = indent(normalizeFeedback(problem, item.name))
				item.detail = item.display
			}
			for _, sc := range scenarios {
				prefix := fmt.Sprintf("%s: %s (line %d)", sc.Status, sc.Name, sc.Line)
				if strings.HasPrefix(problem, prefix) && (len(problem) == len(prefix) || strings.HasPrefix(problem[len(prefix):], ":")) {
					item.name = sc.Name
					item.display = indent(normalizeFeedback(strings.TrimPrefix(problem[len(prefix):], ":"), sc.Name))
					item.detail = sc.Status + ":" + item.display
					break
				}
			}
			items = append(items, item)
		}
		for _, part := range groupFeedback(items, "scenarios") {
			parts = append(parts, part)
		}
	}
	if a := p.Acceptance; a != nil && len(a.Problems) > 0 {
		add(fmt.Sprintf("acceptance (%s): failed, exit status %d", acceptanceRun, a.Status), 0)
		problems(a.Problems, a.Scenarios)
	}
	if p.Model.Failed() {
		add("model: failed", 0)
		problems(p.Model.Problems, nil)
	}
	for _, m := range p.MaintainedModels {
		if m.Result.Failed() {
			add("model "+m.Path+": failed", 0)
			problems(m.Result.Problems, nil)
		}
	}
	for _, f := range p.MaintainedFeatures {
		if f.Result != nil && len(f.Result.Problems) > 0 {
			add(fmt.Sprintf("feature %s (%s): failed, exit status %d", f.Path, acceptanceRun, f.Result.Status), 0)
			problems(f.Result.Problems, f.Result.Scenarios)
		}
	}
	var commands []feedbackItem
	for _, c := range slices.Concat(p.Setup, p.Checks) {
		if c.Status != 0 {
			commands = append(commands, feedbackItem{text: fmt.Sprintf("check %s (%s): failed, exit status %d\n%s", c.Name, c.Command, c.Status, indent(Tail(c.Output, 60))), detail: strconv.Itoa(c.Status) + ":" + normalizeFeedback(Tail(c.Output, 60), c.Name), name: c.Name, display: indent(normalizeFeedback(Tail(c.Output, 60), c.Name))})
		}
	}
	parts = append(parts, groupFeedback(commands, "checks")...)
	for _, section := range []struct {
		label   string
		results []CommandResult
	}{{"Speculative results", p.Speculative}, {"Cancelled work", p.Cancelled}} {
		if len(section.results) > 0 {
			add(section.label, 0)
			var items []feedbackItem
			for _, r := range section.results {
				text := fmt.Sprintf("%s (%s): status %d\n%s", r.Name, r.Command, r.Status, indent(Tail(r.Output, 60)))
				if r.Status == 0 {
					// Passed results remain distinct and are not failing items.
					items = append(items, feedbackItem{text: text})
				} else {
					detail := normalizeFeedback(Tail(r.Output, 60), r.Name)
					items = append(items, feedbackItem{text: text, detail: strconv.Itoa(r.Status) + ":" + detail, name: r.Name, display: indent(detail)})
				}
			}
			parts = append(parts, groupFeedback(items, "checks")...)
		}
	}
	if line := coverageLine(p.UncoveredAcceptance); line != "" {
		add(line, 0)
	}
	for _, failure := range p.Failing {
		if strings.HasPrefix(failure, "uncovered acceptance: ") {
			add(failure, 0)
		}
	}
	if len(p.Moved) > 0 {
		add("files changed while checks ran: "+strings.Join(p.Moved, ", "), 0)
	}
	if len(p.NotRun) > 0 {
		add(NotRunNotice(p.NotRun), 0)
	}
	return limitFeedback(parts)
}

type feedbackPart struct {
	text  string
	count int
}
type feedbackItem struct{ text, detail, name, display string }

var feedbackInvariant = regexp.MustCompile(`^model\.qnt: invariant (.+?) violated \(seed [^)]*\)`)

var feedbackLineNumber = regexp.MustCompile(`(?i)(\bline\s+)[0-9]+`)

func normalizeFeedback(detail, name string) string {
	if name != "" {
		re := regexp.MustCompile(`(^|[^[:alnum:]_])` + regexp.QuoteMeta(name) + `($|[^[:alnum:]_])`)
		detail = re.ReplaceAllString(detail, "${1}${2}")
	}
	detail = feedbackLineNumber.ReplaceAllString(detail, "${1}")
	lines := strings.Split(strings.TrimSpace(detail), "\n")
	for i := range lines {
		lines[i] = strings.TrimSpace(lines[i])
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}
func groupFeedback(items []feedbackItem, label string) []feedbackPart {
	groups := map[string][]int{}
	for i, item := range items {
		if item.detail != "" {
			groups[item.detail] = append(groups[item.detail], i)
		}
	}
	var parts []feedbackPart
	for i, item := range items {
		group := groups[item.detail]
		if len(group) == 0 {
			parts = append(parts, feedbackPart{item.text, 0})
			continue
		}
		if group[0] != i {
			continue
		}
		if len(group) == 1 {
			parts = append(parts, feedbackPart{item.text, 1})
			continue
		}
		names := make([]string, 0, 5)
		for _, j := range group {
			if len(names) < 5 {
				names = append(names, items[j].name)
			}
		}
		display := item.text
		if item.display != "" {
			display = item.display
		}
		parts = append(parts, feedbackPart{display + fmt.Sprintf("\n  %d %s: %s", len(group), label, strings.Join(names, ", ")), len(group)})
	}
	return parts
}
func limitFeedback(parts []feedbackPart) string {
	const budget = 16384
	texts := make([]string, len(parts))
	for i := range parts {
		texts[i] = parts[i].text
	}
	full := strings.Join(texts, "\n")
	if len(full) <= budget {
		return full
	}
	// Each part occupies an interval in the joined output. An item intersecting the
	// omitted tail is counted even when an earlier line of that item was retained.
	starts := make([]int, len(parts))
	ends := make([]int, len(parts))
	pos := 0
	for i, part := range parts {
		starts[i] = pos
		pos += len(part.text)
		ends[i] = pos
		pos++
	}
	cut := 0
	for at := 0; at < len(full); {
		n := strings.IndexByte(full[at:], '\n')
		if n < 0 {
			break
		}
		next := at + n + 1
		if next > budget {
			break
		}
		cut = next
		at = next
	}
	for {
		count := 0
		for i, part := range parts {
			if ends[i] > cut && starts[i] < len(full) {
				count += part.count
			}
		}
		notice := fmt.Sprintf("left out %d items, %d bytes", count, len(full)-cut)
		if cut+len(notice) <= budget {
			return full[:cut] + notice
		}
		if cut == 0 {
			return notice
		}
		prev := strings.LastIndexByte(full[:cut-1], '\n')
		cut = prev + 1
	}
}

// Results is the green pass as the reviewer's material states it: scenarios passed, the
// model, and each check, one line each.
func (p Pass) Results() string {
	model := "model: passed"
	if p.Model.State == "none" {
		model = "model: not applicable"
	}
	scenarios := 0
	if p.Acceptance != nil {
		scenarios = len(p.Acceptance.Scenarios)
	}
	lines := []string{fmt.Sprintf("acceptance: passed (%d scenarios)", scenarios), model}
	for _, c := range p.Checks {
		lines = append(lines, "check "+c.Name+": passed")
	}
	return strings.Join(lines, "\n")
}
