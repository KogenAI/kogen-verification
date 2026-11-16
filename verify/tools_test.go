package verify

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

func configWith(commands ...string) *project.Config {
	cfg := &project.Config{Acceptance: &project.Acceptance{Run: "true"}}
	for i, c := range commands {
		cfg.Checks = append(cfg.Checks, project.Check{Name: "c" + string(rune('a'+i)), Run: c})
	}
	return cfg
}

// ExUnit: contract_regressions_test.exs, SHP-2 quoted executable paths.
func TestQuotedExecutablePathsAndAssignmentValuesPassToolLookupWithoutExecution(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	tool := filepath.Join(root, "check tool")
	os.WriteFile(tool, []byte("#!/bin/sh\nprintf executed > check-was-run\n"), 0o755)
	s := sys.NewWith(testEnv(), root)
	for _, command := range []string{
		`"/usr/bin/true"`,
		`"./check tool"`,
		`LABEL="two words" /usr/bin/true`,
		`./check\ tool`,
		`A=1 B='x y' "./check tool" --flag`,
		`( /usr/bin/true )`,
		`! /usr/bin/true`,
		`{ /usr/bin/true`,
	} {
		if err := RequireTools(s, Tools{}, root, configWith(command), true); err != nil {
			t.Fatalf("%q: %v", command, err)
		}
	}
	if fileExists(filepath.Join(root, "check-was-run")) {
		t.Fatal("tool lookup executed a command")
	}
}

func TestMissingProgramsAreNamedAsToolMissingWithExit3(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	s := sys.NewWith(testEnv(), root)
	for _, tc := range []struct{ command, word string }{
		{"definitely-not-a-tool --x", "definitely-not-a-tool"},
		{"FOO=1 BAR=2 nope-tool", "nope-tool"},
		{"(nope-tool )", "nope-tool"},
		{"./not-there", "./not-there"},
		{"{ nope-tool; }", "nope-tool;"},
	} {
		err := RequireTools(s, Tools{}, root, configWith("true", tc.command), true)
		e := failWith(t, err, "environment", "tool_missing")
		eq(t, "detail", e.Detail, tc.word+" is not available")
		eq(t, "exit", e.Exit, 3)
	}
	// Commands are not looked at before a Build (configured false), and a blank command has
	// no program.
	if err := RequireTools(s, Tools{}, root, configWith("definitely-not-a-tool"), false); err != nil {
		t.Fatal(err)
	}
	if err := RequireTools(s, Tools{}, root, configWith("", "FOO=1"), true); err != nil {
		t.Fatal(err)
	}
}

func TestToolLookupResolvesKogenNodeFromTheCallersEnvironment(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	cfg := configWith(`"$KOGEN_NODE" --version`)
	s := sys.NewWith(append(testEnv(), "KOGEN_NODE=/bin/sh"), root)
	if err := RequireTools(s, Tools{}, root, cfg, true); err != nil {
		t.Fatal(err)
	}
	// The missing-value case must not inherit an installed harness's Node binding.
	s = sys.NewWith(append(testEnv(), "KOGEN_NODE="), root)
	e := failWith(t, RequireTools(s, Tools{}, root, cfg, true), "environment", "tool_missing")
	eq(t, "detail", e.Detail, "$KOGEN_NODE is not available")
	// Commands also get the Node Kogen recorded, so it counts when the caller has none.
	if err := RequireTools(s, Tools{Node: "/bin/sh"}, root, cfg, true); err != nil {
		t.Fatal(err)
	}
}

func TestUnclosedQuoteInAConfiguredCommandIsAnInternalFailure(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	s := sys.NewWith(testEnv(), root)
	err := RequireTools(s, Tools{}, root, configWith(`echo "unterminated`), true)
	if err == nil {
		t.Fatal("expected an error")
	}
	if _, ok := sys.AsError(err); ok {
		t.Fatal("a crash in Kogen is not a refusal")
	}
	eq(t, "message", err.Error(), `argv string did not terminate properly, a " was opened but never closed`)
}

func TestRunnerCheckAcceptsARunnerThatExitsZeroAndWritesAReport(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	s := sys.NewWith(testEnv(), root)
	var progress strings.Builder
	s.Stderr = &progress
	reason, output, err := RunnerCheck(context.Background(), s, Tools{}, root, `cat "$KOGEN_ACCEPTANCE_FEATURES"; echo '{}' > "$KOGEN_ACCEPTANCE_REPORT"`)
	if err != nil || reason != "" {
		t.Fatalf("reason %q, err %v", reason, err)
	}
	eq(t, "the feature the runner sees has no scenarios", output, "Feature: Kogen acceptance runner check\n")
	eq(t, "progress", progress.String(), "kogen: checking the acceptance runner\n")
	reason, output, _ = RunnerCheck(context.Background(), s, Tools{}, root, "echo nope; exit 4")
	eq(t, "failed", reason, "the runner check failed with status 4")
	eq(t, "output", output, "nope\n")
	reason, _, _ = RunnerCheck(context.Background(), s, Tools{}, root, "true")
	eq(t, "no report", reason, "the runner check wrote no report")
}

func TestRequireRunnerRefusesAnUnavailableRunner(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	s := sys.NewWith(testEnv(), root)
	ok := &project.Config{Acceptance: &project.Acceptance{Run: `echo '{}' > "$KOGEN_ACCEPTANCE_REPORT"`}}
	if err := RequireRunner(context.Background(), s, Tools{}, root, ok); err != nil {
		t.Fatal(err)
	}
	bad := &project.Config{Acceptance: &project.Acceptance{Run: `seq 1 100; exit 7`}}
	e := failWith(t, RequireRunner(context.Background(), s, Tools{}, root, bad), "environment", "acceptance_unavailable")
	eq(t, "detail", e.Detail, "the runner check failed with status 7; fix commands.acceptance.run in .kogen/project.yaml")
	eq(t, "exit", e.Exit, 3)
	eq(t, "excerpt, command and next lines", len(e.Lines), 53)
	eq(t, "omitted marker", e.Lines[30], "[... 50 lines omitted ...]")
	missing := &project.Config{Acceptance: &project.Acceptance{Run: "definitely-not-a-tool"}}
	failWith(t, RequireRunner(context.Background(), s, Tools{}, root, missing), "environment", "tool_missing")
}

const runnerExitNext = "next: fix commands.acceptance.run in .kogen/project.yaml (commit the change) so it exits 0 on a feature with no scenarios, then rerun the command that was refused"

func runnerRefusal(t *testing.T, command string) *sys.Error {
	t.Helper()
	root := t.TempDir()
	cfg := &project.Config{Acceptance: &project.Acceptance{Run: command}}
	return failWith(t, RequireRunner(context.Background(), sys.NewWith(testEnv(), root), Tools{}, root, cfg), "environment", "acceptance_unavailable")
}

func TestRequireRunnerFailureNamesCommandAndNextStep(t *testing.T) {
	t.Parallel()
	e := runnerRefusal(t, "echo boom; exit 7")
	eq(t, "detail", e.Detail, "the runner check failed with status 7; fix commands.acceptance.run in .kogen/project.yaml")
	eq(t, "exit", e.Exit, 3)
	eqSlice(t, "lines", e.Lines, []string{"boom", "commands.acceptance.run: echo boom; exit 7", runnerExitNext})
}

func TestRequireRunnerSilentFailureHasNoEmptyLine(t *testing.T) {
	t.Parallel()
	e := runnerRefusal(t, "sh -c 'exit 3'")
	eq(t, "detail", e.Detail, "the runner check failed with status 3; fix commands.acceptance.run in .kogen/project.yaml")
	eqSlice(t, "lines", e.Lines, []string{"commands.acceptance.run: sh -c 'exit 3'", runnerExitNext})
}

func TestRequireRunnerMissingReportSaysWhatToWrite(t *testing.T) {
	t.Parallel()
	e := runnerRefusal(t, "echo hi")
	eq(t, "detail", e.Detail, "the runner check wrote no report; fix commands.acceptance.run in .kogen/project.yaml")
	eqSlice(t, "lines", e.Lines, []string{
		"hi",
		"commands.acceptance.run: echo hi",
		"next: fix commands.acceptance.run in .kogen/project.yaml (commit the change) so it writes a Cucumber Messages report to the file named by $KOGEN_ACCEPTANCE_REPORT, then rerun the command that was refused",
	})
}

func TestRequireRunnerMasksLabelledSecretsInTheCommand(t *testing.T) {
	t.Parallel()
	e := runnerRefusal(t, "true --token abc123 && exit 7")
	eqSlice(t, "lines", e.Lines, []string{"commands.acceptance.run: true --token [REDACTED] && exit 7", runnerExitNext})
}

func TestToolsFromInstallResolveNodeAndTheBundledTools(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "node-path"), []byte("/opt/node/bin/node\n"), 0o644)
	got := ToolsFromInstall(root)
	eq(t, "node", got.Node, "/opt/node/bin/node")
	eq(t, "quint", got.Quint, filepath.Join(root, "lib/quint/node_modules/@informalsystems/quint/dist/src/cli.js"))
	eq(t, "cucumber", got.Cucumber, filepath.Join(root, "lib/cucumber/node_modules"))
	eq(t, "missing node-path", ToolsFromInstall(t.TempDir()).Node, "")
	e := failWith(t, got.Require(), "environment", "tool_missing")
	eq(t, "detail", e.Detail, "node is not available at /opt/node/bin/node; reinstall Kogen")
	node := filepath.Join(root, "node")
	os.WriteFile(node, []byte("#!/bin/sh\n"), 0o755)
	e = failWith(t, Tools{Node: node, Quint: filepath.Join(root, "q.js")}.Require(), "environment", "tool_missing")
	eq(t, "detail", e.Detail, "quint is not available at "+filepath.Join(root, "q.js")+"; reinstall Kogen")
}

func TestInstallToolFailuresAndPriority(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	np := filepath.Join(root, "node-path")
	node := filepath.Join(root, "node")
	pkg := filepath.Join(root, "lib/cucumber/node_modules/@cucumber/cucumber")
	write := func(path, content string, mode os.FileMode) {
		t.Helper()
		if err := os.WriteFile(path, []byte(content), mode); err != nil {
			t.Fatal(err)
		}
	}
	check := func(cause string, model bool) {
		t.Helper()
		tools := ToolsFromInstall(root)
		e := failWith(t, tools.RequireInstall(model), "environment", "tool_missing")
		if e.Exit != 3 || !strings.Contains(e.Detail, cause) || !strings.Contains(e.Detail, "reinstall Kogen") || (strings.HasPrefix(cause, "node") && !strings.Contains(e.Detail, np)) || (strings.HasPrefix(cause, "node target") && !strings.Contains(e.Detail, node)) {
			t.Fatalf("detail: %+v", e)
		}
	}
	check("node-path is missing", false)
	write(np, "\n", 0644)
	check("node-path is empty", false)
	if err := os.Chmod(np, 0000); err != nil {
		t.Fatal(err)
	}
	check("node-path is unreadable", false)
	if got := ToolsFromInstall(root).Node; got != "" {
		t.Fatalf("unreadable node-path exposed as Node: %q", got)
	}
	os.Chmod(np, 0644)
	write(np, " \n"+node+"\n", 0644)
	check("node target is missing", false)
	os.Mkdir(node, 0755)
	check("node target is not regular", false)
	os.Remove(node)
	write(node, "stub", 0644)
	check("node target is not executable", false)
	e := failWith(t, (Tools{Node: node}).Require(), "environment", "tool_missing")
	contains(t, "direct Node", e.Detail, "node is not available")
	os.Chmod(node, 0755)
	check("cucumber", true)
	os.MkdirAll(pkg, 0755)
	check("quint", true)
	if err := ToolsFromInstall(root).RequireInstall(false); err != nil {
		t.Fatal(err)
	}
}

const nopeToolNext = "next: install nope-tool or change that command in .kogen/project.yaml (commit the change), then rerun the command that was refused"

func requireMissing(t *testing.T, cfg *project.Config, detail string) *sys.Error {
	t.Helper()
	root := t.TempDir()
	e := failWith(t, RequireTools(sys.NewWith(testEnv(), root), Tools{}, root, cfg, true), "environment", "tool_missing")
	eq(t, "detail", e.Detail, detail)
	eq(t, "exit", e.Exit, 3)
	return e
}

func TestToolMissingNamesTheCheckAndNextStep(t *testing.T) {
	t.Parallel()
	e := requireMissing(t, configWith("nope-tool --x"), "nope-tool is not available")
	eqSlice(t, "lines", e.Lines, []string{"commands.checks[ca]: nope-tool --x", nopeToolNext})
}

func TestToolMissingNamesEveryCommandThatNeedsTheProgram(t *testing.T) {
	t.Parallel()
	cfg := &project.Config{
		Setup:      []string{"true", "nope-tool install"},
		Fix:        []string{"nope-tool fmt"},
		Checks:     []project.Check{{Name: "cb", Run: "nope-tool test"}, {Name: "other", Run: "true"}},
		Acceptance: &project.Acceptance{Run: "nope-tool accept"},
	}
	e := requireMissing(t, cfg, "nope-tool is not available")
	eqSlice(t, "lines", e.Lines, []string{
		"commands.setup[1]: nope-tool install",
		"commands.fix[0]: nope-tool fmt",
		"commands.checks[cb]: nope-tool test",
		"commands.acceptance.run: nope-tool accept",
		nopeToolNext,
	})
}

func TestToolMissingMasksLabelledSecretsInTheCommand(t *testing.T) {
	t.Parallel()
	e := requireMissing(t, configWith("nope-tool --token abc123"), "nope-tool is not available")
	eqSlice(t, "lines", e.Lines, []string{"commands.checks[ca]: nope-tool --token [REDACTED]", nopeToolNext})
}

func TestRequireRunnerNamesTheAcceptanceCommandWhenItsProgramIsMissing(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	cfg := &project.Config{Acceptance: &project.Acceptance{Run: "definitely-not-a-tool"}}
	err := RequireRunner(context.Background(), sys.NewWith(testEnv(), root), Tools{}, root, cfg)
	e := failWith(t, err, "environment", "tool_missing")
	eq(t, "detail", e.Detail, "definitely-not-a-tool is not available")
	eqSlice(t, "lines", e.Lines, []string{
		"commands.acceptance.run: definitely-not-a-tool",
		"next: install definitely-not-a-tool or change that command in .kogen/project.yaml (commit the change), then rerun the command that was refused",
	})
}

func TestToolMissingKogenNodeSaysReinstall(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	cfg := configWith(`"$KOGEN_NODE" --version`)
	e := failWith(t, RequireTools(sys.NewWith(append(testEnv(), "KOGEN_NODE="), root), Tools{Node: filepath.Join(root, "no-node")}, root, cfg, true), "environment", "tool_missing")
	eq(t, "detail", e.Detail, "$KOGEN_NODE is not available")
	eqSlice(t, "lines", e.Lines, []string{
		`commands.checks[ca]: "$KOGEN_NODE" --version`,
		"next: reinstall Kogen, then rerun the command that was refused",
	})
}

func TestMissingGitSaysInstallGit(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	empty := t.TempDir()
	s := sys.NewWith(testEnv("PATH="+empty), root)
	for _, configured := range []bool{false, true} {
		e := failWith(t, RequireTools(s, Tools{}, root, configWith("git status"), configured), "environment", "tool_missing")
		eq(t, "detail", e.Detail, "git is not available")
		eqSlice(t, "lines", e.Lines, []string{"next: install git, then rerun the command that was refused"})
	}
}
