'use strict';

// Steps of the per-step sweep. They copy this checkout once (without .git, node_modules and
// .kogen) to a temporary folder, install features/steps/testdata/sweepsteps/driver.go there as
// verify/sweepsteps_acceptance_test.go and run its TestStepSweepAcceptanceDriver with go test
// for each case. The driver runs the fixture project's commands through the real verification
// entry points and writes one JSON report, which features/steps/sweep_steps_observer.js judges.

const { AfterAll, When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const observe = require('./sweep_steps_observer');

const test = 'TestStepSweepAcceptanceDriver';
let tmp;
let root;

function copy() {
  if (root) return root;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweepsteps-'));
  const dir = path.join(tmp, 'repo');
  fs.cpSync(process.cwd(), dir, { recursive: true, filter: (p) => !['.git', 'node_modules', '.kogen'].includes(path.basename(p)) });
  fs.copyFileSync(path.join(dir, 'features/steps/testdata/sweepsteps/driver.go'), path.join(dir, 'verify/sweepsteps_acceptance_test.go'));
  root = dir;
  return root;
}

AfterAll(function () {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

// drive runs the driver with these SWEEPSTEPS_* settings and returns its report.
function drive(settings) {
  const dir = copy();
  const result = path.join(tmp, `result-${Date.now()}.json`);
  const args = ['test', './verify', '-run', `^${test}$`, '-count=1'];
  const shown = `go ${args.join(' ')} (in a copy of the checkout, with ${Object.entries(settings).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')})`;
  const r = spawnSync('go', args, { cwd: dir, env: { ...process.env, ...settings, SWEEPSTEPS_RESULT: result }, encoding: 'utf8', timeout: 280 * 1000 });
  assert.ok(fs.existsSync(result),
    `${shown}: ${test} wrote no report (absent, skipped, ran zero times or failed): ${r.error ? r.error.message : `exit ${r.status}`}\n${r.stdout}${r.stderr}`);
  const report = JSON.parse(fs.readFileSync(result, 'utf8'));
  fs.rmSync(result, { force: true });
  return report;
}

const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

// unescape reads \n and \\ in a step's string the way a JSON string does.
function unescape(s) {
  return JSON.parse(`"${s.replace(/"/g, '\\"')}"`);
}

When('a builder verification pass runs with setup and check command {string}, which starts a detached {string}, next to a bystander {string} in its own session',
  { timeout: 300 * 1000 }, function (command, server, bystander) {
    this.sweepSteps = drive({ SWEEPSTEPS_MODE: 'verify', SWEEPSTEPS_COMMAND: command, SWEEPSTEPS_SERVER: server, SWEEPSTEPS_BYSTANDER: bystander });
  });

When('an approval readiness check runs with setup command {string}, which starts a detached {string}, next to a bystander {string} in its own session',
  { timeout: 300 * 1000 }, function (command, server, bystander) {
    this.sweepSteps = drive({ SWEEPSTEPS_MODE: 'readiness', SWEEPSTEPS_COMMAND: command, SWEEPSTEPS_SERVER: server, SWEEPSTEPS_BYSTANDER: bystander });
  });

When('an approval readiness check whose steps time out after {int} seconds runs with setup command {string}, which starts a detached {string}, next to a bystander {string} in its own session',
  { timeout: 300 * 1000 }, function (seconds, command, server, bystander) {
    this.sweepSteps = drive({ SWEEPSTEPS_MODE: 'timeout', SWEEPSTEPS_TIMEOUT: String(seconds), SWEEPSTEPS_COMMAND: command, SWEEPSTEPS_SERVER: server, SWEEPSTEPS_BYSTANDER: bystander });
  });

When('{int} builder verification passes run with setup and check command {string}', { timeout: 300 * 1000 }, function (passes, command) {
  this.sweepSteps = drive({ SWEEPSTEPS_MODE: 'quiet', SWEEPSTEPS_PASSES: String(passes), SWEEPSTEPS_COMMAND: command });
});

Then('after each of the steps {string} returned, no {string} the run started was running', function (steps, server) {
  observe.serversStoppedAfterEachStep(this.sweepSteps, list(steps), server);
});

Then('after the check returned, no {string} the run started was running', function (server) {
  observe.serversStoppedAfterRun(this.sweepSteps, server);
});

Then('the bystander {string} is still running', function (bystander) {
  observe.bystanderRunning(this.sweepSteps, bystander);
});

Then('the steps {string} exited {int} with output {string}, the same as the control run of the command', function (steps, status, output) {
  observe.sameAsControl(this.sweepSteps, list(steps), status, unescape(output));
});

Then('each of the steps {string} wrote exactly one {string} event naming it', function (steps, event) {
  observe.oneSweepEach(this.sweepSteps, list(steps), event);
});

Then('the step {string} timed out, as the control run of the command did', function (step) {
  observe.timedOut(this.sweepSteps, step);
});

Then('each pass wrote, for the steps {string} in this order, one {string} event each with exactly the fields {string} and stopped {int}',
  function (steps, event, fields, stopped) {
    observe.quietSweeps(this.sweepSteps, list(steps), event, list(fields), stopped);
  });

Then('each of the steps {string} took under {int} ms more than the control run of the command', function (steps, limit) {
  observe.overhead(this.sweepSteps, list(steps), limit);
});
