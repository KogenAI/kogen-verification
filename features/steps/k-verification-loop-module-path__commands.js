const { Then } = require('@cucumber/cucumber');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');

Then('k-verification-loop-module-path: this command exits {int}:', { timeout: 240000 }, function (expected, command) {
  const result = spawnSync('/bin/sh', ['-c', command], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    timeout: 230000,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `Command: ${command}\nExpected exit ${expected}, got ${result.status}; signal ${result.signal}\n${result.stdout || ''}${result.stderr || ''}`);
});
