'use strict';

// Steps of k-verify-fresh-clone-cucumber. Nothing runs when this file is loaded. The first step
// that needs them builds, once per run, the verify test binary (`go test -c ./verify`) and the
// setup program (`go build ./cmd/setup-tools`); later scenarios reuse them. A build that fails is
// recorded, not thrown: only Then steps fail, and they show the build output. The test binary
// runs in an empty folder, as a clone without Cucumber would see it; the consumer module and the
// stand-in npm are literals written here. Nothing is downloaded. Child processes run
// asynchronously, so Cucumber's own report keeps each step's times.
//
// Run directly (`node <this file> good|bad`), the file checks its observers instead: `good` must
// accept the known-good outcomes, `bad` must reject every known-bad one.

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = 'k-verify-fresh-clone-cucumber: ';

const tail = (text) => (text.length > 2500 ? '...' + text.slice(-2500) : text);

// parseGoTest reads `go test -v` output (a test binary's too): each test's result and the
// messages logged while it was the running test.
function parseGoTest(output) {
  const tests = new Map();
  let current = null;
  const entry = (name) => {
    if (!tests.has(name)) tests.set(name, { result: null, messages: [] });
    return tests.get(name);
  };
  for (const line of output.split('\n')) {
    let m;
    if ((m = /^=== RUN\s+(\S+)$/.exec(line))) {
      current = m[1];
      entry(current);
    } else if ((m = /^\s*--- (FAIL|PASS|SKIP): (\S+) \(/.exec(line))) {
      entry(m[2]).result = m[1];
    } else if (current && (m = /^\s+\S+\.go:\d+: (.*)$/.exec(line))) {
      entry(current).messages.push(m[1]);
    }
  }
  return tests;
}

const observe = {
  exactlyFailed(output, names) {
    const tests = parseGoTest(output);
    const failed = [...tests].filter(([name, t]) => t.result === 'FAIL' && !name.includes('/')).map(([name]) => name).sort();
    assert.deepEqual(failed, [...names].sort(), `the tests that failed; the run's output:\n${tail(output)}`);
  },
  passed(output, names) {
    const tests = parseGoTest(output);
    for (const name of names) {
      assert.equal(tests.get(name)?.result, 'PASS', `the result of ${name}; the run's output:\n${tail(output)}`);
    }
  },
  notFailed(output, names) {
    const tests = parseGoTest(output);
    for (const name of names) {
      const result = tests.get(name)?.result;
      assert.ok(result === 'PASS' || result === 'SKIP', `the result of ${name} is ${result}; the run's output:\n${tail(output)}`);
    }
  },
  everyFailureMessage(output, message) {
    const failed = [...parseGoTest(output)].filter(([, t]) => t.result === 'FAIL');
    assert.ok(failed.length > 0, `no test failed; the run's output:\n${tail(output)}`);
    for (const [name, t] of failed) {
      const leaf = !failed.some(([other]) => other.startsWith(name + '/'));
      if (leaf) assert.ok(t.messages.length > 0, `${name} failed without a message; the run's output:\n${tail(output)}`);
      for (const text of t.messages) assert.equal(text, message, `a failure message of ${name}`);
    }
  },
  notShown(output, text) {
    assert.ok(!output.includes(text), `the output shows ${JSON.stringify(text)}:\n${tail(output)}`);
  },
  consumerFailed(output, message) {
    const t = parseGoTest(output).get('TestConsumerCucumber');
    assert.ok(t && t.result === 'FAIL', `TestConsumerCucumber did not fail; the run's output:\n${tail(output)}`);
    assert.deepEqual(t.messages, [message], 'the failure message of TestConsumerCucumber');
  },
  consumerFound(output, folder) {
    const t = parseGoTest(output).get('TestConsumerCucumber');
    assert.ok(t && t.result === 'PASS', `TestConsumerCucumber did not pass; the run's output:\n${tail(output)}`);
    assert.equal(t.messages.length, 1, `the messages of TestConsumerCucumber: ${JSON.stringify(t.messages)}`);
    const found = /^cucumber=(.*)$/.exec(t.messages[0]);
    assert.ok(found, `TestConsumerCucumber logged ${JSON.stringify(t.messages[0])}, not cucumber=<folder>`);
    assert.equal(fs.realpathSync(found[1]), fs.realpathSync(folder), 'the Cucumber folder TestConsumerCucumber found');
  },
  npmCalls(log, lines) {
    assert.deepEqual(log.split('\n').filter(Boolean), lines, 'the calls the stand-in npm recorded');
  },
  exit(result, zero) {
    if (zero) assert.equal(result.code, 0, `the exit status; the output:\n${tail(result.output)}`);
    else assert.ok(typeof result.code === 'number' && result.code !== 0, `the exit status ${result.code} is not a nonzero exit; the output:\n${tail(result.output)}`);
  },
};

// ---- observer controls ----

const MSG = 'missing prerequisite: Cucumber is not installed; run the setup command: go run github.com/KogenAI/kogen-verification/cmd/setup-tools';
const GOOD_RUN = [
  '=== RUN   TestA',
  `    helper_test.go:9: ${MSG}`,
  '--- FAIL: TestA (0.00s)',
  '=== RUN   TestB',
  '=== RUN   TestB/one',
  `    x_test.go:5: ${MSG}`,
  '=== RUN   TestB/two',
  `    x_test.go:6: ${MSG}`,
  '--- FAIL: TestB (0.00s)',
  '    --- FAIL: TestB/one (0.00s)',
  '    --- FAIL: TestB/two (0.00s)',
  '=== RUN   TestSkipIt',
  '    a_test.go:8: because',
  '--- SKIP: TestSkipIt (0.00s)',
  '=== RUN   TestC',
  '    c_test.go:9: hello',
  '--- PASS: TestC (0.00s)',
  'FAIL',
  '',
].join('\n');
const sub = (from, to) => GOOD_RUN.split(from).join(to);
const CALLS = ['ci --prefix testdata/tools/cucumber manifest=yes lock=yes', 'ci --prefix testdata/tools/quint manifest=yes lock=yes'];

const goodControls = [
  () => observe.exactlyFailed(GOOD_RUN, ['TestA', 'TestB']),
  () => observe.everyFailureMessage(GOOD_RUN, MSG),
  () => observe.passed(GOOD_RUN, ['TestC']),
  () => observe.notFailed(GOOD_RUN, ['TestC', 'TestSkipIt']),
  () => observe.notShown('--- PASS: TestC (0.00s)\n', MSG),
  () => observe.consumerFailed('=== RUN   TestConsumerCucumber\n    p_test.go:10: ' + MSG + '\n--- FAIL: TestConsumerCucumber (0.00s)\n', MSG),
  () => observe.consumerFound('=== RUN   TestConsumerCucumber\n    p_test.go:10: cucumber=' + os.tmpdir() + '\n--- PASS: TestConsumerCucumber (0.00s)\n', os.tmpdir()),
  () => observe.npmCalls(CALLS.join('\n') + '\n', CALLS),
  () => observe.exit({ code: 0, output: '' }, true),
  () => observe.exit({ code: 1, output: '' }, false),
];

const badControls = [
  ['a skipped test is not a failed one', () => observe.exactlyFailed(sub('--- FAIL: TestA (0.00s)', '--- SKIP: TestA (0.00s)'), ['TestA', 'TestB'])],
  ['an extra failed test', () => observe.exactlyFailed(sub('--- PASS: TestC (0.00s)', '--- FAIL: TestC (0.00s)'), ['TestA', 'TestB'])],
  ['no run at all', () => observe.exactlyFailed('no required module provides package\n', ['TestA', 'TestB'])],
  ['a different message', () => observe.everyFailureMessage(sub('helper_test.go:9: ' + MSG, 'helper_test.go:9: run npm ci in testdata/tools/cucumber'), MSG)],
  ['a failure without a message', () => observe.everyFailureMessage(sub('    helper_test.go:9: ' + MSG + '\n', ''), MSG)],
  ['a test that did not pass', () => observe.passed(sub('--- PASS: TestC (0.00s)', '--- FAIL: TestC (0.00s)'), ['TestC'])],
  ['a test that did not run', () => observe.passed(GOOD_RUN, ['TestNever'])],
  ['a failed test among those that must not fail', () => observe.notFailed(GOOD_RUN, ['TestA'])],
  ['the message in the output', () => observe.notShown(GOOD_RUN, MSG)],
  ['a consumer test that passed', () => observe.consumerFailed('=== RUN   TestConsumerCucumber\n--- PASS: TestConsumerCucumber (0.00s)\n', MSG)],
  ['a consumer that found another folder', () => observe.consumerFound('=== RUN   TestConsumerCucumber\n    p_test.go:10: cucumber=/\n--- PASS: TestConsumerCucumber (0.00s)\n', os.tmpdir())],
  ['a consumer test that failed', () => observe.consumerFound('=== RUN   TestConsumerCucumber\n    p_test.go:10: ' + MSG + '\n--- FAIL: TestConsumerCucumber (0.00s)\n', os.tmpdir())],
  ['a missing lock file', () => observe.npmCalls(CALLS[0].replace('lock=yes', 'lock=no') + '\n' + CALLS[1] + '\n', CALLS)],
  ['a missing second call', () => observe.npmCalls(CALLS[0] + '\n', CALLS)],
  ['a zero exit that must not be', () => observe.exit({ code: 0, output: '' }, false)],
  ['a nonzero exit that must be zero', () => observe.exit({ code: 7, output: '' }, true)],
];

function controls(bad) {
  if (!bad) {
    for (const check of goodControls) check();
    return;
  }
  for (const [name, check] of badControls) {
    let rejected = false;
    try {
      check();
    } catch (error) {
      rejected = true;
    }
    if (!rejected) throw new Error(`known-bad outcome accepted: ${name}`);
  }
  throw new Error('known-bad outcomes rejected');
}

if (require.main === module) {
  try {
    controls(process.argv[2] === 'bad');
    console.log('accepted');
  } catch (error) {
    if (error.message === 'known-bad outcomes rejected') console.log('rejected');
    else console.error(error);
    process.exitCode = 1;
  }
} else {
  const { AfterAll, Given, When, Then } = require('@cucumber/cucumber');

  let tmp;
  const scratch = () => {
    if (!tmp) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'k-verify-fresh-clone-cucumber-'));
    return tmp;
  };
  const fresh = (name) => fs.mkdtempSync(path.join(scratch(), name + '-'));

  // run starts file without blocking the event loop and resolves with its exit code (null when
  // it did not exit normally or did not start) and its combined output.
  const run = (file, args, options) => new Promise((resolve) => {
    let output = '';
    let child;
    try {
      child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    } catch (error) {
      resolve({ code: null, output: String(error) });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeout || 100000);
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, output: output + String(error) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output }); });
  });

  // cleanEnv is the caller's environment as a clone without Cucumber would have it.
  const cleanEnv = (extra) => {
    const env = { ...process.env, GOFLAGS: '', GOWORK: 'off', ...extra };
    delete env.KOGEN_CUCUMBER;
    delete env.NODE_PATH;
    return env;
  };

  // build runs `go` with the arguments made for the output path the first time it is asked and
  // returns the same promise afterwards; a failed build is data, not an exception.
  const builds = new Map();
  const build = (name, args) => {
    if (!builds.has(name)) {
      builds.set(name, (async () => {
        const out = path.join(scratch(), name);
        const result = await run('go', args(out), { cwd: process.cwd(), env: cleanEnv({}), timeout: 100000 });
        return { out, ok: result.code === 0 && fs.existsSync(out), output: result.output };
      })());
    }
    return builds.get(name);
  };
  const testBinary = () => build('verify.test', (out) => ['test', '-c', '-o', out, './verify']);
  const setupBinary = (pkg) => build('setup-tools', (out) => ['build', '-o', out, pkg]);

  AfterAll(function () {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  // ---- the compiled verification tests in an empty folder ----

  Given(P + 'an empty folder {string} to run the compiled verification tests in', function (name) {
    this.folder = path.join(fresh('run'), name);
    fs.mkdirSync(this.folder);
    this.env = cleanEnv({});
  });

  Given(P + 'KOGEN_CUCUMBER is not set', function () {
    delete this.env.KOGEN_CUCUMBER;
  });

  Given(P + 'KOGEN_CUCUMBER names an existing folder that holds no Cucumber', function () {
    this.env.KOGEN_CUCUMBER = fresh('no-cucumber');
  });

  Given(P + 'KOGEN_CUCUMBER names a folder holding a stand-in Cucumber', function () {
    const modules = fresh('stand-in');
    fs.mkdirSync(path.join(modules, '@cucumber', 'cucumber', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(modules, '@cucumber', 'cucumber', 'bin', 'cucumber.js'), 'process.exit(0);\n');
    this.env.KOGEN_CUCUMBER = modules;
  });

  When(P + 'the compiled verification tests named below run in that folder', async function (table) {
    const names = table.raw().map((row) => row[0]);
    const bin = await testBinary();
    if (!bin.ok) {
      this.output = `go test -c ./verify failed:\n${bin.output}`;
      return;
    }
    const result = await run(bin.out, ['-test.v', '-test.count=1', '-test.run', '^(' + names.join('|') + ')$'], { cwd: this.folder, env: this.env });
    this.output = result.output;
  });

  Then(P + 'exactly these tests failed', function (table) {
    observe.exactlyFailed(this.output, table.raw().map((row) => row[0]));
  });

  Then(P + 'every failure message is exactly {string}', function (message) {
    observe.everyFailureMessage(this.output, message);
  });

  Then(P + 'these tests passed', function (table) {
    observe.passed(this.output, table.raw().map((row) => row[0]));
  });

  Then(P + 'these tests did not fail', function (table) {
    observe.notFailed(this.output, table.raw().map((row) => row[0]));
  });

  Then(P + 'the output does not show {string}', function (text) {
    observe.notShown(this.output, text);
  });

  // ---- a consumer module ----

  Given(P + 'a consumer module that requires this repository and whose test asks prereq.Cucumber for the install', function () {
    this.consumer = fresh('consumer');
    fs.mkdirSync(path.join(this.consumer, 'p'));
    fs.writeFileSync(path.join(this.consumer, 'go.mod'), [
      'module consumer',
      '',
      'go 1.27.2',
      '',
      'require github.com/KogenAI/kogen-verification v0.0.0',
      '',
      `replace github.com/KogenAI/kogen-verification => ${process.cwd()}`,
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(this.consumer, 'p', 'p_test.go'), [
      'package p',
      '',
      'import (',
      '\t"testing"',
      '',
      '\t"github.com/KogenAI/kogen-verification/prereq"',
      ')',
      '',
      'func TestConsumerCucumber(t *testing.T) {',
      '\tt.Logf("cucumber=%s", prereq.Cucumber(t))',
      '}',
      '',
    ].join('\n'));
  });

  Given(P + 'the consumer has a stand-in Cucumber in its own install folder', function () {
    this.installed = path.join(this.consumer, 'testdata', 'tools', 'cucumber', 'node_modules');
    fs.mkdirSync(path.join(this.installed, '@cucumber', 'cucumber', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(this.installed, '@cucumber', 'cucumber', 'bin', 'cucumber.js'), 'process.exit(0);\n');
  });

  When(P + 'the consumer tests run offline', async function () {
    const env = cleanEnv({ GOFLAGS: '-mod=mod', GOPROXY: 'off', GOSUMDB: 'off', GOTOOLCHAIN: 'local' });
    const result = await run('go', ['test', '-v', '-count=1', './...'], { cwd: this.consumer, env });
    this.output = result.output;
  });

  Then(P + 'the consumer test failed with the message {string}', function (message) {
    observe.consumerFailed(this.output, message);
  });

  Then(P + 'the consumer test passed and found the consumer\'s own install folder', function () {
    observe.consumerFound(this.output, this.installed);
  });

  // ---- the setup program ----

  Given(P + 'a stand-in npm that records each call and the files it finds under the prefix', function () {
    const bin = fresh('npm-bin');
    this.npmLog = path.join(fresh('npm-log'), 'calls.log');
    fs.writeFileSync(path.join(bin, 'npm'), [
      '#!/bin/sh',
      'prefix=',
      'last=',
      'for a in "$@"; do',
      '  if [ "$last" = "--prefix" ]; then prefix=$a; fi',
      '  last=$a',
      'done',
      'm=no',
      'l=no',
      '[ -f "$prefix/package.json" ] && m=yes',
      '[ -f "$prefix/package-lock.json" ] && l=yes',
      'echo "$* manifest=$m lock=$l" >> "$NPM_LOG"',
      'exit "${NPM_EXIT:-0}"',
      '',
    ].join('\n'), { mode: 0o755 });
    this.setupEnv = cleanEnv({ PATH: bin + path.delimiter + process.env.PATH, NPM_LOG: this.npmLog });
  });

  Given(P + 'the stand-in npm exits with status {int}', function (status) {
    this.setupEnv.NPM_EXIT = String(status);
  });

  Given(P + 'an empty folder to run the setup program in', function () {
    this.setupFolder = fresh('setup');
  });

  When(P + 'the setup program built from {string} runs there', async function (pkg) {
    const bin = await setupBinary(pkg);
    if (!bin.ok) {
      this.setup = { code: null, output: `go build ${pkg} failed:\n${bin.output}` };
      return;
    }
    this.setup = await run(bin.out, [], { cwd: this.setupFolder, env: this.setupEnv });
  });

  Then(P + 'the setup program exits with status zero', function () {
    observe.exit(this.setup, true);
  });

  Then(P + 'the setup program exits with a nonzero status', function () {
    observe.exit(this.setup, false);
  });

  Then(P + 'the stand-in npm was called exactly', function (table) {
    const log = fs.existsSync(this.npmLog) ? fs.readFileSync(this.npmLog, 'utf8') : '';
    try {
      observe.npmCalls(log, table.raw().map((row) => row[0]));
    } catch (error) {
      error.message += `\nthe setup program's output:\n${tail(this.setup.output)}`;
      throw error;
    }
  });

  Then(P + 'that folder holds the pinned package.json and package-lock.json of cucumber and quint', function () {
    for (const tool of ['cucumber', 'quint']) {
      for (const file of ['package.json', 'package-lock.json']) {
        const rel = path.join('testdata', 'tools', tool, file);
        const written = path.join(this.setupFolder, rel);
        assert.ok(fs.existsSync(written), `${rel} was not written; the setup program's output:\n${tail(this.setup.output)}`);
        assert.ok(fs.readFileSync(written).equals(fs.readFileSync(path.join(process.cwd(), rel))), `${rel} differs from the repository's pinned file`);
      }
    }
  });

  Then(P + 'the setup output names {string}', function (text) {
    assert.ok(this.setup.output.includes(text), `the setup output does not name ${JSON.stringify(text)}:\n${tail(this.setup.output)}`);
  });

  // ---- the README ----

  const readme = () => fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');

  Then(P + 'the README has a Prerequisites section that names Go, Node.js and npm and holds the setup command {string}', function (command) {
    const text = readme();
    const heading = /^#{2,3} Prerequisites[ \t]*$/m.exec(text);
    assert.ok(heading, 'README.md has no Prerequisites heading');
    const rest = text.slice(heading.index + heading[0].length);
    const next = /^#{1,3} /m.exec(rest);
    const section = next ? rest.slice(0, next.index) : rest;
    for (const word of ['Go', 'Node.js', 'npm']) {
      assert.ok(new RegExp('\\b' + word.replace('.', '\\.') + '\\b').test(section), `the Prerequisites section does not name ${word}:\n${section}`);
    }
    assert.ok(section.split('\n').some((line) => line.trim() === command), `the Prerequisites section has no line that is exactly ${JSON.stringify(command)}:\n${section}`);
  });

  Then(P + 'the setup command {string} appears once in the README', function (command) {
    assert.equal(readme().split(command).length - 1, 1, `the number of times README.md holds ${JSON.stringify(command)}`);
  });
}
