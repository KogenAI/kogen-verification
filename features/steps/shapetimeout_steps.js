'use strict';

// Steps of the Shape acceptance timeout evidence. They copy this checkout once (without .git,
// node_modules and .kogen) to a temporary folder, install
// features/steps/testdata/shapetimeout/driver.go there as verify/shapetimeout_acceptance_test.go
// and run its TestShapeTimeoutAcceptanceDriver with go test for each case. The driver runs one
// bounded Shape readiness check of the fixture project and writes one JSON report, which
// features/steps/shapetimeout_observer.js judges.

const { AfterAll, When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const observe = require('./shapetimeout_observer');

const test = 'TestShapeTimeoutAcceptanceDriver';
let tmp;
let root;

function copy() {
  if (root) return root;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shapetimeout-'));
  const dir = path.join(tmp, 'repo');
  fs.cpSync(process.cwd(), dir, { recursive: true, filter: (p) => !['.git', 'node_modules', '.kogen'].includes(path.basename(p)) });
  fs.copyFileSync(path.join(dir, 'features/steps/testdata/shapetimeout/driver.go'), path.join(dir, 'verify/shapetimeout_acceptance_test.go'));
  root = dir;
  return root;
}

AfterAll(function () {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

// drive runs the driver with these SHAPETIMEOUT_* settings and returns its report.
function drive(settings) {
  const dir = copy();
  const result = path.join(tmp, `result-${Date.now()}.json`);
  const args = ['test', './verify', '-run', `^${test}$`, '-count=1'];
  const shown = `go ${args.join(' ')} (in a copy of the checkout, with ${Object.entries(settings).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')})`;
  const r = spawnSync('go', args, { cwd: dir, env: { ...process.env, ...settings, SHAPETIMEOUT_RESULT: result }, encoding: 'utf8', timeout: 240 * 1000 });
  assert.ok(fs.existsSync(result),
    `${shown}: ${test} wrote no report (absent, skipped, ran zero times or failed): ${r.error ? r.error.message : `exit ${r.status}`}\n${r.stdout}${r.stderr}`);
  const report = JSON.parse(fs.readFileSync(result, 'utf8'));
  fs.rmSync(result, { force: true });
  return report;
}

When('a bounded Shape readiness check without a caller attempt runs the acceptance command {string} with a {int} ms bound',
  { timeout: 300 * 1000 }, function (command, bound) {
    this.shapeTimeout = drive({ SHAPETIMEOUT_COMMAND: command, SHAPETIMEOUT_BOUND_MS: String(bound) });
  });

When("a bounded Shape readiness check without a caller attempt runs the fixture's passing acceptance command with a {int} ms bound",
  { timeout: 300 * 1000 }, function (bound) {
    this.shapeTimeout = drive({ SHAPETIMEOUT_BOUND_MS: String(bound) });
  });

When("a bounded Shape readiness check without a caller attempt runs the acceptance command {string} after copying the fixture's failed report, with a {int} ms bound",
  { timeout: 300 * 1000 }, function (command, bound) {
    this.shapeTimeout = drive({ SHAPETIMEOUT_COMMAND: command, SHAPETIMEOUT_RED_REPORT: '1', SHAPETIMEOUT_BOUND_MS: String(bound) });
  });

When('a bounded Shape readiness check with a caller approval attempt bounded at {int} ms runs the acceptance command {string}',
  { timeout: 300 * 1000 }, function (bound, command) {
    this.shapeTimeout = drive({ SHAPETIMEOUT_COMMAND: command, SHAPETIMEOUT_ATTEMPT: '1', SHAPETIMEOUT_BOUND_MS: String(bound) });
  });

Then('the check is refused with class {string}, reason {string} and exit {int}', function (cls, reason, exit) {
  observe.refused(this.shapeTimeout, cls, reason, exit);
});

Then('the refusal detail is {string}', function (detail) {
  assert.equal(this.shapeTimeout.detail, detail, 'refusal detail');
});

Then('the first refusal line is {string}', function (line) {
  assert.equal((this.shapeTimeout.lines || [])[0], line, `first refusal line; text:\n${this.shapeTimeout.text}`);
});

Then('the refusal lines are exactly:', function (text) {
  assert.deepEqual(this.shapeTimeout.lines, text.split('\n'), 'refusal lines, in order');
});

Then('the refusal and its one retained private Shape attempt record report the stopped acceptance with its measured wall time, its output {string}, the labeled host load with its caveat and the evidence path',
  function (output) {
    observe.shapeTimeout(this.shapeTimeout, output);
  });

Then('the refusal and its one retained private Shape attempt record report the stopped acceptance with its measured wall time, that it wrote no output, the labeled host load with its caveat and the evidence path',
  function () {
    observe.shapeTimeout(this.shapeTimeout, null);
  });

Then('the check is ready with acceptance exit {int}', function (exit) {
  observe.ready(this.shapeTimeout, exit);
});

Then('no attempt evidence is retained and the result shows no evidence or host load line', function () {
  observe.noEvidence(this.shapeTimeout);
});

Then('the approval refusal shows the output {string} and names its single retained approval attempt record', function (output) {
  observe.approval(this.shapeTimeout, output);
});
