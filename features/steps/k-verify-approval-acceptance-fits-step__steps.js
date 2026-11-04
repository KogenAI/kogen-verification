'use strict';

// Steps of k-verify-approval-acceptance-fits-step. Nothing runs when this file is loaded. The
// approval steps share one prebuilt test binary for the whole run: the first step that needs it
// copies this checkout (without .git, node_modules and .kogen) to a temporary folder, installs
// the Go source of features/steps/k-verify-approval-acceptance-fits-step__driver.js there as
// verify/approvalfit_acceptance_test.go and builds the verify test binary once with
// `go test -c`; each scenario then runs that binary's TestApprovalFitAcceptanceDriver, which
// writes one JSON report that features/steps/k-verify-approval-acceptance-fits-step__observer.js
// judges. Child processes run asynchronously, so Cucumber's own report keeps each step's times.

const { AfterAll, Given, When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const observe = require('./k-verify-approval-acceptance-fits-step__observer');

const P = 'k-verify-approval-acceptance-fits-step: ';
const TEST = 'TestApprovalFitAcceptanceDriver';
const driver = require('./k-verify-approval-acceptance-fits-step__driver');
// The acceptance command configured in .kogen/project.yaml.
const ACCEPTANCE = 'NODE_PATH="$KOGEN_CUCUMBER" "$KOGEN_NODE" "$KOGEN_CUCUMBER/@cucumber/cucumber/bin/cucumber.js" --strict --require \'features/steps/*.js\' --format "message:$KOGEN_ACCEPTANCE_REPORT" "$KOGEN_ACCEPTANCE_FEATURES"';

let tmp;
let prebuilt;

// run starts file without blocking the event loop and resolves with its exit code (null when
// it did not exit normally), error and output.
function run(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      const code = !error ? 0 : (typeof error.code === 'number' ? error.code : null);
      resolve({ code, error, stdout, stderr });
    });
  });
}

function scratch() {
  if (!tmp) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'approvalfit-'));
  return tmp;
}

// testBinary builds the verify test binary with the driver installed once per run; every later
// call reuses it (and a failed build fails every caller with the same message).
function testBinary() {
  if (!prebuilt) {
    prebuilt = (async () => {
      const dir = path.join(scratch(), 'repo');
      fs.cpSync(process.cwd(), dir, { recursive: true, filter: (p) => !['.git', 'node_modules', '.kogen'].includes(path.basename(p)) });
      fs.writeFileSync(path.join(dir, 'verify/approvalfit_acceptance_test.go'), driver.source);
      const bin = path.join(scratch(), 'verify.test');
      const r = await run('go', ['test', '-c', '-o', bin, './verify'], { cwd: dir, timeout: 100 * 1000 });
      assert.equal(r.code, 0, `go test -c -o ${bin} ./verify (in a copy of the checkout with ${TEST} installed from features/steps/k-verify-approval-acceptance-fits-step__driver.js) failed: ${r.error ? r.error.message : ''}\n${r.stdout}${r.stderr}`);
      return { dir, bin };
    })();
  }
  return prebuilt;
}

AfterAll(function () {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

// drive runs the driver once with these APPROVALFIT_* settings and returns its report.
async function drive(settings) {
  const { dir, bin } = await testBinary();
  const result = path.join(scratch(), `result-${process.hrtime.bigint()}.json`);
  const args = ['-test.run', `^${TEST}$`, '-test.count=1', '-test.timeout=100s'];
  const shown = `${bin} ${args.join(' ')} (the prebuilt verify test binary, in verify of a copy of the checkout, with ${Object.entries(settings).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')})`;
  const r = await run(bin, args, { cwd: path.join(dir, 'verify'), env: { ...process.env, ...settings, APPROVALFIT_RESULT: result }, timeout: 110 * 1000 });
  assert.ok(fs.existsSync(result),
    `${shown}: ${TEST} wrote no report (absent, skipped, ran zero times or failed): ${r.error ? r.error.message : 'exit 0'}\n${r.stdout}${r.stderr}`);
  const report = JSON.parse(fs.readFileSync(result, 'utf8'));
  fs.rmSync(result, { force: true });
  return report;
}

Given(P + "the fixture Intent's acceptance feature:", function (text) {
  this.approvalFitFeature = text;
});

// Slashes are escaped: in a Cucumber expression a bare / separates alternatives.
Given(P + "the fixture's step file features\\/steps\\/fixture_steps.js:", function (text) {
  this.approvalFitSteps = text;
});

When(P + 'an approval readiness check bounded at {int} ms per step runs the real Cucumber over that fixture', { timeout: 115 * 1000 }, async function (bound) {
  this.approvalFit = await drive({ APPROVALFIT_FEATURE: this.approvalFitFeature, APPROVALFIT_STEPS: this.approvalFitSteps, APPROVALFIT_BOUND_MS: String(bound) });
});

When(P + 'an approval readiness check bounded at {int} ms per step runs the acceptance command {string}', { timeout: 115 * 1000 }, async function (bound, command) {
  this.approvalFit = await drive({ APPROVALFIT_COMMAND: command, APPROVALFIT_BOUND_MS: String(bound) });
});

When(P + 'an approval readiness check bounded at {int} ms per step runs the setup command {string}', { timeout: 115 * 1000 }, async function (bound, command) {
  this.approvalFit = await drive({ APPROVALFIT_SETUP: command, APPROVALFIT_BOUND_MS: String(bound) });
});

When(P + 'an approval readiness check with its unchanged step limit runs the acceptance command {string}', { timeout: 115 * 1000 }, async function (command) {
  this.approvalFit = await drive({ APPROVALFIT_COMMAND: command });
});

Then(P + 'the approval is refused with class {string}, reason {string} and exit {int}', function (cls, reason, exit) {
  observe.refused(this.approvalFit, cls, reason, exit);
});

Then(P + 'the refusal and its one retained approval attempt record give each approval step a limit of {int} seconds', function (seconds) {
  observe.limit(this.approvalFit, seconds);
});

Then(P + 'the approval is refused with step_timeout for the step {string} and one retained approval attempt record', function (step) {
  observe.timedOut(this.approvalFit, step);
});

Then(P + 'the refusal shows the output line {string}', function (line) {
  observe.shows(this.approvalFit, line);
});

Then(P + 'the refusal shows {string} after the output and before the steps that ran, followed by exactly these steps, slowest first:', function (header, table) {
  const expected = table.hashes().map((row) => ({ label: row.step, running: row['still running'] === 'yes', min: Number(row['at least seconds']) }));
  observe.slowest(this.approvalFit, header, expected);
});

Then(P + 'the refusal says {string} once, after the output and right before the steps that ran', function (line) {
  observe.noStepTimes(this.approvalFit, line);
});

Then(P + 'the refusal has no line {string}', function (line) {
  observe.lacks(this.approvalFit, line);
});

Then(P + 'the refusal lists no slowest steps', function () {
  observe.noEntries(this.approvalFit);
});

When(P + 'the configured acceptance command runs a feature without scenarios with a go command first on PATH that records each call', { timeout: 60 * 1000 }, async function () {
  const dir = fs.mkdtempSync(path.join(scratch(), 'nogo-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  const log = path.join(dir, 'go-calls.txt');
  fs.writeFileSync(log, '');
  fs.writeFileSync(path.join(dir, 'bin/go'), `#!/bin/sh\nprintf '%s\\n' "go $*" >> '${log}'\nexit 0\n`, { mode: 0o755 });
  const feature = path.join(dir, 'without-scenarios.feature');
  fs.writeFileSync(feature, 'Feature: Without scenarios\n');
  const env = { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, KOGEN_ACCEPTANCE_FEATURES: feature, KOGEN_ACCEPTANCE_REPORT: path.join(dir, 'report.ndjson') };
  const r = await run('/bin/sh', ['-c', ACCEPTANCE], { cwd: process.cwd(), env, timeout: 50 * 1000 });
  this.noGo = { command: ACCEPTANCE, code: r.code, error: r.error, output: r.stdout + r.stderr, calls: fs.readFileSync(log, 'utf8') };
});

Then(P + 'that acceptance run exits 0', function () {
  const r = this.noGo;
  assert.equal(r.code, 0, `${r.command} (in ${process.cwd()}, a feature without scenarios): ${r.error ? r.error.message : 'exit 0'}\n${r.output}`);
});

Then(P + 'the go command was not started', function () {
  assert.equal(this.noGo.calls, '', `loading features/steps/*.js for a feature without scenarios started go:\n${this.noGo.calls}`);
});

Then(P + 'the README section {string} reads:', function (heading, text) {
  const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
  const section = `\n### ${heading}\n\n${text}\n`;
  assert.ok(readme.includes(section), `README.md has the section ${JSON.stringify(heading)} reading exactly:\n${section}`);
});
