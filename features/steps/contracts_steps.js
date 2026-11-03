const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const observe = require('./contracts_observer');
When('I discover Go packages using the ordinary pattern {string}', function (pattern) {
  this.contractDiscovery = spawnSync('go', ['list', pattern], { encoding: 'utf8' });
});
Then('the discovered packages include {string}', function (name) {
  const r = this.contractDiscovery;
  assert.equal(r.status, 0, `go list ./...: ${r.stderr || r.error || ''}`);
  assert.ok(r.stdout.trim().split('\n').includes(name), `go list ./... did not discover ${name}`);
});
When('I run the producer contract package {string} offline', function (pkg) {
  this.contractCommand = `go test -json -count=1 ${pkg}`;
  this.contractRun = spawnSync('go', ['test', '-json', '-count=1', pkg], {
    encoding: 'utf8', env: { ...process.env, GOPROXY: 'off', GOSUMDB: 'off' }, maxBuffer: 16 * 1024 * 1024,
  });
});
Then('the contract package executes passing tests without skips', function () {
  const r = this.contractRun;
  const diagnostic = `${this.contractCommand}: ${r.stdout || ''}${r.stderr || ''}${r.error || ''}`;
  assert.equal(r.status, 0, diagnostic);
  try { observe(r.stdout); } catch (e) { assert.fail(`${e.message}\n${diagnostic}`); }
});
