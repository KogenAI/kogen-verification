'use strict';
const { Given, When, Then } = require('@cucumber/cucumber');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const DRIVER = './features/steps/runner-refusal-names-command-and-next-step__driver';
let built = null;

function run(command, args, timeout) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => { clearTimeout(timer); resolve({ status: -1, stdout, stderr: stderr + String(error) }); });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

// The driver is built once per run, on first use.
function driverBinary() {
  if (!built) {
    built = (async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-refusal-'));
      process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
      const binary = path.join(dir, 'driver');
      const res = await run('go', ['build', '-o', binary, DRIVER], 100000);
      assert.equal(res.status, 0, `go build ${DRIVER}:\n${res.stdout}\n${res.stderr}`);
      return binary;
    })();
  }
  return built;
}

Given('runner-refusal-names-command-and-next-step: the acceptance command is:', function (docString) {
  this.runnerCommand = docString;
});

When('runner-refusal-names-command-and-next-step: the runner is required', { timeout: 115000 }, async function () {
  const binary = await driverBinary();
  const res = await run(binary, [this.runnerCommand], 30000);
  assert.equal(res.status, 0, `driver for ${JSON.stringify(this.runnerCommand)} exited ${res.status}:\n${res.stdout}\n${res.stderr}`);
  this.refusal = JSON.parse(res.stdout);
});

Then('runner-refusal-names-command-and-next-step: the refusal is {word} with exit code {int} and detail {string}', function (kind, exit, detail) {
  const [cls, reason] = kind.split('/');
  assert.equal(this.refusal.class, cls);
  assert.equal(this.refusal.reason, reason);
  assert.equal(this.refusal.exit, exit);
  assert.equal(this.refusal.detail, detail);
});

Then('runner-refusal-names-command-and-next-step: the refusal lines are exactly:', function (docString) {
  assert.deepEqual(this.refusal.lines, docString.split('\n'));
});

Then('runner-refusal-names-command-and-next-step: no refusal line contains {string}', function (text) {
  for (const line of this.refusal.lines) {
    assert.ok(!line.includes(text), `a refusal line contains ${JSON.stringify(text)}: ${JSON.stringify(line)}`);
  }
});

Then('runner-refusal-names-command-and-next-step: the refusal has {int} lines and line {int} is {string}', function (count, n, line) {
  assert.equal(this.refusal.lines.length, count);
  assert.equal(this.refusal.lines[n - 1], line);
});
