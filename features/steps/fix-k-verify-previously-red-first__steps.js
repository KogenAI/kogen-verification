'use strict';
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AfterAll, When, Then } = require('@cucumber/cucumber');
const observe = require('./fix-k-verify-previously-red-first__observer.js');

const P = 'fix-k-verify-previously-red-first: ';
const TEST = 'TestFixPreviouslyRedFirstReloadDriver';
const DRIVER = path.join(__dirname, 'fix-k-verify-previously-red-first__driver.js');

let tmp;
let prebuilt;

const scratch = () => {
  if (!tmp) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-previous-red-reload-'));
  return tmp;
};

// run starts file without blocking the event loop and resolves with its exit code (null when
// it did not exit normally), error and output.
const run = (file, args, options) => new Promise((resolve) => {
  execFile(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
    const code = !error ? 0 : (typeof error.code === 'number' ? error.code : null);
    resolve({ code, error, stdout, stderr });
  });
});

// testBinary builds the verify test binary with the driver once per run; later calls reuse it
// (and a failed build fails every caller with the same message).
const testBinary = () => {
  if (!prebuilt) {
    prebuilt = (async () => {
      const root = process.cwd();
      const driver = path.join(scratch(), 'driver_test.go');
      fs.writeFileSync(driver, require(DRIVER));
      const overlay = path.join(scratch(), 'overlay.json');
      fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(root, 'verify', 'fix_k_verify_previously_red_first_acceptance_test.go')]: driver } }));
      const bin = path.join(scratch(), 'verify.test');
      const args = ['test', '-c', '-o', bin, '-overlay', overlay, './verify'];
      const r = await run('go', args, { cwd: root, env: { ...process.env, GOFLAGS: '' }, timeout: 85 * 1000 });
      assert.equal(r.code, 0, `go ${args.join(' ')} (in ${root}, with ${TEST} added from ${DRIVER}) failed: ${r.error ? r.error.message : ''}\n${r.stdout}${r.stderr}`);
      return bin;
    })();
  }
  return prebuilt;
};

AfterAll(function () {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

When(P + 'the {string} pass is recorded and reloaded', { timeout: 115 * 1000 }, async function (mode) {
  const bin = await testBinary();
  const result = path.join(scratch(), `result-${process.hrtime.bigint()}.json`);
  const args = ['-test.run', `^${TEST}$`, '-test.count=1', '-test.v', '-test.timeout=25s'];
  const shown = `FIX_PREVIOUS_RED_RELOAD_CASE=${mode} ${bin} ${args.join(' ')} (the verify test binary built with ${TEST} from ${DRIVER}, run in verify)`;
  const r = await run(bin, args, { cwd: path.join(process.cwd(), 'verify'), env: { ...process.env, FIX_PREVIOUS_RED_RELOAD_CASE: mode, FIX_PREVIOUS_RED_RELOAD_RESULT: result }, timeout: 28 * 1000 });
  assert.ok(r.code === 0 && fs.existsSync(result),
    `${shown}: ${TEST} wrote no report (absent, skipped, ran zero times or failed; exit ${r.code}): ${r.error ? r.error.message : ''}\n${r.stdout}${r.stderr}`);
  this.fixPreviousRedReload = JSON.parse(fs.readFileSync(result, 'utf8'));
  fs.rmSync(result, { force: true });
});

Then(P + 'the observations include:', function (text) {
  observe(this.fixPreviousRedReload, JSON.parse(text));
});
