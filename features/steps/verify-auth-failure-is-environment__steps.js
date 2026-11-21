'use strict';
const { When, Then } = require('@cucumber/cucumber');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

let driverPromise = null;
let driverDir = null;

function run(cmd, args, input, timeout) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => { clearTimeout(timer); resolve({ status: -1, stdout, stderr: String(error) }); });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}

function driver() {
  if (!driverPromise) {
    driverPromise = (async () => {
      driverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-auth-failure-'));
      process.on('exit', () => fs.rmSync(driverDir, { recursive: true, force: true }));
      const binary = path.join(driverDir, 'driver');
      const build = await run('go', ['build', '-o', binary, './features/steps/verify-auth-failure-is-environment__driver'], '', 100000);
      assert.equal(build.status, 0, `go build driver: ${build.stdout}\n${build.stderr}`);
      return binary;
    })();
  }
  return driverPromise;
}

When('verify-auth-failure-is-environment: EnvFailure receives status {int} and output {string}', { timeout: 120000 }, async function (status, output) {
  const binary = await driver();
  const result = await run(binary, [], JSON.stringify({ status, output: output.replace(/\\n/g, '\n') }), 10000);
  assert.equal(result.status, 0, `EnvFailure driver: ${result.stdout}\n${result.stderr}`);
  this.verifyAuthFailureResult = JSON.parse(result.stdout);
});

Then('verify-auth-failure-is-environment: its environment failure is {word} with line {string}', function (matched, line) {
  assert.deepEqual(this.verifyAuthFailureResult, { line, matched: matched === 'true' });
});
