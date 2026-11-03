'use strict';

// Judges one report of features/steps/testdata/shapetimeout/driver.go: the refusal of a bounded
// Shape readiness check and every attempt record retained under the fixture project's
// .kogen/local/readiness/attempts. `node features/steps/shapetimeout_observer.js good|bad` runs
// the known-good and known-bad controls of these same bytes.

const assert = require('node:assert/strict');

const firstLine = 'acceptance timed out: command exceeds the 120-second limit';
const outputHeader = 'Its output before it was stopped (stdout and stderr, secrets masked):';
const noOutput = 'It wrote no output before it was stopped.';
const wallLine = /^Acceptance ran for (\d+\.\d)s before it was stopped with its process group\.$/;

function formatLoad(v) {
  if (v === null) return 'unavailable';
  return `1-minute ${v.load1.toFixed(2)}, 5-minute ${v.load5.toFixed(2)}`;
}

function loadLine(step) {
  return `Host load at start: ${formatLoad(step.load_start)}; at end: ${formatLoad(step.load_end)}. Load alone does not establish the cause.`;
}

function checkLoad(step, key) {
  assert.ok(Object.prototype.hasOwnProperty.call(step, key), `retained step ${step.name} has ${key} (null when unavailable)`);
  const v = step[key];
  if (v === null) return;
  assert.ok(v && Number.isFinite(v.load1) && Number.isFinite(v.load5) && v.load1 >= 0 && v.load5 >= 0, `retained step ${step.name}: ${key} is null or two nonnegative readings, got ${JSON.stringify(v)}`);
}

function refused(r, cls, reason, exit) {
  assert.equal(r.refused, true, `the check was refused; report: ${JSON.stringify(r)}`);
  assert.deepEqual({ class: r.class, reason: r.reason, exit: r.exit }, { class: cls, reason, exit }, `refusal class, reason and exit; text:\n${r.text}`);
}

function ready(r, exit) {
  assert.equal(r.refused, false, `the check was ready, but it was refused:\n${r.text}`);
  assert.equal(r.acceptance_exit, exit, 'acceptance exit of the ready result');
  assert.equal(r.failures, exit !== 0, 'an accounted failed scenario exactly when acceptance exited nonzero');
}

function noEvidence(r) {
  assert.deepEqual(r.records.map((x) => x.path), [], 'no attempt record is retained');
  for (const l of r.lines || []) {
    assert.ok(!/^Evidence/.test(l) && !/^Host load/.test(l), `no evidence or host load line in the refusal, got ${JSON.stringify(l)}`);
  }
}

// only returns the single retained record and checks it is private and under the attempts folder.
function only(r) {
  assert.equal(r.records.length, 1, `exactly one retained attempt record, got ${JSON.stringify(r.records.map((x) => x.path))}`);
  const x = r.records[0];
  const folder = `${r.root}/.kogen/local/readiness/attempts/`;
  assert.ok(x.path.startsWith(folder) && x.path.endsWith('/attempt.json') && !x.path.slice(folder.length, -'/attempt.json'.length).includes('/'),
    `record is <attempts>/<id>/attempt.json under ${folder}, got ${x.path}`);
  assert.equal(x.file_mode, 0o600, `record file mode 0600, got ${x.file_mode.toString(8)}`);
  assert.equal(x.dir_mode, 0o700, `record folder mode 0700, got ${x.dir_mode.toString(8)}`);
  return x;
}

// shapeTimeout judges a Shape acceptance timeout without a caller attempt; output is the text
// the command printed before the stop, or null when it printed nothing.
function shapeTimeout(r, output) {
  refused(r, 'intent', 'not_ready', 1);
  assert.equal(r.detail, 'acceptance timed out', 'refusal detail');
  const x = only(r);
  const rec = x.record;
  assert.equal(rec.kind, 'shape_attempt', 'retained record kind');
  assert.equal(rec.outcome, 'refused', 'retained record outcome');
  assert.equal(rec.slug, 'fixture', 'retained record slug');
  assert.deepEqual(rec.not_run, [], 'retained record not_run');
  assert.ok(typeof rec.note === 'string' && rec.note.includes('not readiness evidence'), `retained record note says it is not readiness evidence, got ${JSON.stringify(rec.note)}`);
  assert.deepEqual(rec.steps.map((s) => s.name), ['acceptance'], 'retained record steps');
  const st = rec.steps[0];
  assert.deepEqual({ kind: st.kind, status: st.status, timed_out: st.timed_out, command: st.command }, { kind: 'acceptance', status: 'timed_out', timed_out: true, command: r.command }, 'retained timed-out acceptance step');
  const start = Date.parse(st.started_at), end = Date.parse(st.ended_at);
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && start >= Date.parse(r.began) && end <= Date.parse(r.ended) && end >= start, `step instants bracket the check: ${st.started_at} .. ${st.ended_at}`);
  assert.ok(st.duration_ms >= r.bound_ms, `the step ran at least its ${r.bound_ms} ms bound, got ${st.duration_ms} ms`);
  checkLoad(st, 'load_start');
  checkLoad(st, 'load_end');
  if (output === null) assert.ok(!st.output, `retained step has no output, got ${JSON.stringify(st.output)}`);
  else assert.ok(typeof st.output === 'string' && st.output.includes(output), `retained step output holds ${JSON.stringify(output)}, got ${JSON.stringify(st.output)}`);

  const lines = r.lines;
  assert.equal(lines[0], firstLine, 'first refusal line unchanged');
  const wall = wallLine.exec(lines[1] || '');
  assert.ok(wall, `second refusal line reports the measured wall time, got ${JSON.stringify(lines[1])}`);
  assert.ok(Math.abs(Number(wall[1]) * 1000 - st.duration_ms) <= 51, `reported ${wall[1]}s agrees with the retained ${st.duration_ms} ms`);
  const shown = output === null ? [noOutput] : [outputHeader, output];
  const want = [firstLine, lines[1], ...shown, loadLine(st), `Evidence: ${x.path}`];
  assert.deepEqual(lines, want, 'refusal lines, in order');
  assert.deepEqual({ class: rec.failure.class, reason: rec.failure.reason, detail: rec.failure.detail, step: rec.failure.step, timed_out: rec.failure.timed_out },
    { class: 'intent', reason: 'not_ready', detail: 'acceptance timed out', step: 'acceptance', timed_out: true }, 'retained failure');
  assert.deepEqual(rec.failure.lines, lines.slice(0, -1), 'retained failure lines are the refusal lines before the evidence path');
}

// approval judges a Shape-bounded check that the caller gave its own approval Attempt.
function approval(r, output) {
  refused(r, 'environment', 'step_timeout', 3);
  assert.ok(r.detail.startsWith('Approval step acceptance timed out after '), `approval refusal detail, got ${JSON.stringify(r.detail)}`);
  const x = only(r);
  assert.equal(x.record.kind, 'approval_attempt', 'the one retained record is the approval attempt');
  const st = x.record.steps.at(-1);
  assert.equal(st.name, 'acceptance', 'last approval step');
  assert.ok(!r.lines.includes(firstLine), 'no Shape timeout line in an approval refusal');
  assert.ok(r.lines.includes(output), `approval refusal shows ${JSON.stringify(output)}`);
  assert.ok(r.lines.includes(loadLine(st)), 'approval refusal shows the host load line');
  assert.equal(r.lines.at(-1), `Evidence: ${x.path}`, 'approval refusal names its one record');
}

module.exports = { refused, ready, noEvidence, shapeTimeout, approval };

if (require.main === module) {
  const root = '/tmp/x/001';
  const path = `${root}/.kogen/local/readiness/attempts/fixture-20261103T103437Z-fd813e3d/attempt.json`;
  const step = { command: 'echo partial-marker; sleep 30', duration_ms: 1110, ended_at: '2026-11-03T10:34:39.101827Z', exit: 143, kind: 'acceptance', load_end: { load1: 17, load5: 30 }, load_start: null, name: 'acceptance', output: 'partial-marker\n', start_ms: 0, started_at: '2026-11-03T10:34:37.991245Z', status: 'timed_out', timed_out: true };
  const base = { root, bound_ms: 1000, command: step.command, began: '2026-11-03T10:34:37.741954Z', ended: '2026-11-03T10:34:39.144331Z', refused: true };
  function shape(output) {
    const st = { ...step };
    if (output === null) { delete st.output; st.command = 'sleep 30'; }
    const lines = [firstLine, 'Acceptance ran for 1.1s before it was stopped with its process group.', ...(output === null ? [noOutput] : [outputHeader, output]),
      'Host load at start: unavailable; at end: 1-minute 17.00, 5-minute 30.00. Load alone does not establish the cause.'];
    const rec = { version: 1, kind: 'shape_attempt', outcome: 'refused', slug: 'fixture', started_at: '2026-11-03T10:34:37Z', step_timeout_seconds: 1, elapsed_ms: 1200, steps: [st], not_run: [],
      failure: { class: 'intent', reason: 'not_ready', detail: 'acceptance timed out', step: 'acceptance', timed_out: true, lines },
      note: 'Private local diagnostic evidence of a Shape acceptance check; it is not readiness evidence and not approval.' };
    return { ...base, command: st.command, class: 'intent', reason: 'not_ready', detail: 'acceptance timed out', exit: 1, lines: [...lines, `Evidence: ${path}`], records: [{ path, file_mode: 0o600, dir_mode: 0o700, record: rec }] };
  }
  function appr() {
    const st = { ...step, load_end: null };
    const lines = ['Command: echo partial-marker; sleep 30', outputHeader, 'partial-marker', 'Steps that ran, with wall time (each step has its own 1s limit):', '  acceptance: timed out after 1.1s and was stopped', 'Time in these steps: 1.1s',
      'Host load at start: unavailable; at end: unavailable. Load alone does not establish the cause.'];
    return { ...base, class: 'environment', reason: 'step_timeout', exit: 3, detail: 'Approval step acceptance timed out after 1.1s and was stopped with its process group (the step limit is 1s for each step on its own).',
      lines: [...lines, `Evidence: ${path}`], records: [{ path, file_mode: 0o600, dir_mode: 0o700, record: { kind: 'approval_attempt', steps: [st] } }] };
  }
  const passed = { ...base, refused: false, acceptance_exit: 0, failures: false, records: [] };
  const red = { ...passed, acceptance_exit: 1, failures: true };
  const failed = { ...base, class: 'intent', reason: 'not_ready', detail: 'the Intent is not ready to build', exit: 1, lines: ['report_missing: the acceptance command exited 1; its output:', 'plain-failure'], records: [] };
  const good = [
    () => shapeTimeout(shape('partial-marker'), 'partial-marker'),
    () => shapeTimeout(shape(null), null),
    () => { ready(passed, 0); noEvidence(passed); },
    () => { ready(red, 1); noEvidence(red); },
    () => { refused(failed, 'intent', 'not_ready', 1); noEvidence(failed); },
    () => approval(appr(), 'partial-marker'),
  ];
  const mutate = (f, m) => () => { const r = f(); m(r); return r; };
  const bad = [
    // The actual refusal of the unchanged code: one line, nothing retained.
    [() => ({ ...base, class: 'intent', reason: 'not_ready', detail: 'acceptance timed out', exit: 1, lines: [firstLine], records: [] }), (r) => shapeTimeout(r, 'partial-marker')],
    [mutate(() => shape('partial-marker'), (r) => { r.lines[3] = 'other'; }), (r) => shapeTimeout(r, 'partial-marker')],
    [mutate(() => shape('partial-marker'), (r) => { r.lines[1] = 'Acceptance ran for 9.9s before it was stopped with its process group.'; r.records[0].record.failure.lines[1] = r.lines[1]; }), (r) => shapeTimeout(r, 'partial-marker')],
    [mutate(() => shape('partial-marker'), (r) => { r.lines[4] = r.lines[4].replace(' Load alone does not establish the cause.', ''); r.records[0].record.failure.lines[4] = r.lines[4]; }), (r) => shapeTimeout(r, 'partial-marker')],
    [mutate(() => shape('partial-marker'), (r) => { r.records[0].file_mode = 0o644; }), (r) => shapeTimeout(r, 'partial-marker')],
    [mutate(() => shape('partial-marker'), (r) => { r.records[0].record.kind = 'approval_attempt'; }), (r) => shapeTimeout(r, 'partial-marker')],
    [mutate(() => shape('partial-marker'), (r) => { delete r.records[0].record.steps[0].load_end; }), (r) => shapeTimeout(r, 'partial-marker')],
    [mutate(() => shape('partial-marker'), (r) => { r.lines.pop(); }), (r) => shapeTimeout(r, 'partial-marker')],
    [mutate(() => shape(null), (r) => { r.lines[2] = outputHeader; }), (r) => shapeTimeout(r, null)],
    [mutate(() => passed, (r) => { r.records = [{ path }]; }), (r) => { ready(r, 0); noEvidence(r); }],
    [mutate(() => failed, (r) => { r.lines = [...r.lines, `Evidence: ${path}`]; }), (r) => noEvidence(r)],
    [mutate(appr, (r) => { r.records.push(r.records[0]); }), (r) => approval(r, 'partial-marker')],
    [mutate(appr, (r) => { r.lines = [firstLine, ...r.lines]; }), (r) => approval(r, 'partial-marker')],
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
    console.error('usage: node features/steps/shapetimeout_observer.js good|bad');
    process.exitCode = 2;
  }
}
