const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// The step under test, the feature that uses it and the test file the fixtures change.
const STEP = 'features/steps/k-verify-fixture-title-user-name__commands.js';
const FEATURE = '.kogen/intents/k-verify-fixture-title-user-name/acceptance.feature';
const TEST_FILE = 'verify/verify_test.go';

// Runs a child process asynchronously and returns its exit code, signal and combined output.
function run(cmd, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeout);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
  });
}

// Copies go.mod, go.sum, the verify package, the k-verify-fixture-title-user-name feature and the
// given step source into a fresh scratch folder, then applies each [from, to] replacement to
// verify/verify_test.go; each `from` must occur exactly once.
function scratchCopy(root, stepSource, replacements) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-k-verify-fixture-title-user-name-'));
  for (const entry of ['go.mod', 'go.sum', 'verify', FEATURE]) {
    fs.mkdirSync(path.dirname(path.join(dir, entry)), { recursive: true });
    fs.cpSync(path.join(root, entry), path.join(dir, entry), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, path.dirname(STEP)), { recursive: true });
  fs.writeFileSync(path.join(dir, STEP), stepSource);
  const file = path.join(dir, TEST_FILE);
  let text = fs.readFileSync(file, 'utf8');
  for (const [from, to] of replacements) {
    const count = text.split(from).length - 1;
    if (count !== 1) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error(`fixture: ${JSON.stringify(from)} occurs ${count} times in ${TEST_FILE}, want exactly 1`);
    }
    text = text.replace(from, () => to);
  }
  fs.writeFileSync(file, text);
  return dir;
}

// Runs the k-verify-fixture-title-user-name acceptance with only its own step file in the copy,
// then removes the copy.
async function runAcceptance(root, dir) {
  const cucumber = process.env.KOGEN_CUCUMBER || path.join(root, 'testdata/tools/cucumber/node_modules');
  const node = process.env.KOGEN_NODE || process.execPath;
  const args = [path.join(cucumber, '@cucumber/cucumber/bin/cucumber.js'), '--strict', '--require', STEP, FEATURE];
  try {
    return await run(node, args, { cwd: dir, env: { ...process.env, NODE_PATH: cucumber }, timeout: 100000 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function describe(result) {
  return `cucumber exited ${result.code}${result.signal ? ` (signal ${result.signal})` : ''}:\n${result.output}`;
}

function expectExit(result, passed, summary) {
  assert.ok(passed ? result.code === 0 : (result.code !== 0 && result.code !== null), `want ${passed ? 'exit 0' : 'a nonzero exit'}; ${describe(result)}`);
  assert.ok(result.output.includes(summary), `want ${JSON.stringify(summary)}; ${describe(result)}`);
}

function expectOutput(result, text) {
  assert.ok(result.output.includes(text), `want output containing ${JSON.stringify(text)}; ${describe(result)}`);
}

if (require.main === module) {
  // Observer controls: a correct step must satisfy every case below; a step that counts
  // `=== RUN` lines instead of passing subtests must fail at least one.
  function goodStep() {
    const { Then } = require('@cucumber/cucumber');
    const { execFile } = require('node:child_process');
    const TEST = 'TestBaselineGuardRunsAfterEachFixerAndAfterThePass';
    const SUBTESTS = ['after_the_first_fixer', 'after_the_second_fixer', 'after_the_pass'];
    Then('k-verify-fixture-title-user-name: the baseline guard regression passes', { timeout: 120000 }, async function () {
      const args = ['test', './verify', '-count=1', '-run', '^' + TEST + '$', '-v'];
      const command = 'go ' + args.join(' ');
      const { code, output } = await new Promise((resolve) => {
        execFile('go', args, { encoding: 'utf8', timeout: 110000, maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
          resolve({ code: err ? err.code : 0, output: stdout + stderr });
        });
      });
      if (code !== 0) throw new Error(command + ' exited ' + code + ':\n' + output);
      const lines = output.split('\n').map((l) => l.trim());
      const missing = SUBTESTS.map((s) => TEST + '/' + s).filter((n) => !lines.some((l) => l.startsWith('--- PASS: ' + n + ' ')));
      if (missing.length) throw new Error(command + ' did not report a passing run of ' + missing.join(', ') + ' (absent, skipped or not run):\n' + output);
    });
  }
  function runCountingStep() {
    const { Then } = require('@cucumber/cucumber');
    const { execFile } = require('node:child_process');
    const TEST = 'TestBaselineGuardRunsAfterEachFixerAndAfterThePass';
    const SUBTESTS = ['after_the_first_fixer', 'after_the_second_fixer', 'after_the_pass'];
    Then('k-verify-fixture-title-user-name: the baseline guard regression passes', { timeout: 120000 }, async function () {
      const args = ['test', './verify', '-count=1', '-run', '^' + TEST + '$', '-v'];
      const command = 'go ' + args.join(' ');
      const { code, output } = await new Promise((resolve) => {
        execFile('go', args, { encoding: 'utf8', timeout: 110000, maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
          resolve({ code: err ? err.code : 0, output: stdout + stderr });
        });
      });
      if (code !== 0) throw new Error(command + ' exited ' + code + ':\n' + output);
      const lines = output.split('\n').map((l) => l.trim());
      const missing = SUBTESTS.map((s) => TEST + '/' + s).filter((n) => !lines.includes('=== RUN   ' + n));
      if (missing.length) throw new Error(command + ' did not run ' + missing.join(', ') + ':\n' + output);
    });
  }
  const cases = [
    { replacements: [], check: (r) => expectExit(r, true, '1 scenario (1 passed)') },
    {
      replacements: [['func TestBaselineGuardRunsAfterEachFixerAndAfterThePass(', 'func TestBaselineGuardRenamedAway(']],
      check: (r) => { expectExit(r, false, '1 scenario (1 failed)'); expectOutput(r, 'TestBaselineGuardRunsAfterEachFixerAndAfterThePass'); expectOutput(r, 'go test'); },
    },
    {
      replacements: [['{"after the pass", 3,', '{"at the end", 3,']],
      check: (r) => { expectExit(r, false, '1 scenario (1 failed)'); expectOutput(r, 'TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_pass'); },
    },
    {
      replacements: [['p.Config.Fix = tc.fix', 'p.Config.Fix = tc.fix; if tc.failAt == 2 { t.Skip("disabled by the fixture") }']],
      check: (r) => { expectExit(r, false, '1 scenario (1 failed)'); expectOutput(r, 'TestBaselineGuardRunsAfterEachFixerAndAfterThePass/after_the_second_fixer'); },
    },
  ];
  async function accepts(step) {
    const root = path.resolve(__dirname, '..', '..');
    const source = '(' + step.toString() + ')();\n';
    for (const c of cases) {
      const result = await runAcceptance(root, scratchCopy(root, source, c.replacements));
      try { c.check(result); } catch (_) { return false; }
    }
    return true;
  }
  const mode = process.argv[2] === '--control' ? process.argv[3] : '';
  if (mode === 'good') {
    accepts(goodStep).then((ok) => { console.log(ok ? 'accepted' : 'rejected'); if (!ok) process.exitCode = 1; });
  } else if (mode === 'bad') {
    accepts(runCountingStep).then((ok) => { console.log(ok ? 'accepted' : 'rejected'); if (!ok) process.exitCode = 1; });
  } else {
    console.log('usage: --control good|bad');
    process.exitCode = 2;
  }
} else {
  const { Given, When, Then } = require('@cucumber/cucumber');

  Given('fix-k-verify-fixture-title-user-name: a scratch copy of the module', function () {
    this.copy = scratchCopy(process.cwd(), fs.readFileSync(STEP, 'utf8'), []);
  });

  Given('fix-k-verify-fixture-title-user-name: a scratch copy of the module where {string} in verify\\/verify_test.go is replaced by {string}', function (from, to) {
    this.copy = scratchCopy(process.cwd(), fs.readFileSync(STEP, 'utf8'), [[from, to]]);
  });

  When('fix-k-verify-fixture-title-user-name: the k-verify-fixture-title-user-name acceptance runs in the copy', { timeout: 115000 }, async function () {
    this.result = await runAcceptance(process.cwd(), this.copy);
  });

  Then('fix-k-verify-fixture-title-user-name: the run exits 0 and reports {string}', function (summary) {
    expectExit(this.result, true, summary);
  });

  Then('fix-k-verify-fixture-title-user-name: the run exits nonzero and reports {string}', function (summary) {
    expectExit(this.result, false, summary);
  });

  Then('fix-k-verify-fixture-title-user-name: the run output contains {string}', function (text) {
    expectOutput(this.result, text);
  });
}
