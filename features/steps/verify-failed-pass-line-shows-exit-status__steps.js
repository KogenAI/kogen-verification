'use strict';
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process'), assert = require('node:assert/strict');
const { When, Then } = require('@cucumber/cucumber');

// The driver is a Go test added to package verify through a build overlay; it writes the
// Summary of the three example passes as JSON to the file named by VFPL_REPORT.
const driver = String.raw`package verify

import (
	"encoding/json"
	"os"
	"testing"
)

func TestVerifyFailedPassLineDriver(t *testing.T) {
	out := map[string]string{
		"single":     Pass{N: 1, Failing: []string{"test"}, Checks: []CommandResult{{Name: "test", Status: 1}}}.Summary(),
		"several":    Pass{N: 2, Failing: []string{"lint", "test"}, Checks: []CommandResult{{Name: "lint", Status: 2}, {Name: "test", Status: 1}}}.Summary(),
		"acceptance": Pass{N: 3, Failing: []string{"acceptance"}, Acceptance: &Acceptance{Scenarios: []ScenarioResult{{Name: "A", Line: 9, Status: "failed"}}}, Checks: []CommandResult{{Name: "test", Status: 0}}}.Summary(),
	}
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("VFPL_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;

let pending = null;
function computeSummaries() {
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfpl-'));
      const root = process.cwd();
      const file = path.join(dir, 'driver_test.go');
      const overlay = path.join(dir, 'overlay.json');
      const report = path.join(dir, 'report.json');
      fs.writeFileSync(file, driver);
      fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(root, 'verify', 'vfpl_driver_test.go')]: file } }));
      const args = ['test', '-overlay', overlay, './verify', '-run', '^TestVerifyFailedPassLineDriver$', '-count=1', '-timeout=100s'];
      const child = cp.spawn('go', args, { cwd: root, env: { ...process.env, VFPL_REPORT: report } });
      let output = '';
      child.stdout.on('data', (d) => { output += d; });
      child.stderr.on('data', (d) => { output += d; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error('go ' + args.join(' ') + ' exited ' + code + ':\n' + output));
        try { resolve(JSON.parse(fs.readFileSync(report, 'utf8'))); } catch (e) { reject(new Error('no report from driver: ' + e.message + '\n' + output)); }
      });
    });
  }
  return pending;
}

When('verify-failed-pass-line-shows-exit-status: the example pass summaries have been computed', { timeout: 115000 }, async function () {
  this.vfplSummaries = await computeSummaries();
});

Then('verify-failed-pass-line-shows-exit-status: the {string} summary is exactly {string}', function (name, want) {
  assert.ok(this.vfplSummaries && name in this.vfplSummaries, 'no summary computed for ' + name);
  assert.equal(this.vfplSummaries[name], want);
});
