const {When, Then} = require('@cucumber/cucumber');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const run = promisify(execFile);
let binary;
When('verification-summary-names-failing-scenarios: I summarize this pass:', async function (text) {
 if (!binary) binary = (async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'summary-'));
  const bin = path.join(dir, 'driver');
  await run('go', ['build', '-o', bin, './features/steps/verification-summary-names-failing-scenarios__driver']);
  return bin;
 })();
 const bin = await binary;
 this.summary = await new Promise((resolve, reject) => {
  const child = execFile(bin, [], (err, stdout) => err ? reject(err) : resolve(stdout));
  child.stdin.end(text);
 });
});
Then('verification-summary-names-failing-scenarios: the summary is {string}', function (expected) {
 assert.equal(this.summary, expected);
});
