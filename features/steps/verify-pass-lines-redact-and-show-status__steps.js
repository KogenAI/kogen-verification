'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), assert = require('node:assert/strict');
const { When, Then } = require('@cucumber/cucumber');

// The driver is a Go test added to package verify through a build overlay. It runs one real
// verification pass, one withheld-result wait and three Pass summaries, and writes what they
// printed and logged as JSON to the file named by PASS_LINES_REPORT.
const driver = String.raw`package verify

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

func TestPassLinesDriver(t *testing.T) {
	out := map[string]any{}

	p := newProj(t)
	p.Config.Setup = []string{"true --token abc123"}
	p.Config.Checks = []project.Check{{Name: "lint", Run: "true password=abc12345"}}
	s, stderr := p.session()
	log := &memLog{}
	in := p.input(1)
	in.Log = log
	pass, err := Verify(context.Background(), s, in)
	if err != nil {
		t.Fatal(err)
	}
	commands := map[string]string{}
	for _, e := range log.named("command") {
		commands[e["name"].(string)], _ = e["command"].(string)
	}
	setupRecord, checkRecord := "", ""
	if len(pass.Setup) > 0 {
		setupRecord = pass.Setup[0].Command
	}
	if len(pass.Checks) > 0 {
		checkRecord = pass.Checks[0].Command
	}
	out["stderr"] = stderr.String()
	out["commands"] = commands
	out["setupRecord"] = setupRecord
	out["checkRecord"] = checkRecord
	out["complete"] = pass.Complete(p.Config, mustScenarios(t), nil)

	old := noLiveGrace
	noLiveGrace = 50 * time.Millisecond
	defer func() { noLiveGrace = old }()
	root := t.TempDir()
	ws := sys.NewWith(testEnv(), root)
	const command = "true --token abc123"
	before := groupSet(ws)
	if _, err := ws.Run(command, root, sys.Options{}); err != nil {
		t.Fatal(err)
	}
	nlog := &memLog{}
	type answer struct {
		res sys.Result
		err error
	}
	got := make(chan answer, 1)
	go func() {
		res, err := awaitResult(ws, before, "acceptance", command, nlog, make(chan outcome))
		got <- answer{res, err}
	}()
	var a answer
	select {
	case a = <-got:
	case <-time.After(60 * time.Second):
		t.Fatal("the watch never gave up")
	}
	detail := ""
	if e, ok := sys.AsError(a.err); ok {
		detail = e.Detail
	}
	evCommands := []string{}
	for _, e := range nlog.named("command_no_progress") {
		c, _ := e["command"].(string)
		evCommands = append(evCommands, c)
	}
	out["detail"] = detail
	out["noProgressCommands"] = evCommands

	out["summaryFirst"] = Pass{N: 1, Failing: []string{"setup-1"}, Setup: []CommandResult{{Name: "setup-1", Status: 23}}, NotRun: []string{"setup-2", "acceptance"}}.Summary()
	out["summarySecond"] = Pass{N: 2, Failing: []string{"setup-2"}, Setup: []CommandResult{{Name: "setup-1", Status: 0}, {Name: "setup-2", Status: 127}}, NotRun: []string{"acceptance"}}.Summary()
	out["summaryNone"] = Pass{N: 3, Failing: []string{"setup-1"}, NotRun: []string{"acceptance"}}.Summary()

	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("PASS_LINES_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;

let pending = null;
function runDriver() {
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-lines-'));
      const root = process.cwd();
      const file = path.join(dir, 'driver_test.go');
      const overlay = path.join(dir, 'overlay.json');
      const report = path.join(dir, 'report.json');
      fs.writeFileSync(file, driver);
      fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(root, 'verify', 'pass_lines_driver_test.go')]: file } }));
      const args = ['test', '-overlay', overlay, './verify', '-run', '^TestPassLinesDriver$', '-count=1', '-v', '-timeout=100s'];
      const child = cp.spawn('go', args, { cwd: root, env: { ...process.env, PASS_LINES_REPORT: report } });
      let output = '';
      child.stdout.on('data', (d) => { output += d; });
      child.stderr.on('data', (d) => { output += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error('TestPassLinesDriver via go ' + args.join(' ') + ' exited ' + code + ':\n' + output));
        if (!/--- PASS: TestPassLinesDriver /.test(output)) return reject(new Error('TestPassLinesDriver was absent, skipped or ran zero times:\n' + output));
        try { resolve(JSON.parse(fs.readFileSync(report, 'utf8'))); } catch (e) { reject(new Error('no report from driver: ' + e.message + '\n' + output)); }
      });
    });
  }
  return pending;
}

const P = 'verify-pass-lines-redact-and-show-status: ';
When(P + 'the verification pass, the withheld-result wait and the pass summaries have run', { timeout: 115000 }, async function () {
  this.report = await runDriver();
});
Then(P + 'the progress line is exactly {string}', function (line) {
  assert.ok(this.report.stderr.split('\n').includes(line), 'progress lines were ' + JSON.stringify(this.report.stderr));
});
Then(P + 'stderr does not contain {string}', function (secret) {
  assert.ok(!this.report.stderr.includes(secret), 'stderr contains ' + secret + ': ' + JSON.stringify(this.report.stderr));
});
Then(P + 'the {string} command event has the command exactly {string}', function (name, command) {
  assert.equal(this.report.commands[name], command);
});
Then(P + 'the pass record keeps the commands {string} and {string} and is complete', function (setup, check) {
  assert.equal(this.report.setupRecord, setup);
  assert.equal(this.report.checkRecord, check);
  assert.equal(this.report.complete, true, 'Pass.Complete against the configuration');
});
Then(P + 'the stop detail is exactly {string}', function (detail) {
  assert.equal(this.report.detail, detail);
});
Then(P + 'the no-progress event command is exactly {string}', function (command) {
  assert.deepEqual(this.report.noProgressCommands, [command]);
});
Then(P + 'the {string} summary is exactly {string}', function (name, want) {
  const key = { first: 'summaryFirst', second: 'summarySecond', none: 'summaryNone' }[name];
  assert.ok(key, 'unknown summary ' + name);
  assert.equal(this.report[key], want);
});
