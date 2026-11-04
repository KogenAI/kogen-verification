const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

When('k-consumes-verification: I run {string} offline', function (command) {
  this.consumesCommand = command;
  this.consumesResult = spawnSync('/bin/sh', ['-c', command], {
    encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GOPROXY: 'off', GOSUMDB: 'off' },
  });
});
Then('k-consumes-verification: the command succeeds', function () {
  const r = this.consumesResult;
  assert.equal(r.status, 0, `${this.consumesCommand}\n${r.stdout || ''}${r.stderr || ''}${r.error || ''}`);
});
Then('k-consumes-verification: the source map exists at {string}', function (path) {
  assert.ok(fs.readFileSync(path, 'utf8').trim().length > 0, `missing consumption audit: ${path}`);
});
Then('k-consumes-verification: file {string} has SHA-256 {string}', function (path, expected) {
  assert.equal(createHash('sha256').update(fs.readFileSync(path)).digest('hex'), expected, path);
});
