'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), assert = require('node:assert/strict');
const { When, Then } = require('@cucumber/cucumber');

// The driver is a Go test added to package verify through a build overlay (nothing in the
// checkout changes). It runs a refused setup, a verification pass with a failing check, one
// concurrent check, a verification pass with a failing acceptance command and two Pass.Feedback
// calls on stored records, and writes what they returned and logged as JSON to the file named by
// OUTPUT_REDACT_REPORT.
const driver = String.raw`package verify

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

func TestOutputRedactDriver(t *testing.T) {
	isolateTmp(t)
	out := map[string]any{}

	// Setup refusal lines.
	p := newProj(t)
	p.Config.Setup = []string{"echo password=abc12345; exit 4"}
	r := p.readiness()
	s, _ := p.session()
	err := r.Setup(context.Background(), s, p.Root, false)
	lines := []string{}
	if e, ok := sys.AsError(err); ok && e.Reason == "setup_failed" {
		lines = e.Lines
	}
	out["setupLines"] = lines

	// A pass with a failing check.
	p = newProj(t)
	p.Config.Checks = []project.Check{{Name: "lint", Run: "echo password=abc12345; exit 1"}}
	s, _ = p.session()
	log := &memLog{}
	in := p.input(1)
	in.Log = log
	pass, err := Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	if len(pass.Checks) == 1 {
		out["checkOutput"] = pass.Checks[0].Output
		out["checkCommand"] = pass.Checks[0].Command
	}
	out["failing"] = pass.Failing
	for _, e := range log.named("command_result") {
		if e["name"] == "lint" {
			out["checkEventOutput"], _ = e["output"].(string)
		}
	}

	// A concurrent check.
	dir := t.TempDir()
	parent := sys.NewWith(testEnv(), dir)
	clog := &memLog{}
	res := runCohortCheck(context.Background(), make(chan struct{}), parent, Input{Log: clog}, dir, item{name: "vet", command: "echo password=abc12345"})
	if res.err != nil {
		t.Fatal(res.err)
	}
	out["cohortOutput"] = res.result.Output
	for _, e := range clog.named("command_result") {
		if e["name"] == "vet" {
			out["cohortEventOutput"], _ = e["output"].(string)
		}
	}

	// The acceptance command's output.
	p = newProj(t)
	p.Config.Acceptance.Run = "echo password=abc12345; exit 2"
	s, _ = p.session()
	pass, err = Verify(context.Background(), s, p.input(1))
	if err != nil {
		t.Fatal(err)
	}
	if pass.Acceptance != nil && len(pass.Acceptance.Problems) > 0 {
		out["acceptanceProblem"] = pass.Acceptance.Problems[0]
	}
	out["acceptanceFeedback"] = pass.Feedback(p.Config.Acceptance.Run, "")

	// Feedback of stored records.
	out["storedFeedback"] = Pass{N: 1, Checks: []CommandResult{{Name: "lint", Command: "lint --token abc123", Status: 1, Output: "login password=abc12345\n"}}}.Feedback("run", "")
	out["sectionFeedback"] = Pass{N: 2, Speculative: []CommandResult{{Name: "vet", Command: "vet --token abc123", Status: 2, Output: "bad password=abc12345\n"}}, Cancelled: []CommandResult{{Name: "slow", Command: "slow --token abc123", Status: -1, Output: "partial password=abc12345\n"}}}.Feedback("run", "")

	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("OUTPUT_REDACT_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;

let pending = null;
function runDriver() {
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'output-redact-'));
      const root = process.cwd();
      const file = path.join(dir, 'driver_test.go');
      const overlay = path.join(dir, 'overlay.json');
      const report = path.join(dir, 'report.json');
      fs.writeFileSync(file, driver);
      fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(root, 'verify', 'pass_output_redact_driver_test.go')]: file } }));
      const args = ['test', '-overlay', overlay, './verify', '-run', '^TestOutputRedactDriver$', '-count=1', '-v', '-timeout=100s'];
      const child = cp.spawn('go', args, { cwd: root, env: { ...process.env, OUTPUT_REDACT_REPORT: report } });
      let output = '';
      child.stdout.on('data', (d) => { output += d; });
      child.stderr.on('data', (d) => { output += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error('TestOutputRedactDriver via go ' + args.join(' ') + ' exited ' + code + ':\n' + output));
        if (!/--- PASS: TestOutputRedactDriver /.test(output)) return reject(new Error('TestOutputRedactDriver was absent, skipped or ran zero times:\n' + output));
        try { resolve(JSON.parse(fs.readFileSync(report, 'utf8'))); } catch (e) { reject(new Error('no report from driver: ' + e.message + '\n' + output)); }
      });
    });
  }
  return pending;
}

const P = 'verify-pass-output-redacts-labelled-secrets: ';
const text = (s) => s.replace(/\\n/g, '\n');
const hasLines = (feedback, first, second) => feedback.includes(first + '\n' + second);

When(P + 'the redaction driver has run', { timeout: 115000 }, async function () {
  this.report = await runDriver();
});
Then(P + 'the first setup refusal line is exactly {string} and no setup refusal line contains {string}', function (first, secret) {
  const lines = this.report.setupLines;
  assert.equal(lines[0], first, 'setup refusal lines were ' + JSON.stringify(lines));
  assert.ok(!lines.some((l) => l.includes(secret)), 'a setup refusal line contains ' + secret + ': ' + JSON.stringify(lines));
});
Then(P + 'the lint record output and command_result event output are both exactly {string}, its recorded command is exactly {string} and the failing items are exactly {string}', function (output, command, failing) {
  assert.equal(this.report.checkOutput, text(output), 'record output');
  assert.equal(this.report.checkEventOutput, text(output), 'command_result event output');
  assert.equal(this.report.checkCommand, command, 'recorded command');
  assert.deepEqual(this.report.failing, [failing], 'failing items');
});
Then(P + 'the concurrent check result output and command_result event output are both exactly {string}', function (output) {
  assert.equal(this.report.cohortOutput, text(output), 'result output');
  assert.equal(this.report.cohortEventOutput, text(output), 'command_result event output');
});
Then(P + 'the first acceptance problem is exactly {string} and the acceptance feedback does not contain {string}', function (problem, secret) {
  assert.equal(this.report.acceptanceProblem, text(problem));
  assert.ok(!this.report.acceptanceFeedback.includes(secret), 'feedback contains ' + secret + ': ' + JSON.stringify(this.report.acceptanceFeedback));
});
Then(P + 'the stored-record feedback has the line {string} immediately followed by the line {string} and contains neither {string} nor {string}', function (first, second, a, b) {
  const f = this.report.storedFeedback;
  assert.ok(hasLines(f, first, second), 'feedback was ' + JSON.stringify(f));
  assert.ok(!f.includes(a) && !f.includes(b), 'feedback contains a secret: ' + JSON.stringify(f));
});
Then(P + 'the section feedback has the lines {string}, {string}, {string} and {string} and contains neither {string} nor {string}', function (l1, l2, l3, l4, a, b) {
  const f = this.report.sectionFeedback;
  for (const l of [l1, l2, l3, l4]) assert.ok(f.split('\n').includes(l), 'missing line ' + JSON.stringify(l) + ' in ' + JSON.stringify(f));
  assert.ok(!f.includes(a) && !f.includes(b), 'feedback contains a secret: ' + JSON.stringify(f));
});
