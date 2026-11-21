'use strict';
const { Given, When, Then } = require('@cucumber/cucumber');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

// The driver is built once per run, on first use, and reused by later scenarios.
let driverBuild;
function driverBinary() {
  if (!driverBuild) {
    driverBuild = new Promise((resolve, reject) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-exit-wrapper-'));
      const binary = path.join(dir, 'driver');
      const p = spawn('go', ['build', '-o', binary, './features/steps/verify-exit-wrapper-names-fitting-remedy__driver'], { cwd: process.cwd() });
      let err = '';
      p.stdout.on('data', d => { err += d; });
      p.stderr.on('data', d => { err += d; });
      p.on('error', reject);
      p.on('close', code => code === 0 ? resolve(binary) : reject(new Error(`go build of the stepcheck driver exited ${code}: ${err}`)));
    });
  }
  return driverBuild;
}

function runDriver(binary, body) {
  return new Promise((resolve, reject) => {
    const p = spawn(binary, [], { cwd: process.cwd() });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`stepcheck driver exited ${code}: ${err}`)));
    p.stdin.end(JSON.stringify({ body }));
  });
}

Given('verify-exit-wrapper-names-fitting-remedy: a step definition whose body is {string}', function (body) {
  this.wrapperBody = body;
});

When('verify-exit-wrapper-names-fitting-remedy: the step self-check analyses the definition', { timeout: 110000 }, async function () {
  const binary = await driverBinary();
  this.wrapperResult = await runDriver(binary, this.wrapperBody);
});

Then('verify-exit-wrapper-names-fitting-remedy: the definition is refused once', function () {
  const r = this.wrapperResult.refusals;
  assert.equal(r.length, 1, `refusals for body ${JSON.stringify(this.wrapperBody)}: ${JSON.stringify(r)}`);
  assert.equal(r[0].split('asserts an exit code').length - 1, 1, `refusal names more than one wrapper: ${r[0]}`);
});

Then('verify-exit-wrapper-names-fitting-remedy: the definition is not refused', function () {
  assert.deepEqual(this.wrapperResult.refusals, [], `refusals for body ${JSON.stringify(this.wrapperBody)}`);
});

Then('verify-exit-wrapper-names-fitting-remedy: the refusal contains {string}', function (text) {
  const r = this.wrapperResult.refusals;
  assert.ok(r.length >= 1 && r.every(m => m.includes(text)), `refusal should contain ${JSON.stringify(text)}: ${JSON.stringify(r)}`);
});

Then('verify-exit-wrapper-names-fitting-remedy: the refusal does not contain {string}', function (text) {
  const r = this.wrapperResult.refusals;
  assert.ok(r.length >= 1, `expected a refusal, got ${JSON.stringify(r)}`);
  assert.ok(r.every(m => !m.includes(text)), `refusal should not contain ${JSON.stringify(text)}: ${JSON.stringify(r)}`);
});

Then('verify-exit-wrapper-names-fitting-remedy: the refusal is exactly {string}', function (text) {
  assert.deepEqual(this.wrapperResult.refusals, [text]);
});
