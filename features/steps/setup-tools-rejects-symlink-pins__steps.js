const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const P = 'setup-tools-rejects-symlink-pins: ';
const root = path.resolve(__dirname, '../..');
let built;

function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'setup-tools-symlink-pins-'));
}

function remove(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function run(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err && (typeof err.code !== 'number' || err.killed || err.signal)) {
        reject(err);
      } else {
        resolve({ code: err ? err.code : 0, stdout, stderr });
      }
    });
  });
}

function build() {
  if (!built) {
    built = (async () => {
      const dir = temp();
      process.once('exit', () => remove(dir));
      const bin = path.join(dir, 'setup-tools');
      const result = await run('go', ['build', '-o', bin, './cmd/setup-tools'], { cwd: root, timeout: 100000 });
      assert.equal(result.code, 0, `could not build setup-tools: ${result.stdout}${result.stderr}`);
      return bin;
    })();
  }
  return built;
}

function put(file, content, options) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, options);
}

function workIn(dir) {
  const bin = path.join(dir, 'bin');
  const cwd = path.join(dir, 'work');
  fs.mkdirSync(cwd);
  put(path.join(bin, 'npm'), '#!/bin/sh\n{ printf "%s\\t" "$@"; printf "\\n"; } >> npm-calls\n', { mode: 0o755 });
  return { cwd, env: { ...process.env, PATH: bin }, timeout: 10000 };
}

function linkToRegularFile(cwd, target) {
  const referent = path.join(cwd, 'regular-referent');
  fs.writeFileSync(referent, '{}\n');
  const link = path.join(cwd, target);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(referent, link);
  assert.ok(fs.lstatSync(link).isSymbolicLink() && fs.statSync(link).isFile(), `invalid link fixture at ${target}`);
}

function expectRefusal(result, code) {
  assert.equal(result.code, code, `expected setup refusal, got exit ${result.code}; stderr: ${result.stderr}`);
}

function expectNamedPath(result, target) {
  assert.ok(result.stderr.includes(target), `stderr does not name ${target}`);
}

function npmLog(cwd) {
  try {
    return fs.readFileSync(path.join(cwd, 'npm-calls'), 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return null;
  }
}

function expectNoNpm(cwd) {
  assert.ok(npmLog(cwd) === null, 'npm was invoked before refusal');
}

function expectRegularBytes(cwd, target, expected) {
  const file = path.join(cwd, target);
  assert.ok(fs.lstatSync(file, { throwIfNoEntry: false })?.isFile(), `expected a regular file at ${target}`);
  assert.ok(fs.readFileSync(file).equals(expected), `unexpected bytes at ${target}`);
}

if (require.main === module) {
  // Qualify the two refusal observers whose steps are masked by the old CLI's exit 0.
  // Both controlled executables refuse with exit 1; the bad one hides the path and calls npm.
  async function checkObserver(kind) {
    assert.ok(kind === 'good' || kind === 'bad', 'expected good or bad observer fixture');
    const dir = temp();
    try {
      const options = workIn(dir);
      const target = 'testdata/tools/quint/package-lock.json';
      linkToRegularFile(options.cwd, target);
      const fixture = path.join(dir, 'fixture');
      const script = kind === 'good'
        ? `printf '%s\\n' 'setup-tools: ${target} exists but is not a regular file' >&2\n`
        : `npm ci --prefix testdata/tools/cucumber\nprintf '%s\\n' 'setup-tools: failure' >&2\n`;
      put(fixture, '#!/bin/sh\n' + script + 'exit 1\n', { mode: 0o755 });
      const result = await run(fixture, [], options);
      expectRefusal(result, 1);
      const failures = [];
      for (const check of [() => expectNamedPath(result, target), () => expectNoNpm(options.cwd)]) {
        try {
          check();
        } catch (err) {
          if (err.code !== 'ERR_ASSERTION') throw err;
          failures.push(err.message);
        }
      }
      process.stdout.write(failures.length ? failures.join('\n') + '\n' : 'refusal observations accepted\n');
      if (failures.length) process.exitCode = 1;
    } finally {
      remove(dir);
    }
  }
  checkObserver(process.argv[2]).catch((err) => {
    console.error(err);
    process.exitCode = 2;
  });
} else {
  const { Given, When, Then, After } = require('@cucumber/cucumber');

  Given(P + 'an empty working directory with a recording npm', function () {
    this.pinTemp = temp();
    this.pinRun = workIn(this.pinTemp);
  });
  Given(P + '{string} is a symlink to a regular file', function (target) {
    linkToRegularFile(this.pinRun.cwd, target);
  });
  Given(P + 'the only existing pinned files are regular files containing {string}', function (content, table) {
    for (const [target] of table.rows()) put(path.join(this.pinRun.cwd, target), content);
  });
  When(P + 'the setup-tools command runs', async function () {
    this.pinResult = await run(await build(), [], this.pinRun);
  });
  Then(P + 'setup refuses with exit status {int}', function (code) {
    expectRefusal(this.pinResult, code);
  });
  Then(P + 'the error on stderr names {string}', function (target) {
    expectNamedPath(this.pinResult, target);
  });
  Then(P + 'npm was not invoked', function () {
    expectNoNpm(this.pinRun.cwd);
  });
  Then(P + 'setup succeeds', function () {
    const { code, stderr } = this.pinResult;
    assert.equal(code, 0, `setup failed: ${stderr}`);
  });
  Then(P + 'the existing pinned files are still regular files containing {string}', function (content, table) {
    for (const [target] of table.rows()) expectRegularBytes(this.pinRun.cwd, target, Buffer.from(content));
  });
  Then(P + 'the absent pinned files were copied from the embedded pins', function (table) {
    for (const [target] of table.rows()) {
      expectRegularBytes(this.pinRun.cwd, target, fs.readFileSync(path.join(root, target)));
    }
  });
  Then(P + 'npm received these invocations in order', function (table) {
    const log = npmLog(this.pinRun.cwd);
    const expected = table.rows().map((row) => row.join('\t') + '\t\n').join('');
    assert.equal(log, expected, 'unexpected npm invocations');
  });
  After({ tags: '@setup-tools-rejects-symlink-pins' }, function () {
    if (this.pinTemp) remove(this.pinTemp);
  });
}
