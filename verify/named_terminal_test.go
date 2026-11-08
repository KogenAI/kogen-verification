package verify

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

// A failing suite can report its selected test's terminal outcomes before a bounded
// stdout excerpt. The excerpt need not include that test's earlier run event.
func TestNamedFeedbackTerminalOutcomes(t *testing.T) {
	isolateTmp(t)
	tools := realTools(t)
	p := newProj(t)
	p.write("go.mod", "module nf\n\ngo 1.21\n")
	p.write("pkga/a_test.go", namedPkgA)
	p.write("features/steps/fixture_steps.js", `const { Then } = require('@cucumber/cucumber');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
Then('the suite reports completion of {string} in {string}', function (name, pkg) {
 const r = spawnSync('go', ['test', '-json', '-count=1', pkg], {encoding: 'utf8'});
 const outcomes = r.stdout.split('\n').filter(s => s.startsWith('{')).map(JSON.parse)
   .filter(x => x.Test === name && ['pass', 'fail', 'skip'].includes(x.Action));
 assert.fail('suite failed; selected outcomes=' + JSON.stringify(outcomes));
});
`)
	feature := `Feature: Completed tests in a failing suite
 Scenario: Passed test completed
  Then the suite reports completion of "TestPresent" in "./pkga"
 Scenario: Failed test completed
  Then the suite reports completion of "TestFails" in "./pkga"
 Scenario: Skipped test still skipped
  Then the suite reports completion of "TestSkipped" in "./pkga"
 Scenario: Absent test still absent
  Then the suite reports completion of "TestAbsent" in "./pkga"
`
	p.write(project.FeaturePath(fixtureSlug), feature)
	p.commit("terminal outcomes")
	s, _ := p.session()
	s.Env = append(p.Env, "GOWORK=off", "GOFLAGS=")
	got, err := RunAcceptance(context.Background(), s, p.Root, tools, fixtureSlug,
		cucumberRun("features/steps"), filepath.Join(p.Aux, "messages.ndjson"), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Scenarios) != 4 {
		t.Fatalf("scenarios: %v", got.Scenarios)
	}
	for _, sc := range got.Scenarios {
		if sc.Status != "failed" {
			t.Fatalf("suite failure lost: %v", sc)
		}
		switch sc.Name {
		case "Passed test completed", "Failed test completed":
			if len(sc.Unwritten) != 0 {
				t.Errorf("completed test marked unwritten: %s: %v", sc.Name, sc.Unwritten)
			}
		case "Skipped test still skipped":
			if len(sc.Unwritten) != 0 || sc.Detail == nil || !strings.Contains(*sc.Detail, "TestSkipped") {
				t.Errorf("skip evidence lost: %v", sc)
			}
		case "Absent test still absent":
			if len(sc.Unwritten) != 1 || !strings.Contains(sc.Unwritten[0], "TestAbsent: did not run") {
				t.Errorf("absent test not diagnosed: %v", sc.Unwritten)
			}
		}
	}
}
