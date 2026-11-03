// Steps of the golden update scenarios: a copy of this repository whose goldens are edited,
// regenerated with the Go test flag -update (`go test ./... -update`) and checked again
// without the flag. The documentation steps read this repository itself.
const { Before, After, Given, When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = process.cwd();
const GOLDEN_DIR = 'verify/testdata/golden';
const GOLDENS = ['accounts.json', 'feasibility.json', 'passes.json', 'readiness.json', 'text.json'];
// The tests that compare against the goldens; `-run Elixir` selects exactly these.
const GOLDEN_TESTS = [
  'TestAccountEqualsTheElixirAccountingOnEveryReference',
  'TestDeclarationsEqualTheElixirReadingOnEveryReference',
  'TestValidEqualsTheElixirVerdictOnEveryReference',
  'TestObservationsAndAcknowledgmentEqualTheElixirTexts',
  'TestPassFeedbackEqualsTheElixirFeedback',
  'TestPassCompleteEqualsTheElixirVerdictOnEveryReference',
  'TestReadinessRecordEqualsTheElixirRecordAndReadsBack',
  'TestBoundedTextsEqualTheElixirReference',
];
const SKIPPED = new Set(['.git', 'node_modules']);
const GO_TIMEOUT = 600 * 1000;

Before(function () {
  this.goldenDirs = [];
});

After(function () {
  for (const dir of this.goldenDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function golden(root, name) {
  return fs.readFileSync(path.join(root, GOLDEN_DIR, name));
}

function tail(text) {
  return text.length > 6000 ? `...${text.slice(-6000)}` : text;
}

// sameBytes fails with the first differing offset of a golden and the bytes around it.
function sameBytes(name, got, want) {
  if (got.equals(want)) return;
  let i = 0;
  while (i < got.length && i < want.length && got[i] === want[i]) i++;
  const around = (b) => JSON.stringify(b.subarray(Math.max(0, i - 80), i + 80).toString('utf8'));
  assert.fail(`${GOLDEN_DIR}/${name}: ${got.length} bytes, want ${want.length}; first difference at byte ${i}\n got: ${around(got)}\nwant: ${around(want)}`);
}

function goTest(world, args) {
  const r = spawnSync('go', ['test', '-count=1', '-v', ...args], {
    cwd: world.copy, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024,
  });
  world.run = {
    command: `go test -count=1 -v ${args.join(' ')} (in a copy of the repository)`,
    status: r.status,
    output: `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error}` : ''}`,
  };
}

// topLevel returns the names of the top-level tests whose result line has the given verdict.
function topLevel(output, verdict) {
  return [...output.matchAll(new RegExp(`^--- ${verdict}: (\\S+) \\(`, 'gm'))].map((m) => m[1]);
}

Given('a copy of this repository', function () {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'golden-update-')));
  this.goldenDirs.push(dir);
  const local = path.join('.kogen', 'local');
  fs.cpSync(REPO, dir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(REPO, src);
      return !rel.split(path.sep).some((part) => SKIPPED.has(part)) && rel !== local && !rel.startsWith(local + path.sep);
    },
  });
  this.copy = dir;
  this.repository = {};
  for (const name of GOLDENS) this.repository[name] = golden(dir, name);
});

Given('in the copy, the golden {string} has these replacements:', function (name, table) {
  let text = golden(this.copy, name).toString('utf8');
  for (const { from, to, places } of table.hashes()) {
    const n = text.split(from).length - 1;
    assert.equal(n, Number(places), `${GOLDEN_DIR}/${name}: ${JSON.stringify(from)} occurs ${n} times, the scenario expects ${places}`);
    text = text.split(from).join(to);
  }
  this.edited = { name, bytes: Buffer.from(text, 'utf8') };
  fs.writeFileSync(path.join(this.copy, GOLDEN_DIR, name), this.edited.bytes);
});

When('the golden tests run in the copy without the update flag', { timeout: GO_TIMEOUT }, function () {
  goTest(this, ['-run', 'Elixir', './...']);
});

When('the golden tests run in the copy with the update flag', { timeout: GO_TIMEOUT }, function () {
  goTest(this, ['-run', 'Elixir', './...', '-update']);
});

When('the whole test suite runs in the copy with the update flag', { timeout: 2 * GO_TIMEOUT }, function () {
  goTest(this, ['./...', '-update']);
});

Then('the run fails, and exactly these tests fail:', function (table) {
  const want = table.raw().map((row) => row[0]).sort();
  const failed = topLevel(this.run.output, 'FAIL').sort();
  assert.notEqual(this.run.status, 0, `${this.run.command} exited 0, want a failure of ${want.join(', ')}\n${tail(this.run.output)}`);
  assert.deepEqual(failed, want, `${this.run.command} exited ${this.run.status}; failed tests ${JSON.stringify(failed)}, want ${JSON.stringify(want)}\n${tail(this.run.output)}`);
});

Then('the run passes, with every golden test passing', function () {
  assert.equal(this.run.status, 0, `${this.run.command} exited ${this.run.status}, want 0; failed tests ${JSON.stringify(topLevel(this.run.output, 'FAIL'))}\n${tail(this.run.output)}`);
  const passed = new Set(topLevel(this.run.output, 'PASS'));
  const skipped = new Set(topLevel(this.run.output, 'SKIP'));
  for (const test of GOLDEN_TESTS) {
    const outcome = skipped.has(test) ? 'was skipped' : 'did not run';
    assert.ok(passed.has(test), `${test}: ${outcome} in ${this.run.command} (exit ${this.run.status}); it must pass\n${tail(this.run.output)}`);
  }
});

Then('the copy\'s golden {string} is unchanged since the replacements', function (name) {
  assert.equal(this.edited.name, name, `the scenario edited ${this.edited.name}, not ${name}`);
  sameBytes(name, golden(this.copy, name), this.edited.bytes);
});

Then('every golden in the copy is byte-for-byte the repository\'s', function () {
  for (const name of GOLDENS) sameBytes(name, golden(this.copy, name), this.repository[name]);
});

Then('the copy\'s goldens are the repository\'s, except that in {string} every {string} is {string}', function (name, from, to) {
  for (const other of GOLDENS) {
    const want = other === name
      ? Buffer.from(this.repository[name].toString('utf8').split(from).join(to), 'utf8')
      : this.repository[other];
    sameBytes(other, golden(this.copy, other), want);
  }
});

Then('a program that imports the verify package, without its tests, has no {string} flag', { timeout: GO_TIMEOUT }, function (flag) {
  const dir = path.join(this.copy, 'goldenflagprobe');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'main.go'), `package main

import (
	"flag"
	"fmt"

	_ "github.com/KogenAI/kogen-verification/verify"
)

func main() {
	if flag.Lookup(${JSON.stringify(flag)}) == nil {
		fmt.Println("absent")
	} else {
		fmt.Println("defined")
	}
}
`);
  const binDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'golden-flag-bin-')));
  this.goldenDirs.push(binDir);
  const bin = path.join(binDir, 'goldenflagprobe');
  const built = spawnSync('go', ['build', '-o', bin, './goldenflagprobe'], { cwd: this.copy, encoding: 'utf8' });
  assert.equal(built.status, 0, `go build ./goldenflagprobe (imports github.com/KogenAI/kogen-verification/verify) exited ${built.status}\n${built.stdout || ''}${built.stderr || ''}`);
  const r = spawnSync(bin, [], { encoding: 'utf8' });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  assert.equal(r.status, 0, `goldenflagprobe (built from a program importing github.com/KogenAI/kogen-verification/verify) exited ${r.status}\n${output}`);
  assert.equal(output, 'absent\n', `the non-test verify package defines the flag -${flag}`);
});

Then('the README documents {string} for the goldens in {string}', function (command, dir) {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert.ok(readme.includes(command), `README.md does not show the command ${command}`);
  assert.ok(readme.includes(dir), `README.md does not name ${dir}`);
});

Then('every golden in {string} is named in a comment of a Go test file in {string}', function (goldenDir, testDir) {
  const names = fs.readdirSync(path.join(REPO, goldenDir)).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(names, [...GOLDENS], `${goldenDir} holds ${JSON.stringify(names)}`);
  const comments = fs.readdirSync(path.join(REPO, testDir))
    .filter((f) => f.endsWith('_test.go'))
    .flatMap((f) => fs.readFileSync(path.join(REPO, testDir, f), 'utf8').split('\n'))
    .filter((line) => /^\s*\/\//.test(line));
  for (const name of names) {
    assert.ok(comments.some((line) => line.includes(name)), `no comment in ${testDir}/*_test.go names ${name}`);
  }
});

Then('the directory {string} holds no files', function (dir) {
  const full = path.join(REPO, dir);
  const files = fs.existsSync(full) ? fs.readdirSync(full, { recursive: true }) : [];
  assert.deepEqual(files, [], `${dir} still holds ${JSON.stringify(files)}`);
});
