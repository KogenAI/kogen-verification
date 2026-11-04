package verify

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/KogenAI/kogen-coordinator/git"
	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

// Input is everything one verification pass needs.
type Input struct {
	PreviousRed        []string
	Dependencies       map[string][]string
	Root               string              // the user's checkout
	Repo               *git.Repo           // Git at Root; nil: git.New(Root, session env)
	Config             *project.Config     // the project's commands
	Intent             *project.Intent     // the Intent being built; its Model is the model to check
	MaintainedModels   []project.ModelSpec // explicitly supplied maintained models
	AcceptanceSuite    *AcceptanceSuite
	MaintainedFeatures []string // explicitly supplied repository-relative feature paths
	Start              string   // the HEAD the Build started from
	Excluded           []string // other uncommitted Intents' folders, left out of the candidate
	N                  int      // the pass number
	RunDir             string   // the run's evidence folder: acceptance-N.ndjson goes there
	Tools              Tools
	Log                Logger
	Evidence           Evidence
	// Stage, when set, makes the pass a scoped stage gate: the setup commands, then only the
	// stage's checks (named stage-<id>-<n>). Acceptance, models, maintained features and the project's checks
	// are not part of it, so such a pass is never whole-Intent proof.
	Stage *Stage
	// Intact is the baseline guard (VER-8): it returns the refusal when the approved baseline
	// changed. It runs after each fixer and after the pass's commands.
	Intact func() error
}

// Stage is the gate of one milestone of a staged Build.
type Stage struct {
	ID     string
	Checks []string
}

func (in Input) repo(s *sys.Session) *git.Repo {
	if in.Repo != nil {
		return in.Repo
	}
	return git.New(in.Root, s.Env)
}

func (in Input) intact() error {
	if in.Intact == nil {
		return nil
	}
	return in.Intact()
}

func (in Input) model() *project.ModelSpec {
	if in.Intent == nil || in.Intent.Model == nil || in.Intent.Model.None {
		return nil
	}
	return in.Intent.Model
}

func (in Input) acceptanceRun() string {
	if in.Config.Acceptance == nil {
		return ""
	}
	return in.Config.Acceptance.Run
}

// Run is a builder round's end (VER-6): the fixers once in the checkout, then a pass.
func Run(ctx context.Context, s *sys.Session, in Input) (Pass, error) {
	if err := Fix(ctx, s, in); err != nil {
		return Pass{}, err
	}
	return Verify(ctx, s, in)
}

// Fix runs `commands.fix` once, in order, in the checkout, checking the baseline after each.
func Fix(ctx context.Context, s *sys.Session, in Input) error {
	for i, cmd := range in.Config.Fix {
		name := fmt.Sprintf("fix-%d", i+1)
		logEvent(in.Log, map[string]any{"event": "command", "name": name, "command": cmd})
		timed, timing := timedContext(ctx)
		r, err := runStep(timed, s, in.Tools, name, in.Log, cmd, in.Root, nil)
		if timing.started {
			logEvent(in.Log, map[string]any{"event": "command_result", "name": name, "status": r.Status, "output": Cap(r.Output), "wall_ms": timing.wallMS})
		}
		if err != nil {
			return err
		}
		if err := in.intact(); err != nil {
			return err
		}
	}
	return nil
}

type item struct {
	name    string
	kind    string // setup, acceptance, model, check
	command string
	report  string
}

// Verify runs one pass over the current candidate (VER-6, VER-7, VER-9): the exact clean
// candidate tree is materialized into a `kogen-verify-*` scratch directory with a synthetic
// Git; setup commands run in order, then acceptance, the applicable model, maintained models, maintained features in supplied
// order, and the project's checks in declaration order, stopping between items at the first definitive red. The
// later items are named in NotRun. Files that changed in the scratch inputs or in the
// checkout while the checks ran make the pass not green. The scratch directory is removed
// whatever happens.
func Verify(ctx context.Context, s *sys.Session, in Input) (Pass, error) {
	s.Progress(fmt.Sprintf("kogen: verifying (pass %d)", in.N))
	repo := in.repo(s)
	before, err := repo.Tree(in.Start, in.Excluded)
	if err != nil {
		return Pass{}, err
	}
	var report string
	if in.RunDir != "" {
		report = filepath.Join(in.RunDir, fmt.Sprintf("acceptance-%d.ndjson", in.N))
	} else {
		dir := sys.TmpPath("kogen-verify-report")
		defer os.RemoveAll(dir)
		report = filepath.Join(dir, "acceptance.ndjson")
	}
	model := in.model()

	var items []item
	for i, cmd := range in.Config.Setup {
		items = append(items, item{fmt.Sprintf("setup-%d", i+1), "setup", cmd, ""})
	}
	if in.Stage != nil {
		for i, cmd := range in.Stage.Checks {
			items = append(items, item{fmt.Sprintf("stage-%s-%d", in.Stage.ID, i+1), "check", cmd, ""})
		}
	} else {
		items = append(items, item{"acceptance", "acceptance", "", ""})
		if model != nil {
			items = append(items, item{"model", "model", "", ""})
		}
		for _, m := range in.MaintainedModels {
			items = append(items, item{m.Path, "maintained", "", ""})
		}
		for _, f := range in.MaintainedFeatures {
			items = append(items, item{f, "feature", "", ""})
		}
		for _, c := range in.Config.Checks {
			items = append(items, item{c.Name, "check", c.Run, ""})
		}
	}

	ordinary, _ := schedule(items, nil, in.Dependencies)
	items, pulled := schedule(items, in.PreviousRed, in.Dependencies)
	effective := !slices.EqualFunc(items, ordinary, func(a, b item) bool { return a.name == b.name })

	reportDir, err := os.MkdirTemp("", "kogen-check-reports-")
	if err != nil {
		return Pass{}, err
	}
	defer os.RemoveAll(reportDir)
	for i := range items {
		if items[i].kind == "check" {
			items[i].report = filepath.Join(reportDir, fmt.Sprintf("%d.json", i))
		}
	}
	executed := map[string]bool{}
	p := Pass{N: in.N, Tree: before, Clean: true, Model: ModelNotRun, NotRun: []string{}, Setup: []CommandResult{}, Checks: []CommandResult{}, dependencyReordered: len(in.Dependencies) > 0}
	if effective {
		p.PulledForward = nonNil(pulled)
	}
	if in.Stage == nil {
		for _, m := range in.MaintainedModels {
			p.MaintainedModels = append(p.MaintainedModels, MaintainedModelResult{Path: m.Path, Result: ModelNotRun})
		}
		for _, f := range in.MaintainedFeatures {
			p.MaintainedFeatures = append(p.MaintainedFeatures, MaintainedFeatureResult{Path: f})
		}
	}
	if model == nil {
		p.Model = ModelNone
	}
	var checksStart, checksEnd time.Time
	scratchMoved, red, err := func() ([]string, bool, error) {
		scratch := sys.TmpPath("kogen-verify")
		defer os.RemoveAll(scratch)
		mat, err := repo.Materialize(before, scratch)
		if err != nil {
			return nil, false, err
		}
		if err := os.MkdirAll(filepath.Join(scratch, ".kogen/local"), 0o755); err != nil {
			return nil, false, err
		}
		if in.AcceptanceSuite != nil {
			files, err := suiteFiles(scratch, in.AcceptanceSuite.Location)
			if err != nil {
				return nil, false, err
			}
			p.UncoveredAcceptance = files
			p.UncoveredAcceptanceCount = new(int)
		}
		id := snapshotIdentity(s, in.Tools, before, scratch)
		if in.Log != nil {
			logEvent(in.Log, id.event())
			in.Log = &identityLogger{inner: in.Log, identity: id}
		}
		red := false
		for index := 0; index < len(items); index++ {
			it := items[index]
			if red {
				p.NotRun = append(p.NotRun, it.name)
				continue
			}
			if checksStart.IsZero() {
				checksStart = time.Now()
			}
			if !effective && len(in.Dependencies) == 0 && in.Stage == nil && it.kind == "check" && independentGo(it.command, s) && attemptFrom(ctx) == nil {
				end := index + 1
				for end < len(items) && items[end].kind == "check" && independentGo(items[end].command, s) {
					end++
				}
				if end-index > 1 {
					parallelIn := in
					parallelIn.Log = &lockedLogger{inner: in.Log}
					results, err := runCohort(ctx, s, parallelIn, scratch, items[index:end])
					checksEnd = time.Now()
					if err != nil {
						return nil, false, err
					}
					for offset, result := range results {
						if in.AcceptanceSuite != nil && !result.neverStarted {
							checkCoverage(scratch, items[index+offset].report, executed)
						}
						if !red {
							p.Checks = append(p.Checks, result.result)
							red = result.result.Status != 0
						} else if result.neverStarted {
							p.NotRun = append(p.NotRun, items[index+offset].name)
						} else if result.cancelled {
							p.Cancelled = append(p.Cancelled, result.result)
						} else {
							p.Speculative = append(p.Speculative, result.result)
						}
					}
					index = end - 1
					continue
				}
			}
			if effective {
				p.ExecutionOrder = append(p.ExecutionOrder, it.name)
			}
			switch it.kind {
			case "acceptance":
				a, err := RunAcceptance(ctx, s, scratch, in.Tools, in.Intent.Slug, in.acceptanceRun(), report, in.Evidence, in.Log)
				if err != nil {
					return nil, false, err
				}
				if in.AcceptanceSuite != nil {
					acceptanceCoverage(scratch, report, executed)
				}
				p.Acceptance = &a
				red = len(a.Problems) > 0
			case "feature":
				featureIndex := slices.Index(in.MaintainedFeatures, it.name)
				featureReport := fmt.Sprintf("%s-feature-%d.ndjson", report, featureIndex+1)
				os.Remove(featureReport)
				a, err := runFeature(ctx, s, scratch, in.Tools, it.name, in.acceptanceRun(), featureReport, in.Evidence, in.Log, true)
				if err != nil {
					return nil, false, err
				}
				if in.AcceptanceSuite != nil {
					acceptanceCoverage(scratch, featureReport, executed)
				}
				p.MaintainedFeatures[featureIndex].Result = &a
				red = len(a.Problems) > 0
			case "maintained":
				maintainedIndex := slices.IndexFunc(in.MaintainedModels, func(m project.ModelSpec) bool { return m.Path == it.name })
				m, err := CheckModel(ctx, s, scratch, in.Tools, &in.MaintainedModels[maintainedIndex], in.Evidence, in.Log)
				if err != nil {
					return nil, false, err
				}
				for i, problem := range m.Problems {
					m.Problems[i] = strings.Replace(problem, "model.qnt:", it.name+":", 1)
				}
				p.MaintainedModels[maintainedIndex].Result = m
				red = m.Failed()
			case "model":
				m, err := CheckModel(ctx, s, scratch, in.Tools, model, in.Evidence, in.Log)
				if err != nil {
					return nil, false, err
				}
				p.Model = m
				red = m.Failed()
			default:
				if it.kind == "setup" {
					s.Progress(fmt.Sprintf("kogen: running %s: %s", it.name, it.command))
					count(in.Evidence, "setup")
				}
				r, err := runLogged(ctx, s, in, scratch, it.name, it.command, it.report)
				if err != nil {
					return nil, false, err
				}
				if it.kind == "setup" {
					p.Setup = append(p.Setup, r)
				} else {
					p.Checks = append(p.Checks, r)
					if in.AcceptanceSuite != nil {
						checkCoverage(scratch, it.report, executed)
					}
				}
				red = r.Status != 0
			}
			checksEnd = time.Now()
		}
		if in.AcceptanceSuite != nil {
			uncovered := []string{}
			for _, path := range p.UncoveredAcceptance {
				if !executed[path] {
					uncovered = append(uncovered, path)
				}
			}
			p.UncoveredAcceptance = uncovered
			*p.UncoveredAcceptanceCount = len(uncovered)
		}
		moved, err := mat.Mutations()
		return moved, red, err
	}()
	if err != nil {
		return Pass{}, err
	}

	if err := in.intact(); err != nil {
		return Pass{}, err
	}
	after, err := repo.Tree(in.Start, in.Excluded)
	if err != nil {
		return Pass{}, err
	}
	changed, err := repo.Changed(before, after)
	if err != nil {
		return Pass{}, err
	}
	p.Moved = unique(slices.Concat(scratchMoved, changed))
	p.Failing = []string{}
	if p.Acceptance != nil && len(p.Acceptance.Problems) > 0 {
		p.Failing = append(p.Failing, "acceptance")
	}
	if p.Model.Failed() {
		p.Failing = append(p.Failing, "model")
	}
	for _, m := range p.MaintainedModels {
		if m.Result.Failed() {
			p.Failing = append(p.Failing, m.Path)
		}
	}
	for _, f := range p.MaintainedFeatures {
		if f.Result != nil && len(f.Result.Problems) > 0 {
			p.Failing = append(p.Failing, f.Path)
		}
	}
	for _, c := range slices.Concat(p.Setup, p.Checks) {
		if c.Status != 0 {
			p.Failing = append(p.Failing, c.Name)
		}
	}
	if in.AcceptanceSuite != nil && in.AcceptanceSuite.RequireFullCoverage && len(p.UncoveredAcceptance) > 0 {
		p.Failing = append(p.Failing, "uncovered acceptance: "+strings.Join(p.UncoveredAcceptance, ", "))
	}
	p.Green = !red && len(p.NotRun) == 0 && len(p.Failing) == 0 && len(p.Moved) == 0
	s.Progress(p.Summary())
	event := map[string]any{"event": "pass", "pass": in.N, "green": p.Green, "failing": p.Failing,
		"not_run": p.NotRun, "files_changed_while_checks_ran": p.Moved, "checks_wall_ms": int64(0)}
	if !checksStart.IsZero() {
		event["checks_wall_ms"] = checksEnd.Sub(checksStart).Milliseconds()
	}
	if effective {
		event["execution_order"] = p.ExecutionOrder
		event["pulled_forward"] = p.PulledForward
	}
	logEvent(in.Log, event)
	return p, nil
}

func unique(paths []string) []string {
	out := []string{}
	for _, p := range paths {
		if !slices.Contains(out, p) {
			out = append(out, p)
		}
	}
	return out
}

func runLogged(ctx context.Context, s *sys.Session, in Input, dir, name, command, report string) (CommandResult, error) {
	logEvent(in.Log, map[string]any{"event": "command", "name": name, "command": command, "cwd": dir})
	var env map[string]string
	if report != "" {
		env = map[string]string{"KOGEN_CHECK_REPORT": report}
	}
	timed, timing := timedContext(ctx)
	r, err := runStep(timed, s, in.Tools, name, in.Log, command, dir, env)
	if timing.started {
		logEvent(in.Log, map[string]any{"event": "command_result", "name": name, "status": r.Status, "output": Cap(r.Output), "wall_ms": timing.wallMS})
	}
	if err != nil {
		return CommandResult{}, err
	}
	return CommandResult{Name: name, Command: command, Status: r.Status, Output: r.Output}, nil
}

// RunAcceptance runs the acceptance command in root on the Intent's feature with
// KOGEN_ACCEPTANCE_FEATURES (the feature path relative to root), KOGEN_ACCEPTANCE_REPORT
// (report) and KOGEN_ACCEPTANCE_RUN (a fresh random value for this run), then accounts for its
// Cucumber Messages report (VER-3, VER-4). Like every step it is swept by runStepAs: however
// the command ends, every process it started that carries the run's value or holds its marker
// descriptor, with their descendants, is stopped before the step_sweep event, which comes
// before command_result. On Linux a per-run subreaper also stops descendants that carry neither
// marker.
func RunAcceptance(ctx context.Context, s *sys.Session, root string, tools Tools, slug, command, report string, ev Evidence, log Logger) (Acceptance, error) {
	return runFeature(ctx, s, root, tools, project.FeaturePath(slug), command, report, ev, log, false)
}

func runFeature(ctx context.Context, s *sys.Session, root string, tools Tools, feature, command, report string, ev Evidence, log Logger, maintained bool) (Acceptance, error) {
	count(ev, "acceptance")
	text, err := os.ReadFile(filepath.Join(root, feature))
	if err != nil {
		if maintained {
			return Acceptance{Status: 1, Scenarios: []ScenarioResult{}, Problems: []string{err.Error()}, BindingProblems: []string{}}, nil
		}
		return Acceptance{}, err
	}
	expected, err := project.ParseGherkin(string(text))
	if err != nil {
		if maintained {
			return Acceptance{Status: 1, Scenarios: []ScenarioResult{}, Problems: []string{fmt.Sprintf("%s: %v", feature, err)}, BindingProblems: []string{}}, nil
		}
		return Acceptance{}, fmt.Errorf("%s: %w", feature, err)
	}
	os.Remove(report)
	if err := os.MkdirAll(filepath.Dir(report), 0o755); err != nil {
		if maintained {
			return Acceptance{Status: 1, Scenarios: []ScenarioResult{}, Problems: []string{err.Error()}, BindingProblems: []string{}}, nil
		}
		return Acceptance{}, err
	}
	logEvent(log, map[string]any{"event": "command", "name": "acceptance", "command": command})
	timed, timing := timedContext(withStep(ctx, "acceptance", "acceptance"))
	r, err := runStepAs(timed, s, tools, "acceptance", log, command, root, map[string]string{
		"KOGEN_ACCEPTANCE_FEATURES": feature,
		"KOGEN_ACCEPTANCE_REPORT":   report,
	}, acceptanceMarker)
	if timing.started {
		logEvent(log, map[string]any{"event": "command_result", "name": "acceptance", "status": r.Status, "output": Cap(r.Output), "wall_ms": timing.wallMS})
	}
	if err != nil {
		var timeout *stepTimeout
		if errors.As(err, &timeout) {
			timeout.stepTimes = readStepTimes(report, timeout.step.EndedAt)
		}
		return Acceptance{}, err
	}
	return Account(root, feature, expected, report, r.Status, r.Output), nil
}
