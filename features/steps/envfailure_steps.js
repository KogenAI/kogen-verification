'use strict';
const { When, Then } = require('@cucumber/cucumber');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

When('EnvFailure receives status {int} and output {string}', { timeout: 120000 }, function (status, output) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envfailure-'));
  try {
    const binary = path.join(tmp, 'driver');
    const build = spawnSync('go', ['build', '-o', binary, './features/steps/envfailure'], { encoding: 'utf8', timeout: 100000 });
    assert.equal(build.status, 0, `go build ./features/steps/envfailure: ${build.error || ''}\n${build.stdout}\n${build.stderr}`);
    const result = spawnSync(binary, [], {
      input: JSON.stringify({ status, output: output.replace(/\\n/g, '\n') }),
      encoding: 'utf8', timeout: 10000
    });
    assert.equal(result.status, 0, `EnvFailure driver: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    this.envFailureResult = JSON.parse(result.stdout);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
Then('its environment failure is {word} with line {string}', function (matched, line) {
  assert.deepEqual(this.envFailureResult, { line, matched: matched === 'true' });
});
