'use strict';

// Steps of the acceptance sweep. They build the harness features/steps/testdata/sweepdriver
// once and run it; it calls verify.RunAcceptance on a fixture acceptance command and reports,
// as one JSON object, what the run returned and which processes still run 1.5 seconds later.

const { AfterAll, When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pkg = './features/steps/testdata/sweepdriver';
let binDir;
let driver;

function build() {
  if (driver) return driver;
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweepdriver-bin-'));
  const out = path.join(binDir, 'sweepdriver');
  const r = spawnSync('go', ['build', '-o', out, pkg], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw new Error(`go build -o ${out} ${pkg} failed (${r.error ? r.error.message : `exit ${r.status}`}):\n${r.stdout}${r.stderr}`);
  }
  driver = out;
  return driver;
}

AfterAll(function () {
  if (binDir) fs.rmSync(binDir, { recursive: true, force: true });
});

// drive runs the harness and returns its JSON report; exit 0 and 1 are reports, anything
// else is a harness failure.
function drive(args) {
  const bin = build();
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 90 * 1000 });
  const shown = `sweepdriver ${args.map((a) => JSON.stringify(a)).join(' ')}`;
  if (r.error || (r.status !== 0 && r.status !== 1)) {
    throw new Error(`${shown} failed (${r.error ? r.error.message : `exit ${r.status}`}):\n${r.stdout}${r.stderr}`);
  }
  try {
    return { shown, report: JSON.parse(r.stdout.trim().split('\n').pop()) };
  } catch (e) {
    throw new Error(`${shown} printed no JSON report (exit ${r.status}):\n${r.stdout}${r.stderr}`);
  }
}

// unescape reads \n and \\ in a step's string the way a JSON string does.
function unescape(s) {
  return JSON.parse(`"${s.replace(/"/g, '\\"')}"`);
}

When('the acceptance command starts a background server with {string}', { timeout: 300 * 1000 }, function (pattern) {
  this.sweep = drive(['run', pattern]);
});

Then('1.5 seconds after RunAcceptance returns, that server is stopped', function () {
  const { shown, report } = this.sweep;
  assert.equal(report.server, 'stopped',
    `${shown}: the server the acceptance command started is ${report.server} 1.5 seconds after RunAcceptance returned; report ${JSON.stringify(report)}`);
});

// On Linux the server must be stopped. macOS has no subreaper and keeps the marker sweep, which
// cannot attribute a server that holds neither marker, so there the server is not judged; the
// step records what it saw instead.
Then('on Linux, 1.5 seconds after RunAcceptance returns, that server is stopped', function () {
  const { shown, report } = this.sweep;
  if (process.platform !== 'linux') {
    this.log(`${shown}: not judged on ${process.platform} (no subreaper; the marker sweep is kept): the server is ${report.server} 1.5 seconds after RunAcceptance returned`);
    return;
  }
  assert.equal(report.server, 'stopped',
    `${shown}: on Linux the server the acceptance command started is ${report.server} 1.5 seconds after RunAcceptance returned; report ${JSON.stringify(report)}`);
});

Then('the processes the run did not start are still running', function () {
  const { shown, report } = this.sweep;
  const processes = {
    before: 'the detached, environment-cleared process started before the run',
    other: "the process carrying another run's KOGEN_ACCEPTANCE_RUN value",
    during: 'the detached, environment-cleared process started while the run ran',
  };
  for (const [key, what] of Object.entries(processes)) {
    assert.equal(report[key], 'running', `${shown}: ${what} is ${report[key]}; report ${JSON.stringify(report)}`);
  }
});

Then('the run returned exit status {int} and output {string}', function (status, output) {
  const { shown, report } = this.sweep;
  assert.equal(report.status, status, `${shown}: RunAcceptance returned status ${report.status}; report ${JSON.stringify(report)}`);
  assert.equal(report.output, unescape(output), `${shown}: RunAcceptance returned output ${JSON.stringify(report.output)}`);
});

When('RunAcceptance runs this acceptance command:', { timeout: 300 * 1000 }, function (command) {
  this.same = drive(['same', command]);
});

Then('its exit status and output are those of the same command run directly with sh -c', function () {
  const { shown, report } = this.same;
  assert.equal(report.status, report.direct_status,
    `${shown}: RunAcceptance returned status ${report.status}, /bin/sh -c exited ${report.direct_status}`);
  assert.equal(report.output, report.direct_output,
    `${shown}: RunAcceptance returned output ${JSON.stringify(report.output)}, /bin/sh -c printed ${JSON.stringify(report.direct_output)}`);
});

Then('its exit status is {int} and its output is {string}', function (status, output) {
  const { shown, report } = this.same;
  assert.equal(report.status, status, `${shown}: RunAcceptance returned status ${report.status}`);
  assert.equal(report.output, unescape(output), `${shown}: RunAcceptance returned output ${JSON.stringify(report.output)}`);
});

Then('its exit status is {int}', function (status) {
  const { shown, report } = this.same;
  assert.equal(report.status, status, `${shown}: RunAcceptance returned status ${report.status}`);
});

// The Linux files are not compiled by the checks on a macOS host; go vet with GOOS=linux
// compiles and vets every package and its tests for Linux.
When('the module is vetted for Linux', { timeout: 300 * 1000 }, function () {
  const r = spawnSync('go', ['vet', './...'], { encoding: 'utf8', env: { ...process.env, GOOS: 'linux' }, timeout: 280 * 1000 });
  this.linuxVet = { status: r.status, error: r.error, output: `${r.stdout}${r.stderr}` };
});

Then('go vet for Linux reported no problem', function () {
  const { status, error, output } = this.linuxVet;
  assert.ok(!error && status === 0, `GOOS=linux go vet ./... ${error ? `failed: ${error.message}` : `exited ${status}`}:\n${output}`);
});
