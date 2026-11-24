'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: process.env });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    const timer = setTimeout(() => child.kill('SIGKILL'), 100000);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`${command} ${args.join(' ')} exited ${code}: ${stderr}\n${stdout}`));
      else resolve(stdout);
    });
    child.stdin.end(input);
  });
}

let build;
function driver() {
  if (!build) build = (async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'step-result-driver-'));
    const binary = path.join(dir, 'driver');
    await run('go', ['build', '-o', binary, './features/steps/step-selfcheck-result-channel__driver']);
    return binary;
  })();
  return build;
}

function check(result, expected) {
  assert.equal(result.error, '', 'RunStepScript must not return an error');
  assert.equal(result.loaded, true, 'RunStepScript must return loaded true');
  // Compare all observed loads and steps, and all definition identities/usage. Bodies
  // are deliberately not constrained: this change does not alter definition policy.
  const observed = {
    loads: result.raw.loads,
    defs: result.raw.defs.map(d => ({ file: d.file, pattern: d.pattern, used: d.used })),
    steps: result.raw.steps
  };
  assert.deepEqual(observed, expected, 'RunStepScript must return the verifier result, not candidate stdout');
}

if (require.main === module) {
  (async () => {
    const mode = process.argv[2];
    assert.ok(mode === 'good' || mode === 'bad');
    const base = '.kogen/intents/step-selfcheck-result-channel/';
    const fixture = JSON.parse(await fs.readFile(base + 'observer-' + mode + '.json', 'utf8'));
    check(fixture.result, fixture.expected);
    process.stdout.write('observer accepted\n');
  })().catch(() => { process.stdout.write('observer rejected\n'); process.exitCode = 1; });
} else {
  const { Given, Then } = require('@cucumber/cucumber');
  Given('step-selfcheck-result-channel: a loaded step file with source', function (source) {
    this.resultChannelSource = source;
  });
  Then('step-selfcheck-result-channel: RunStepScript returns loaded true and the verifier result', { timeout: 115000 }, async function (expected) {
    const output = await run(await driver(), [], JSON.stringify({ source: this.resultChannelSource }));
    check(JSON.parse(output), JSON.parse(expected));
  });
}
