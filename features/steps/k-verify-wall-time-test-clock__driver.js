'use strict';
// Driver and observer for k-verify-wall-time-test-clock. It builds the verify test binary for a
// product variant with a go build overlay (the checkout is never edited), runs
// TestWallTimeDeadlineAndNeverStarted in it and judges the runs. The acceptance steps use it as
// a module; `node <this file> good|old` runs the observer controls against the known-good and
// known-bad copies of verify/wall_time_test.go. Loading it does no work.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TEST = 'TestWallTimeDeadlineAndNeverStarted';
const ROOT = path.resolve(__dirname, '..', '..');
const PROGRESS = '\ts.Progress(fmt.Sprintf("kogen: verifying (pass %d)", in.N))\n';
const RUN_STEP = 'func runStepAs(ctx context.Context, s *sys.Session, tools Tools, name string, l Logger, command, dir string, extra map[string]string, markerVar string) (sys.Result, error) {\n';

// Each variant inserts code after one anchor line of one product file.
const VARIANTS = {
  // The work before the first setup command takes 250 ms of the old 300 ms budget.
  'slow-pre-setup': { file: 'verify/run.go', anchor: PROGRESS, insert: '\ttime.Sleep(250 * time.Millisecond)\n' },
  // Every step runs with a context that cannot be cancelled.
  'ignore-deadline': { file: 'verify/env.go', anchor: RUN_STEP, insert: '\tctx = context.WithoutCancel(ctx)\n' },
  // The first setup command never starts: the pass waits until its context ends.
  'never-start': { file: 'verify/run.go', anchor: PROGRESS, insert: '\t<-ctx.Done()\n\tif err := ctx.Err(); err != nil {\n\t\treturn Pass{}, err\n\t}\n' },
};

let tmp;
const builds = new Map();

const scratch = () => {
  if (!tmp) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'k-verify-wall-time-test-clock-'));
  return tmp;
};

const cleanup = () => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
  builds.clear();
};

// run starts file without blocking the event loop and resolves with its exit code (null when it
// did not exit normally), signal, error, output and elapsed seconds.
const run = (file, args, options) => new Promise((resolve) => {
  const began = Date.now();
  execFile(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
    const code = !error ? 0 : (typeof error.code === 'number' ? error.code : null);
    resolve({ code, signal: error ? error.signal : null, error, output: stdout + stderr, seconds: (Date.now() - began) / 1000 });
  });
});

// build compiles the verify test binary with variant applied and, when testFile is given, with
// verify/wall_time_test.go replaced by it. Each combination is built once; later calls reuse it.
const build = (variant, testFile) => {
  const key = `${variant}\0${testFile || ''}`;
  if (!builds.has(key)) {
    builds.set(key, (async () => {
      const v = VARIANTS[variant];
      assert.ok(v, `unknown product variant ${JSON.stringify(variant)}`);
      const dir = fs.mkdtempSync(path.join(scratch(), `${variant}-`));
      const original = path.join(ROOT, v.file);
      const source = fs.readFileSync(original, 'utf8');
      const at = source.indexOf(v.anchor);
      assert.ok(at >= 0 && source.indexOf(v.anchor, at + 1) < 0,
        `product variant ${variant}: ${v.file} must contain exactly one line ${JSON.stringify(v.anchor)}`);
      const replace = { [original]: path.join(dir, path.basename(v.file)) };
      const cut = at + v.anchor.length;
      fs.writeFileSync(replace[original], source.slice(0, cut) + v.insert + source.slice(cut));
      if (testFile) {
        const test = path.join(dir, 'wall_time_test.go');
        fs.writeFileSync(test, require(testFile));
        replace[path.join(ROOT, 'verify', 'wall_time_test.go')] = test;
      }
      const overlay = path.join(dir, 'overlay.json');
      fs.writeFileSync(overlay, JSON.stringify({ Replace: replace }));
      const bin = path.join(dir, 'verify.test');
      const args = ['test', '-c', '-vet=off', '-o', bin, '-overlay', overlay, './verify'];
      const r = await run('go', args, { cwd: ROOT, env: { ...process.env, GOFLAGS: '' }, timeout: 110 * 1000 });
      assert.equal(r.code, 0, `go ${args.join(' ')} (in ${ROOT}, product variant ${variant}${testFile ? `, ${TEST} from ${testFile}` : ''}) failed: ${r.error ? r.error.message : ''}\n${r.output}`);
      return { bin, variant, testFile };
    })());
  }
  return builds.get(key);
};

// runTest runs TestWallTimeDeadlineAndNeverStarted `runs` times in the built binary, split over
// at most ten concurrent processes, and resolves with each process's command and result.
const runTest = async (built, runs) => {
  const procs = Math.min(10, runs);
  const counts = Array.from({ length: procs }, (_, i) => Math.floor(runs / procs) + (i < runs % procs ? 1 : 0));
  return Promise.all(counts.map(async (count) => {
    const args = ['-test.run', `^${TEST}$`, `-test.count=${count}`, '-test.v', '-test.timeout=100s'];
    const command = `${built.bin} ${args.join(' ')} (product variant ${built.variant}${built.testFile ? `, ${TEST} from ${built.testFile}` : ''}, run in verify)`;
    const r = await run(built.bin, args, { cwd: path.join(ROOT, 'verify'), timeout: 108 * 1000 });
    return { ...r, count, command };
  }));
};

const tail = (text) => text.length > 4000 ? `...${text.slice(-4000)}` : text;
const passes = (output) => (output.match(new RegExp(`^--- PASS: ${TEST} \\(`, 'gm')) || []).length;
const failures = (output) => [...output.matchAll(new RegExp(`^--- FAIL: ${TEST} \\(([0-9.]+)s\\)`, 'gm'))].map((m) => Number(m[1]));
const outcome = (r) => `exit ${r.code}${r.signal ? `, signal ${r.signal}` : ''}, ${passes(r.output)} passed, ${failures(r.output).length} failed, ${r.seconds.toFixed(1)} s`;

// requireEveryRunPasses: every process exited 0 and reported exactly its count of passed runs.
const requireEveryRunPasses = (results, runs) => {
  const total = results.reduce((n, r) => n + passes(r.output), 0);
  for (const r of results) {
    assert.ok(r.code === 0 && passes(r.output) === r.count && failures(r.output).length === 0,
      `${TEST} must pass all ${r.count} runs of ${r.command}; got ${outcome(r)} (${total} of ${runs} runs passed in all processes):\n${tail(r.output)}`);
  }
  assert.equal(total, runs, `${TEST} passed ${total} of ${runs} runs`);
};

// requireFails: the test ran and reported a failure, and was not stopped by the test timeout.
const requireFails = (results) => {
  assert.equal(results.length, 1);
  const r = results[0];
  assert.ok(r.code !== 0 && r.code !== null && failures(r.output).length === 1 && passes(r.output) === 0 && !/panic: test timed out/.test(r.output),
    `${TEST} must run once and fail (not pass, not time out) in ${r.command}; got ${outcome(r)}:\n${tail(r.output)}`);
  return failures(r.output)[0];
};

// requireFailsAtFallback: requireFails, with the failed run lasting from 30 s (the fallback
// deadline) to under 60 s.
const requireFailsAtFallback = (results) => {
  const seconds = requireFails(results);
  const r = results[0];
  assert.ok(seconds >= 30 && seconds < 60,
    `${TEST} must fail at its 30 s fallback deadline in ${r.command}; its failed run took ${seconds} s (${outcome(r)}):\n${tail(r.output)}`);
};

// control judges the test from testFile against all three variants, stopping at the first
// rejection, and prints one line. The known-good control expects acceptance.
const control = async (name) => {
  const testFile = path.join(__dirname, `k-verify-wall-time-test-clock__${name}.js`);
  const checks = [
    ['slow-pre-setup', 300, (r) => requireEveryRunPasses(r, 300)],
    ['ignore-deadline', 1, requireFails],
    ['never-start', 1, requireFailsAtFallback],
  ];
  try {
    for (const [variant] of checks) await build(variant, testFile);
    for (const [variant, runs, judge] of checks) {
      try {
        judge(await runTest(await build(variant, testFile), runs));
      } catch (e) {
        process.stdout.write(`observer rejected: ${variant}\n`);
        if (name === 'good') process.stderr.write(`${e.message}\n`);
        return 1;
      }
    }
    process.stdout.write('observer accepted\n');
    return 0;
  } finally {
    cleanup();
  }
};

module.exports = { build, runTest, requireEveryRunPasses, requireFails, requireFailsAtFallback, cleanup };

if (require.main === module) {
  const name = process.argv[2];
  if (name !== 'good' && name !== 'old') {
    process.stderr.write('usage: node k-verify-wall-time-test-clock__driver.js good|old\n');
    process.exit(2);
  }
  control(name).then((code) => process.exit(code), (e) => { process.stdout.write(`observer error: ${e.message}\n`); process.exit(3); });
}
