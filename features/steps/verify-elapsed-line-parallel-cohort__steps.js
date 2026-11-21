'use strict';
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { When, Then } = require('@cucumber/cucumber');

// Runs one existing Go test of the verify package, asynchronously, and keeps its output.
function runTest(name) {
  const args = ['test', './verify', '-run', `^${name}$`, '-count=1', '-v', '-timeout=100s'];
  return new Promise((resolve) => {
    const child = cp.spawn('go', args, { cwd: process.cwd() });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => resolve({ status: null, out: out + String(e) }));
    child.on('close', (status) => resolve({ status, out }));
  });
}

When('verify-elapsed-line-parallel-cohort: the focused Go test {string} runs', { timeout: 115000 }, async function (name) {
  this.cohortLineRuns = this.cohortLineRuns || {};
  this.cohortLineRuns[name] = await runTest(name);
});

Then('verify-elapsed-line-parallel-cohort: the focused Go test {string} reported PASS', function (name) {
  const r = this.cohortLineRuns && this.cohortLineRuns[name];
  const command = `go test ./verify -run ^${name}$ -count=1 -v`;
  assert.ok(r, `${name}: the test was not run via ${command}`);
  assert.equal(r.status, 0, `${name} via ${command}: exit ${r.status}\n${r.out}`);
  assert.match(r.out, new RegExp(`--- PASS: ${name} `), `${name} via ${command} was absent, skipped or ran zero times (exit ${r.status})\n${r.out}`);
});
