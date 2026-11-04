'use strict';

// Judges one report of TestApprovalFitAcceptanceDriver (k-verify-approval-acceptance-fits-step__driver.js):
// the refusal of an approval readiness check and the approval attempt record retained for it.
// `node features/steps/k-verify-approval-acceptance-fits-step__observer.js good|bad` runs the
// known-good and known-bad controls of these same bytes.

const assert = require('node:assert/strict');

const stepsRan = /^Steps that ran, with wall time \(each step has its own \d+s limit\):$/;
const entry = /^ {2}(\d+\.\d)s(, still running when stopped)?: (.+)$/;

function text(r) {
  return (r.lines || []).join('\n');
}

// timedOut checks the step_timeout refusal of step and its one retained approval attempt record,
// whose failure lines are the refusal lines before the Evidence line; it returns the step's
// measured wall time in seconds.
function timedOut(r, step) {
  assert.equal(r.refused, true, `the approval check was refused; report: ${JSON.stringify(r)}`);
  assert.deepEqual({ class: r.class, reason: r.reason, exit: r.exit }, { class: 'environment', reason: 'step_timeout', exit: 3 }, `refusal class, reason and exit; text:\n${r.text}`);
  const m = new RegExp(`^Approval step ${step} timed out after (\\d+\\.\\d)s and was stopped`).exec(r.detail || '');
  assert.ok(m, `refusal detail names the timed-out step ${step}, got ${JSON.stringify(r.detail)}`);
  assert.equal(r.records.length, 1, `exactly one retained attempt record, got ${JSON.stringify(r.records.map((x) => x.path))}`);
  const x = r.records[0];
  assert.equal(x.record.kind, 'approval_attempt', 'the one retained record is an approval attempt');
  assert.equal(r.lines.at(-1), `Evidence: ${x.path}`, 'the last refusal line names the retained record');
  assert.deepEqual(x.record.failure.lines, r.lines.slice(0, -1), 'the retained failure lines are the refusal lines before the Evidence line');
  return Number(m[1]);
}

function ranIndex(r) {
  const i = r.lines.findIndex((l) => stepsRan.test(l));
  assert.ok(i >= 0, `the refusal lists the steps that ran; lines:\n${text(r)}`);
  return i;
}

function commandIndex(r) {
  const i = r.lines.findIndex((l) => l.startsWith('Command: '));
  assert.ok(i >= 0, `the refusal names the stopped command; lines:\n${text(r)}`);
  return i;
}

// shows checks that the refusal shows output before the steps that ran.
function shows(r, output) {
  const i = r.lines.indexOf(output);
  assert.ok(i >= 0, `the refusal shows the output line ${JSON.stringify(output)}; lines:\n${text(r)}`);
  assert.ok(i < ranIndex(r), `the output line ${JSON.stringify(output)} comes before the steps that ran`);
}

function lacks(r, line) {
  assert.ok(!r.lines.includes(line), `the refusal has no line ${JSON.stringify(line)}; lines:\n${text(r)}`);
}

function noEntries(r) {
  for (const l of r.lines) assert.ok(!entry.test(l), `the refusal lists no slowest step, got ${JSON.stringify(l)}`);
}

// slowest checks the timed-out acceptance refusal: header appears once, after the command and
// its output, followed by exactly the expected entries and then by the steps that ran. Each
// expected entry is { label, running, min }: its wall time is at least min seconds and at most
// the acceptance step's own wall time, and the entries are listed slowest first.
function slowest(r, header, expected) {
  const wall = timedOut(r, 'acceptance');
  const h = r.lines.indexOf(header);
  assert.ok(h >= 0, `the refusal has the line ${JSON.stringify(header)}; lines:\n${text(r)}`);
  assert.equal(r.lines.indexOf(header, h + 1), -1, `${JSON.stringify(header)} appears once`);
  assert.ok(commandIndex(r) < h, `${JSON.stringify(header)} comes after the command and its output`);
  assert.equal(ranIndex(r), h + 1 + expected.length, `exactly ${expected.length} slowest steps between ${JSON.stringify(header)} and the steps that ran; lines:\n${text(r)}`);
  let previous = Infinity;
  expected.forEach((want, i) => {
    const line = r.lines[h + 1 + i];
    const m = entry.exec(line);
    assert.ok(m, `slowest step ${i + 1} reads "  <seconds>s: <step>" or "  <seconds>s, still running when stopped: <step>", got ${JSON.stringify(line)}`);
    const seconds = Number(m[1]);
    assert.deepEqual({ step: m[3], running: Boolean(m[2]) }, { step: want.label, running: want.running }, `slowest step ${i + 1}: ${JSON.stringify(line)}`);
    assert.ok(seconds >= want.min - 0.05, `slowest step ${i + 1} took at least ${want.min}s, got ${JSON.stringify(line)}`);
    assert.ok(seconds <= wall + 0.05, `slowest step ${i + 1} took no longer than the ${wall}s acceptance step, got ${JSON.stringify(line)}`);
    assert.ok(seconds <= previous, `slowest steps are listed slowest first, got ${JSON.stringify(line)} after ${previous}s`);
    previous = seconds;
  });
  const others = r.lines.filter((l, i) => entry.test(l) && (i <= h || i > h + expected.length));
  assert.deepEqual(others, [], 'no slowest step outside the listed block');
}

function refused(r, cls, reason, exit) {
  assert.equal(r.refused, true, `the approval check was refused; report: ${JSON.stringify(r)}`);
  assert.deepEqual({ class: r.class, reason: r.reason, exit: r.exit }, { class: cls, reason, exit }, `refusal class, reason and exit; text:\n${r.text}`);
}

// limit checks that the refusal and its one retained approval attempt record state the step limit
// of every approval step in whole seconds.
function limit(r, seconds) {
  assert.equal(r.records.length, 1, `exactly one retained attempt record, got ${JSON.stringify(r.records.map((x) => x.path))}`);
  const x = r.records[0];
  assert.equal(x.record.kind, 'approval_attempt', 'the one retained record is an approval attempt');
  assert.equal(x.record.step_timeout_seconds, seconds, 'step_timeout_seconds of the retained approval attempt record');
  const line = `Steps that ran, with wall time (each step has its own ${seconds}s limit):`;
  assert.ok(r.lines.includes(line), `the refusal says ${JSON.stringify(line)}; lines:\n${text(r)}`);
}

// noStepTimes checks the timed-out acceptance refusal: none appears once, after the command and
// its output and right before the steps that ran, and no slowest step is listed.
function noStepTimes(r, none) {
  timedOut(r, 'acceptance');
  const i = r.lines.indexOf(none);
  assert.ok(i >= 0, `the refusal says ${JSON.stringify(none)}; lines:\n${text(r)}`);
  assert.equal(r.lines.indexOf(none, i + 1), -1, `${JSON.stringify(none)} appears once`);
  assert.ok(commandIndex(r) < i, `${JSON.stringify(none)} comes after the command and its output`);
  assert.equal(ranIndex(r), i + 1, `${JSON.stringify(none)} comes right before the steps that ran`);
  noEntries(r);
}

module.exports = { refused, limit, timedOut, shows, lacks, noEntries, slowest, noStepTimes };

if (require.main === module) {
  const header = 'Slowest Cucumber steps before the stop (from its report, slowest first):';
  const none = 'Its Cucumber report recorded no step times before the stop.';
  const outputHeader = 'Its output before it was stopped (stdout and stderr, secrets masked):';
  const load = 'Host load at start: unavailable; at end: unavailable. Load alone does not establish the cause.';
  const path = '/tmp/x/001/.kogen/local/readiness/attempts/fixture-20261104T124826Z-6cb9ccb7/attempt.json';
  const run = 'NODE_PATH="$KOGEN_CUCUMBER" "$KOGEN_NODE" "$KOGEN_CUCUMBER/@cucumber/cucumber/bin/cucumber.js" --strict --require \'features/steps/*.js\' --format "message:$KOGEN_ACCEPTANCE_REPORT" "$KOGEN_ACCEPTANCE_FEATURES"';
  const featuresLine = 'features: .kogen/intents/fixture/acceptance.feature';
  const expected = [
    { label: 'acceptance.feature line 9: Then the fixture step waits 60000 ms', running: true, min: 1 },
    { label: 'acceptance.feature line 3: Given the fixture step waits 3000 ms', running: false, min: 3 },
    { label: 'a hook at features/steps/fixture_steps.js line 2', running: false, min: 1.5 },
    { label: 'acceptance.feature line 5: Then the fixture step waits 800 ms', running: false, min: 0.8 },
    { label: 'acceptance.feature line 7: Given the fixture step waits 200 ms', running: false, min: 0.2 },
  ];
  const refusal = (step, wall, limit, lines) => ({
    root: '/tmp/x/001', refused: true, class: 'environment', reason: 'step_timeout', exit: 3,
    detail: `Approval step ${step} timed out after ${wall} and was stopped with its process group (the step limit is ${limit} for each step on its own).`,
    lines: [...lines, `Evidence: ${path}`],
    records: [{ path, record: { kind: 'approval_attempt', outcome: 'refused', failure: { class: 'environment', reason: 'step_timeout', step, timed_out: true, lines } } }],
  });
  const ran = (limit, step, wall) => [`Steps that ran, with wall time (each step has its own ${limit} limit):`, '  snapshot: passed in 0.0s', '  materialize: passed in 0.1s',
    `  ${step}: timed out after ${wall} and was stopped`, `Time in these steps: ${wall}`];
  const cucumber = () => refusal('acceptance', '14.1s', '14s', [`Command: ${run}`, outputHeader, '......', header,
    '  8.4s, still running when stopped: acceptance.feature line 9: Then the fixture step waits 60000 ms',
    '  3.0s: acceptance.feature line 3: Given the fixture step waits 3000 ms',
    '  1.5s: a hook at features/steps/fixture_steps.js line 2',
    '  0.8s: acceptance.feature line 5: Then the fixture step waits 800 ms',
    '  0.2s: acceptance.feature line 7: Given the fixture step waits 200 ms',
    ...ran('14s', 'acceptance', '14.1s'), load]);
  const silent = () => refusal('acceptance', '2.1s', '2s', ['Command: echo features: $KOGEN_ACCEPTANCE_FEATURES; sleep 30', outputHeader, featuresLine, none,
    ...ran('2s', 'acceptance', '2.1s'), load]);
  const setup = () => refusal('setup-1', '2.1s', '2s', ['Command: echo setup-marker; sleep 30', outputHeader, 'setup-marker', ...ran('2s', 'setup-1', '2.1s'), 'Not run: acceptance', load]);
  // The actual refusal of the unchanged code for the timed Cucumber fixture.
  const unchanged = () => refusal('acceptance', '14.1s', '14s', [`Command: ${run}`, outputHeader, '......', ...ran('14s', 'acceptance', '14.1s'), load]);
  const both = (r, f) => { f(r.lines); f(r.records[0].record.failure.lines); };
  const mutate = (make, change) => () => { const r = make(); change(r); return r; };
  const judgeSlowest = (r) => { slowest(r, header, expected); lacks(r, none); };
  const judgeNone = (r) => { timedOut(r, 'acceptance'); shows(r, featuresLine); noStepTimes(r, none); lacks(r, header); };
  const judgeSetup = (r) => { timedOut(r, 'setup-1'); shows(r, 'setup-marker'); lacks(r, header); lacks(r, none); noEntries(r); };
  const quickLines = ['report_missing: the acceptance command exited 1; its output:', 'quick-failure', 'Steps that ran, with wall time (each step has its own 120s limit):',
    '  snapshot: passed in 0.0s', '  materialize: passed in 0.1s', '  acceptance: failed with exit 1 after 0.1s', 'Time in these steps: 0.2s'];
  const quick = () => ({ root: '/tmp/x/001', refused: true, class: 'intent', reason: 'not_ready', exit: 1, detail: 'the Intent is not ready to build',
    lines: [...quickLines, `Evidence: ${path}`], records: [{ path, record: { kind: 'approval_attempt', outcome: 'refused', step_timeout_seconds: 120, failure: { lines: quickLines } } }] });
  const judgeLimit = (r) => { refused(r, 'intent', 'not_ready', 1); limit(r, 120); };
  const good = [() => judgeLimit(quick()), () => judgeSlowest(cucumber()), () => judgeNone(silent()), () => judgeSetup(setup())];
  const bad = [
    [mutate(quick, (r) => { r.records[0].record.step_timeout_seconds = 300; }), judgeLimit],
    [mutate(quick, (r) => { r.lines[2] = 'Steps that ran, with wall time (each step has its own 300s limit):'; }), judgeLimit],
    [mutate(quick, (r) => { r.records = []; }), judgeLimit],
    [mutate(quick, (r) => { r.reason = 'step_timeout'; }), judgeLimit],
    [unchanged, judgeSlowest],
    [mutate(cucumber, (r) => both(r, (l) => { const i = l.indexOf(header); [l[i + 1], l[i + 2]] = [l[i + 2], l[i + 1]]; })), judgeSlowest],
    [mutate(cucumber, (r) => both(r, (l) => l.splice(l.indexOf(header) + 6, 0, '  0.0s: acceptance.feature line 4: When the fixture step waits 0 ms'))), judgeSlowest],
    [mutate(cucumber, (r) => both(r, (l) => { l[l.indexOf(header) + 1] = '  8.4s: acceptance.feature line 9: Then the fixture step waits 60000 ms'; })), judgeSlowest],
    [mutate(cucumber, (r) => both(r, (l) => { l[l.indexOf(header) + 3] = '  1.5s: a hook (location not reported)'; })), judgeSlowest],
    [mutate(cucumber, (r) => both(r, (l) => { l[l.indexOf(header) + 2] = '  2.0s: acceptance.feature line 3: Given the fixture step waits 3000 ms'; })), judgeSlowest],
    [mutate(cucumber, (r) => both(r, (l) => { l[l.indexOf(header) + 1] = '  20.0s, still running when stopped: acceptance.feature line 9: Then the fixture step waits 60000 ms'; })), judgeSlowest],
    [mutate(cucumber, (r) => both(r, (l) => { const block = l.splice(l.indexOf(header), 6); l.splice(l.indexOf(`Command: ${run}`), 0, ...block); })), judgeSlowest],
    [mutate(cucumber, (r) => { r.records[0].record.failure.lines = r.records[0].record.failure.lines.filter((l) => l !== header); }), judgeSlowest],
    [mutate(cucumber, (r) => both(r, (l) => l.splice(l.indexOf(header), 0, none))), judgeSlowest],
    [mutate(cucumber, (r) => both(r, (l) => l.splice(l.indexOf(header) + 6, 1))), judgeSlowest],
    [mutate(silent, (r) => both(r, (l) => l.splice(l.indexOf(none), 1))), judgeNone],
    [mutate(silent, (r) => both(r, (l) => l.splice(l.indexOf(none), 0, header))), judgeNone],
    [mutate(silent, (r) => both(r, (l) => { l.splice(l.indexOf(none), 1); l.splice(l.indexOf(load), 0, none); })), judgeNone],
    [mutate(silent, (r) => both(r, (l) => { l[l.indexOf(featuresLine)] = 'features: features/other.feature'; })), judgeNone],
    [mutate(silent, (r) => both(r, (l) => l.splice(l.indexOf(none), 0, '  0.1s: acceptance.feature line 3: Given a step'))), judgeNone],
    [mutate(setup, (r) => both(r, (l) => l.splice(l.findIndex((x) => stepsRan.test(x)), 0, none))), judgeSetup],
    [mutate(setup, (r) => both(r, (l) => l.splice(l.findIndex((x) => stepsRan.test(x)), 0, header, '  2.1s, still running when stopped: setup-1'))), judgeSetup],
    [mutate(setup, (r) => { r.records.push(r.records[0]); }), judgeSetup],
    [mutate(setup, (r) => { r.lines.pop(); }), judgeSetup],
  ];
  if (process.argv[2] === 'good') {
    for (const g of good) g();
    console.log('observer accepted');
  } else if (process.argv[2] === 'bad') {
    bad.forEach(([make, judge], i) => {
      let rejected = false;
      try { judge(JSON.parse(JSON.stringify(make()))); } catch (e) { rejected = e instanceof assert.AssertionError; }
      if (!rejected) throw new Error(`observer accepted known-bad control ${i + 1}`);
    });
    console.log('observer rejected');
    process.exitCode = 1;
  } else {
    console.error('usage: node features/steps/k-verify-approval-acceptance-fits-step__observer.js good|bad');
    process.exitCode = 2;
  }
}
