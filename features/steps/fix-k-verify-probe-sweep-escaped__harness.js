'use strict';
// Acceptance harness for fix-k-verify-probe-sweep-escaped. It builds the verify test binary
// with go build overlays (kept outside the checkout) that break the probe's process cleanup in
// a named way, runs tests in it and judges the outcome. Loading this file defines no steps and
// does no work; `node <this file> good|bad` runs the observer controls.
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TEST = 'TestProbeRealTimeoutEscaped';
const TAG = '//go:build linux || darwin';
const SWEEP = 'logSweep(pr.Log, "probe", stepMarker, runID, markerFile)';
const REAPER_STOP = 'if syscall.Kill(p.pid, sig) == syscall.EPERM {';

// Each edit replaces text that must occur exactly once in a file of package verify.
// no-reaper-stop keeps the probe's subreaper reaping exited children but treats every live
// adopted child as refused, so it leaves the escaped child running for the marker sweep.
const EDITS = {
  'no-sweep': { file: 'probe.go', from: SWEEP, to: '' },
  'event-only': { file: 'probe.go', from: SWEEP, to: 'logEvent(pr.Log, map[string]any{"event": "step_sweep", "name": "probe", "stopped": 0, "ms": 0})' },
  'no-reaper-stop': { file: 'sweep_linux.go', from: REAPER_STOP, to: 'if sig != 0 {' },
};
const VARIANTS = {
  unchanged: [],
  'no-sweep': ['no-sweep'],
  'no-reaper-stop': ['no-reaper-stop'],
  'event-only-no-reaper-stop': ['event-only', 'no-reaper-stop'],
};
// The known-bad control replaces the test file with a test of the same name that always fails.
const FAILING = `package verify\n\nimport "testing"\n\nfunc ${TEST}(t *testing.T) { t.Fatal("observer control: known-bad run") }\n`;

let tmp;
const builds = new Map();

const scratch = () => {
  if (!tmp) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fix-probe-sweep-escaped-'));
  return tmp;
};

const cleanup = () => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
  builds.clear();
};

// run starts file without blocking the event loop and resolves with its exit code (null when
// it did not exit normally), error and output.
const run = (file, args, options) => new Promise((resolve) => {
  execFile(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
    const code = !error ? 0 : (typeof error.code === 'number' ? error.code : null);
    resolve({ code, error, output: stdout + stderr });
  });
});

// edit applies the named edit to text, the content of verify/<file>.
function edit(text, name) {
  const { file, from, to } = EDITS[name];
  const count = text.split(from).length - 1;
  assert.equal(count, 1, `the ${name} edit needs verify/${file} to contain exactly once: ${from} (found ${count})`);
  return text.replace(from, () => to);
}

// replacements are the verify files the variant replaces, as file name to content.
function replacements(root, variant) {
  if (variant === 'control-fail') return { 'probe_timeout_sweep_test.go': FAILING };
  assert.ok(VARIANTS[variant], `unknown variant ${variant}; known: ${Object.keys(VARIANTS).join(', ')}`);
  const out = {};
  for (const name of VARIANTS[variant]) {
    const file = EDITS[name].file;
    out[file] = edit(out[file] ?? fs.readFileSync(path.join(root, 'verify', file), 'utf8'), name);
  }
  return out;
}

// build compiles the verify test binary of the variant once per run; later calls reuse it.
function build(root, variant) {
  if (!builds.has(variant)) {
    builds.set(variant, (async () => {
      const dir = fs.mkdtempSync(path.join(scratch(), `${variant}-`));
      const replace = {};
      for (const [file, content] of Object.entries(replacements(root, variant))) {
        const copy = path.join(dir, file);
        fs.writeFileSync(copy, content);
        replace[path.join(root, 'verify', file)] = copy;
      }
      const overlay = path.join(dir, 'overlay.json');
      fs.writeFileSync(overlay, JSON.stringify({ Replace: replace }));
      const bin = path.join(dir, 'verify.test');
      const args = ['test', '-c', '-o', bin, '-overlay', overlay, './verify'];
      const r = await run('go', args, { cwd: root, env: { ...process.env, GOFLAGS: '' }, timeout: 80 * 1000 });
      assert.equal(r.code, 0, `go ${args.join(' ')} (in ${root}, ${variant} variant) failed: ${r.error ? r.error.message : ''}\n${r.output}`);
      return bin;
    })());
  }
  return builds.get(variant);
}

// stopLeftovers kills the processes whose working directory is inside dir: the probe scratch
// copies of one test run live there, so a child the variant let escape is stopped here.
function stopLeftovers(dir) {
  if (!fs.existsSync('/proc')) return;
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    let cwd;
    try { cwd = fs.readlinkSync(`/proc/${entry}/cwd`); } catch { continue; }
    if (cwd === dir || cwd.startsWith(dir + '/') || cwd.startsWith(dir + ' ')) {
      try { process.kill(Number(entry), 'SIGKILL'); } catch { /* already gone */ }
    }
  }
}

// runTests runs the named tests (anchored) in the variant's test binary with a private
// temporary directory, so its probe scratch copies and any escaped child are found afterwards.
async function runTests(root, variant, names = [TEST]) {
  const bin = await build(root, variant);
  const own = fs.mkdtempSync(path.join(scratch(), 'run-'));
  const args = ['-test.run', `^(${names.join('|')})$`, '-test.count=1', '-test.v', '-test.timeout=25s'];
  const command = `${bin} ${args.join(' ')} (verify test binary, ${variant} variant, run in verify)`;
  try {
    const r = await run(bin, args, { cwd: path.join(root, 'verify'), env: { ...process.env, TMPDIR: own, GOTMPDIR: own }, timeout: 30 * 1000 });
    return { variant, names, command, code: r.code, output: r.output + (r.error && r.code === null ? `\n${r.error.message}` : '') };
  } finally {
    stopLeftovers(own);
    fs.rmSync(own, { recursive: true, force: true });
  }
}

function outcome(output, name) {
  if (new RegExp(`^--- FAIL: ${name} \\(`, 'm').test(output)) return 'failed';
  if (new RegExp(`^--- SKIP: ${name} \\(`, 'm').test(output)) return 'was skipped';
  if (new RegExp(`^--- PASS: ${name} \\(`, 'm').test(output)) return 'passed';
  if (/no tests to run/.test(output)) return 'ran zero times (absent)';
  return 'reported no result (absent or did not finish)';
}

// judgeRun requires the run to have passed or failed TestProbeRealTimeoutEscaped itself.
function judgeRun(expect, r) {
  const seen = outcome(r.output, TEST);
  const ok = expect === 'pass' ? r.code === 0 && seen === 'passed' : r.code !== 0 && seen === 'failed';
  assert.ok(ok, `${TEST} must ${expect} with the ${r.variant} variant, but it ${seen} (exit ${r.code}): ${r.command}\n${r.output}`);
}

// judgeEach requires every named test to have passed in a run that exited 0.
function judgeEach(r) {
  const problems = r.names.map((name) => [name, outcome(r.output, name)]).filter(([, seen]) => seen !== 'passed')
    .map(([name, seen]) => `${name} ${seen}`);
  assert.ok(r.code === 0 && problems.length === 0,
    `every named test must pass with the ${r.variant} variant (exit ${r.code}${problems.length ? '; ' + problems.join('; ') : ''}): ${r.command}\n${r.output}`);
}

function judgeFirstLine(file, text, line) {
  assert.equal(text.split('\n')[0], line, `${file} must start with the line ${line}`);
}

module.exports = { runTests, judgeRun, judgeEach, judgeFirstLine, cleanup };

if (require.main === module) {
  (async () => {
    const root = process.cwd();
    let passing, failing;
    try {
      passing = await runTests(root, 'unchanged');
      failing = await runTests(root, 'control-fail');
    } catch (e) {
      console.log(`control runs failed: ${e.message}`);
      process.exitCode = 2;
      return;
    } finally {
      cleanup();
    }
    const probe = fs.readFileSync(path.join(root, 'verify', 'probe.go'), 'utf8');
    const sweep = fs.readFileSync(path.join(root, 'verify', 'sweep_linux.go'), 'utf8');
    const file = 'verify/probe_timeout_sweep_test.go';
    // Known-good: real passing and failing runs judged as such, the tag line, and the edits
    // applied to the real sources. Known-bad: the same runs judged the other way, a name that
    // did not run, files without the tag or with another tag, and edits whose text is absent
    // or repeated.
    const cases = process.argv[2] === 'bad' ? [
      () => judgeRun('fail', passing),
      () => judgeRun('pass', failing),
      () => judgeEach(failing),
      () => judgeEach({ ...passing, names: [TEST, 'TestNoSuchExistingTest'] }),
      () => judgeFirstLine(file, 'package verify\n', TAG),
      () => judgeFirstLine(file, '//go:build linux\n\npackage verify\n', TAG),
      () => edit('package verify\n', 'no-sweep'),
      () => edit(`${SWEEP}\n${SWEEP}\n`, 'event-only'),
      () => edit('package verify\n', 'no-reaper-stop'),
    ] : [
      () => judgeRun('pass', passing),
      () => judgeRun('fail', failing),
      () => judgeEach(passing),
      () => judgeFirstLine(file, `${TAG}\n\npackage verify\n`, TAG),
      () => edit(probe, 'no-sweep'),
      () => edit(probe, 'event-only'),
      () => edit(sweep, 'no-reaper-stop'),
    ];
    const accepted = cases.filter((c) => { try { c(); return true; } catch { return false; } }).length;
    if (process.argv[2] === 'bad') {
      console.log(accepted === 0 ? 'rejected' : `accepted ${accepted} of ${cases.length}`);
      process.exitCode = accepted === 0 ? 1 : 0;
    } else {
      console.log(accepted === cases.length ? 'accepted' : `rejected ${cases.length - accepted} of ${cases.length}`);
      process.exitCode = accepted === cases.length ? 0 : 1;
    }
  })();
}
