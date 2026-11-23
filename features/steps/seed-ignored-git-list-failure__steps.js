'use strict';
const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const PREFIX = 'seed-ignored-git-list-failure: ';
const ROOT = process.cwd();
const SEED_GO = path.join(ROOT, 'verify', 'seed.go');
// Test functions that verify/seed_test.go declares before this change.
const EXISTING = [
  'TestReadinessReusesTheCheckoutsIgnoredBuildOutputs',
  'TestReadinessCompilesFromScratchWithoutAnyCheckoutCache',
  'TestSeedIgnoredKeepsTrackedContentAndSkipsKogenLocal',
  'TestSeedIgnoredNeverWritesThroughToTheSourceCheckout',
  'TestSeedIgnoredLeavesTrackedCandidateContentAlone',
  'TestSeedIgnoredLetsMakeReuseAndRebuildOutputs',
];

// Each mutation is a wrong SeedIgnored behavior, as a text edit of verify/seed.go.
const MUTATIONS = {
  'swallows the failed listing': (s) =>
    s.replace('rels, err := ignoredPaths(src)\n\tif err != nil {\n\t\treturn err\n\t}', 'rels, err := ignoredPaths(src)\n\tif err != nil {\n\t\treturn nil\n\t}'),
  'returns an unrelated error': (s) =>
    s.replace('rels, err := ignoredPaths(src)\n\tif err != nil {\n\t\treturn err\n\t}', 'rels, err := ignoredPaths(src)\n\tif err != nil {\n\t\treturn fmt.Errorf("unrelated failure")\n\t}'),
  'omits the source from the error': (s) =>
    s.replace('"listing ignored paths of %s: %v: %s", dir, err,', '"listing ignored paths: %v: %s", err,'),
  'copies the source despite the failed listing': (s) =>
    s.replace(
      'rels, err := ignoredPaths(src)\n\tif err != nil {\n\t\treturn err\n\t}',
      'rels, err := ignoredPaths(src)\n\tif err != nil {\n\t\t_ = exec.Command("cp", "-a", src+"/.", dst).Run()\n\t\treturn err\n\t}'
    ),
};

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 1 << 24, timeout: 100000, ...opts }, (error, stdout, stderr) => {
      resolve({ error, out: String(stdout) + String(stderr) });
    });
  });
}

let result = null;

async function runNewTests(mutation) {
  const file = path.join(ROOT, 'verify', 'seed_test.go');
  const src = fs.readFileSync(file, 'utf8');
  const names = [...src.matchAll(/^func (Test\w+)\(/gm)].map((m) => m[1]).filter((n) => !EXISTING.includes(n));
  result = { names, out: '', failed: false, problem: '' };
  if (names.length === 0) {
    result.problem = 'verify/seed_test.go declares no Test function beyond the existing ones';
    return;
  }
  const args = ['test', '-count=1', '-v'];
  if (mutation) {
    assert.ok(Object.prototype.hasOwnProperty.call(MUTATIONS, mutation), 'unknown mutation ' + mutation);
    const original = fs.readFileSync(SEED_GO, 'utf8');
    const mutated = MUTATIONS[mutation](original);
    assert.notStrictEqual(mutated, original, 'mutation "' + mutation + '" did not change verify/seed.go');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-mutant-'));
    const mutFile = path.join(dir, 'seed.go');
    fs.writeFileSync(mutFile, mutated);
    const overlay = path.join(dir, 'overlay.json');
    fs.writeFileSync(overlay, JSON.stringify({ Replace: { [SEED_GO]: mutFile } }));
    args.push('-overlay', overlay);
  }
  args.push('-run', '^(' + names.join('|') + ')$', './verify');
  const r = await run('go', args, { cwd: ROOT, env: { ...process.env, PWD: ROOT } });
  result.out = r.out;
  result.failed = !!r.error;
  result.cmd = 'go ' + args.join(' ');
}

When(PREFIX + 'the tests newly declared in verify\\/seed_test.go are run against the unchanged SeedIgnored', async function () {
  await runNewTests(null);
});

When(PREFIX + 'the tests newly declared in verify\\/seed_test.go are run against a SeedIgnored that {string}', async function (mutation) {
  await runNewTests(mutation);
});

Then(PREFIX + 'every new test passes', function () {
  assert.strictEqual(result.problem, '', result.problem);
  assert.ok(!result.failed, `${result.cmd} failed: ${result.out.slice(-2000)}`);
  for (const n of result.names) {
    assert.ok(result.out.includes('--- PASS: ' + n + ' '), `${result.cmd} did not report PASS for ${n}: ${result.out.slice(-2000)}`);
  }
});

Then(PREFIX + 'at least one new test fails', function () {
  assert.strictEqual(result.problem, '', result.problem);
  assert.ok(!result.out.includes('[build failed]') && !result.out.includes('[setup failed]'), `${result.cmd} did not build: ${result.out.slice(-2000)}`);
  assert.ok(result.failed, `${result.cmd} passed for new tests ${result.names.join(', ')} although SeedIgnored is wrong: ${result.out.slice(-2000)}`);
  assert.ok(/--- FAIL: Test\w+/.test(result.out), `${result.cmd} failed without a failing test: ${result.out.slice(-2000)}`);
});
