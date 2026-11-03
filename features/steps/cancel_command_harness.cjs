'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
let temp, root, binary;
const test = 'TestCancelCommandDriver';
function prepare() {
  if (binary) return;
  temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cancel-command-'));
  root = path.join(temp, 'repo');
  fs.cpSync(process.cwd(), root, { recursive: true, filter: p => !['.git', '.kogen', 'node_modules'].includes(path.basename(p)) });
  fs.copyFileSync(path.join(root, 'features/steps/testdata/cancelcommand/driver.go'), path.join(root, 'verify/cancel_command_acceptance_test.go'));
  binary = path.join(temp, 'driver');
  const r = spawnSync('go', ['test', '-c', '-o', binary, './verify'], { cwd: root, encoding: 'utf8', timeout: 180000 });
  assert.equal(r.status, 0, `go test -c ./verify for ${test}: ${r.error || ''}\n${r.stdout}${r.stderr}`);
}
function drive(route, mode, control = '') {
  prepare();
  const nonce = crypto.randomBytes(16).toString('hex');
  const report = path.join(temp, nonce + '.json');
  const command = `${binary} -test.run=^${test}$ -test.count=1`;
  const r = spawnSync(binary, [`-test.run=^${test}$`, '-test.count=1'], { cwd: root, encoding: 'utf8', timeout: 25000, env: { ...process.env, CANCEL_ROUTE: route, CANCEL_MODE: mode, CANCEL_CONTROL: control, CANCEL_REPORT: report, CANCEL_NONCE: nonce } });
  assert.ok(fs.existsSync(report), `${test}: ${command} wrote no report (absent, skipped, ran zero times or failed), exit ${r.status}: ${r.error || ''}\n${r.stdout}${r.stderr}`);
  const data = JSON.parse(fs.readFileSync(report, 'utf8'));
  fs.rmSync(report);
  assert.equal(r.status, 0, `${test}: ${command}, exit ${r.status}: ${r.stdout}${r.stderr}`);
  assert.equal(data.nonce, nonce, `${test}: ${command}, wrong report nonce, exit ${r.status}`);
  assert.equal(data.route, route, `${test}: ${command}, wrong route, exit ${r.status}`);
  assert.equal(data.mode, mode, `${test}: ${command}, wrong mode, exit ${r.status}`);
  return data;
}
function observe(data, expected) {
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(data[key], value, `${data.route}/${data.mode}: ${key}; report ${JSON.stringify(data)}`);
}
function cleanup() { if (temp) fs.rmSync(temp, { recursive: true, force: true }); temp = root = binary = undefined; }
module.exports = { drive, observe, cleanup };
