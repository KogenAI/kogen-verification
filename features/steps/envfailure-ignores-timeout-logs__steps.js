'use strict';
const { When, Then } = require('@cucumber/cucumber');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

let driverBuild;

function run(command, args, input, timeout) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (error) => { clearTimeout(timer); resolve({ status: -1, stdout, stderr: stderr + String(error) }); });
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    child.stdin.end(input);
  });
}

function driver() {
  if (!driverBuild) {
    driverBuild = (async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envfailure-timeout-'));
      process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
      const binary = path.join(tmp, 'driver');
      const build = await run('go', ['build', '-o', binary, './features/steps/envfailure'], '', 100000);
      assert.equal(build.status, 0, `go build ./features/steps/envfailure: ${build.stdout}\n${build.stderr}`);
      return binary;
    })();
  }
  return driverBuild;
}

When('envfailure-ignores-timeout-logs: EnvFailure receives status {int} and output {string}', { timeout: 120000 }, async function (status, output) {
  const binary = await driver();
  const result = await run(binary, [], JSON.stringify({ status, output: output.replace(/\\n/g, '\n').replace(/\\t/g, '\t') }), 10000);
  assert.equal(result.status, 0, `EnvFailure driver exit ${result.status}\n${result.stdout}\n${result.stderr}`);
  this.envFailureTimeoutResult = JSON.parse(result.stdout);
});

Then('envfailure-ignores-timeout-logs: its environment failure is {word} with line {string}', function (matched, line) {
  assert.deepEqual(this.envFailureTimeoutResult, { line, matched: matched === 'true' });
});
