'use strict';

// Judgements of the per-step sweep, applied to the JSON report that
// features/steps/testdata/sweepsteps/driver.go (TestStepSweepAcceptanceDriver) writes. Run
// directly as `node features/steps/sweep_steps_observer.js good` it applies every judgement to
// known-good reports and prints "observer accepted"; with `bad` it applies them to known-bad
// reports, each wrong in one way, and prints "observer rejected every known-bad report" (exit 1)
// only when each one is rejected.

const assert = require('node:assert/strict');

const show = (r) => JSON.stringify(r);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const isSweep = (e) => typeof e.event.event === 'string' && e.event.event.endsWith('_sweep');

// eventsOf lists the report's events of one pass (all of them when pass is undefined).
function eventsOf(r, pass) {
  return r.events.filter((e) => pass === undefined || e.pass === pass);
}

function controlLeftServer(r, server) {
  assert.equal(r.ps_error, undefined, `the driver could not list the processes, so no survivor count can be trusted: ${r.ps_error}`);
  for (const c of r.control) {
    assert.ok(c.servers >= 1,
      `the control run of ${JSON.stringify(r.command)} (today's per-step guard, no sweep) left no ${JSON.stringify(server)} running, so the fixture starts no detached server here; control ${show(c)}`);
  }
}

// After each named step returned (300 ms after its command_result), and 1 s after the run, no
// server the run started is running; the control run proves the command leaves one.
function serversStoppedAfterEachStep(r, steps, server) {
  assert.equal(r.server, server, `the driver looked for ${JSON.stringify(r.server)}, not ${JSON.stringify(server)}`);
  controlLeftServer(r, server);
  for (const step of steps) {
    assert.ok(Object.hasOwn(r.at_result, step), `step ${step} wrote no command_result event; events ${show(r.events.map((e) => e.event))}`);
    assert.equal(r.at_result[step], 0,
      `${r.at_result[step]} ${JSON.stringify(server)} started by the run still running 300 ms after step ${step} returned; report ${show(r)}`);
  }
  assert.equal(r.final_servers, 0, `${r.final_servers} ${JSON.stringify(server)} started by the run still running 1 s after the run returned`);
}

function serversStoppedAfterRun(r, server) {
  assert.equal(r.server, server, `the driver looked for ${JSON.stringify(r.server)}, not ${JSON.stringify(server)}`);
  controlLeftServer(r, server);
  assert.equal(r.final_servers, 0,
    `${r.final_servers} ${JSON.stringify(server)} started by the run still running 1 s after the check returned; report ${show(r)}`);
}

function bystanderRunning(r, bystander) {
  assert.equal(r.bystander, 'running', `the bystander ${JSON.stringify(bystander)} the test started in its own session is ${r.bystander} after the run`);
}

// Each named step's command_result has this status and output, and so has the control run.
function sameAsControl(r, steps, status, output) {
  const c = r.control[0];
  assert.equal(c.status, status, `the control run of ${JSON.stringify(r.command)} exited ${c.status}`);
  assert.equal(c.output, output, `the control run of ${JSON.stringify(r.command)} printed ${JSON.stringify(c.output)}`);
  for (const step of steps) {
    const res = r.events.find((e) => e.event.event === 'command_result' && e.event.name === step);
    assert.ok(res, `step ${step} wrote no command_result event; events ${show(r.events.map((e) => e.event))}`);
    assert.equal(res.event.status, c.status, `step ${step} exited ${res.event.status}, the control run ${c.status}`);
    assert.equal(res.event.output, c.output, `step ${step} printed ${JSON.stringify(res.event.output)}, the control run ${JSON.stringify(c.output)}`);
  }
}

// Each named step wrote exactly one *_sweep event, the named one, naming the step, after the
// step's command event and before its command_result (when it has one).
function oneSweepEach(r, steps, eventName) {
  const all = r.events;
  for (const step of steps) {
    const sweeps = all.filter((e) => isSweep(e) && e.event.name === step);
    assert.equal(sweeps.length, 1, `step ${step} wrote ${sweeps.length} *_sweep events naming it, want exactly one ${JSON.stringify(eventName)}; events ${show(all.map((e) => e.event))}`);
    assert.equal(sweeps[0].event.event, eventName, `step ${step} wrote a ${JSON.stringify(sweeps[0].event.event)} event, want ${JSON.stringify(eventName)}`);
    const at = all.indexOf(sweeps[0]);
    const command = all.findIndex((e) => e.event.event === 'command' && e.event.name === step);
    assert.ok(command >= 0 && command < at, `the ${eventName} event of step ${step} does not follow the step's command event; events ${show(all.map((e) => e.event))}`);
    const result = all.findIndex((e, i) => i > command && e.event.event === 'command_result' && e.event.name === step);
    assert.ok(result < 0 || at < result, `the ${eventName} event of step ${step} comes after the step's command_result; events ${show(all.map((e) => e.event))}`);
  }
}

function timedOut(r, step) {
  const c = r.control[0];
  assert.equal(c.timed_out, true, `the control run of ${JSON.stringify(r.command)} did not time out: ${show(c)}`);
  const st = (r.attempt || []).find((s) => s.name === step);
  assert.ok(st, `the approval attempt recorded no step ${step}: ${show(r.attempt)}`);
  assert.equal(st.status, 'timed_out', `step ${step} is ${st.status}, not timed_out`);
  assert.equal(r.error_reason, 'step_timeout', `the readiness check ended with ${JSON.stringify(r.error_reason)} (${r.error}), not step_timeout`);
}

// In every pass the *_sweep events name exactly these steps in this order, are the named event,
// carry exactly these fields and stopped this many processes.
function quietSweeps(r, steps, eventName, fields, stopped) {
  for (let pass = 1; pass <= r.control.length; pass++) {
    const sweeps = eventsOf(r, pass).filter(isSweep);
    assert.deepEqual(sweeps.map((e) => e.event.name), steps,
      `pass ${pass} wrote *_sweep events for ${show(sweeps.map((e) => e.event.name))}, want one for each of ${show(steps)} in this order; events ${show(eventsOf(r, pass).map((e) => e.event))}`);
    for (const e of sweeps) {
      assert.equal(e.event.event, eventName, `pass ${pass}, step ${e.event.name}: a ${JSON.stringify(e.event.event)} event, want ${JSON.stringify(eventName)}`);
      assert.deepEqual(e.fields, [...fields].sort(), `pass ${pass}, step ${e.event.name}: the ${eventName} event has the fields ${show(e.fields)}, want exactly ${show(fields)}: ${show(e.event)}`);
      assert.equal(e.event.stopped, stopped, `pass ${pass}, step ${e.event.name}: stopped ${e.event.stopped}, want ${stopped}: ${show(e.event)}`);
    }
  }
}

// The median wall time of each named step (its command event to its command_result event) over
// the passes exceeds the median wall time of the control runs by less than limit milliseconds.
function overhead(r, steps, limit) {
  const control = median(r.control.map((c) => c.wall_ms));
  for (const step of steps) {
    const walls = [];
    for (let pass = 1; pass <= r.control.length; pass++) {
      const evs = eventsOf(r, pass);
      const start = evs.find((e) => e.event.event === 'command' && e.event.name === step);
      const end = evs.find((e) => e.event.event === 'command_result' && e.event.name === step);
      assert.ok(start && end, `pass ${pass}: step ${step} has no command and command_result events`);
      walls.push(end.at_ms - start.at_ms);
    }
    const extra = median(walls) - control;
    assert.ok(extra < limit, `step ${step} took a median ${median(walls)} ms over ${walls.length} passes (${show(walls)}), ${extra} ms more than the control run's median ${control} ms; want under ${limit} ms`);
  }
}

module.exports = { serversStoppedAfterEachStep, serversStoppedAfterRun, bystanderRunning, sameAsControl, oneSweepEach, timedOut, quietSweeps, overhead };

if (require.main === module) {
  const server = 'sleep 301';
  const command = "sh -c '(setsid sleep 301 &) ; echo ok'";
  const ev = (pass, at, event) => ({ pass, at_ms: at, fields: Object.keys(event).sort(), bytes: JSON.stringify(event).length, event });
  // step lists one step's events as the driver records them: command, step_sweep, command_result.
  const step = (pass, at, name, o = {}) => {
    const out = [ev(pass, at, { event: 'command', name, command })];
    out.push(ev(pass, at + (o.wall ?? 30), { event: 'step_sweep', name, stopped: o.stopped ?? 0, ms: o.ms ?? 20 }));
    if (o.result !== false) out.push(ev(pass, at + (o.wall ?? 30), { event: 'command_result', name, status: o.status ?? 0, output: o.output ?? 'ok\n' }));
    return out;
  };
  const control = (o = {}) => ({ wall_ms: 1013, status: 0, output: 'ok\n', timed_out: false, servers: 1, ...o });
  const good = {
    verify: {
      mode: 'verify', command, server, control: [control()], bystander: 'running', final_servers: 0,
      at_result: { 'setup-1': 0, acceptance: 0, check: 0 },
      events: [...step(1, 1000, 'setup-1', { wall: 1132, stopped: 1, ms: 117 }), ...step(1, 2500, 'acceptance', { wall: 63, ms: 30 }),
        ...step(1, 3000, 'check', { wall: 1146, stopped: 1, ms: 106 })],
    },
    readiness: {
      mode: 'readiness', command, server, control: [control()], bystander: 'running', final_servers: 0,
      at_result: { 'setup-1': 0 }, events: step(0, 1000, 'setup-1', { wall: 1105, stopped: 1, ms: 93 }),
      attempt: ['snapshot', 'materialize', 'setup-1', 'acceptance', 'step-analysis'].map((name) => ({ name, status: 'passed' })),
    },
    timeout: {
      mode: 'timeout', command: command.replace("echo ok'", "echo ok; sleep 30'"), server, bystander: 'running', final_servers: 0,
      control: [control({ wall_ms: 3004, status: 143, timed_out: true })], at_result: {},
      events: step(0, 1000, 'setup-1', { wall: 3109, stopped: 1, ms: 106, result: false }),
      attempt: [{ name: 'snapshot', status: 'passed' }, { name: 'materialize', status: 'passed' }, { name: 'setup-1', status: 'timed_out' }],
      error: 'step setup-1 timed out', error_reason: 'step_timeout',
    },
    quiet: {
      mode: 'quiet', command: 'echo ok', server: '', control: [control({ wall_ms: 4, servers: undefined }), control({ wall_ms: 3, servers: undefined }), control({ wall_ms: 4, servers: undefined })],
      at_result: {},
      events: [1, 2, 3].flatMap((pass) => [...step(pass, pass * 1000, 'setup-1', { wall: 26 }), ...step(pass, pass * 1000 + 30, 'acceptance', { wall: 45 }),
        ...step(pass, pass * 1000 + 80, 'check', { wall: 34 })]),
    },
  };
  const judge = {
    verify: (r) => {
      serversStoppedAfterEachStep(r, ['setup-1', 'check'], server);
      bystanderRunning(r, 'sleep 302');
      sameAsControl(r, ['setup-1', 'check'], 0, 'ok\n');
      oneSweepEach(r, ['setup-1', 'acceptance', 'check'], 'step_sweep');
    },
    readiness: (r) => {
      serversStoppedAfterEachStep(r, ['setup-1'], server);
      bystanderRunning(r, 'sleep 302');
      sameAsControl(r, ['setup-1'], 0, 'ok\n');
      oneSweepEach(r, ['setup-1'], 'step_sweep');
    },
    timeout: (r) => {
      timedOut(r, 'setup-1');
      serversStoppedAfterRun(r, server);
      bystanderRunning(r, 'sleep 302');
      oneSweepEach(r, ['setup-1'], 'step_sweep');
    },
    quiet: (r) => {
      quietSweeps(r, ['setup-1', 'acceptance', 'check'], 'step_sweep', ['event', 'ms', 'name', 'stopped'], 0);
      overhead(r, ['setup-1', 'check'], 200);
    },
  };
  const swept = (r, name) => r.events.find((e) => isSweep(e) && e.event.name === name);
  // Each known-bad report changes one thing of a known-good one.
  const bad = {
    'a server survives the setup step (today)': ['verify', (r) => { r.at_result['setup-1'] = 1; }],
    'a server survives the check step': ['verify', (r) => { r.at_result.check = 1; }],
    'a server survives the run': ['verify', (r) => { r.final_servers = 1; }],
    'the control run left no server': ['verify', (r) => { r.control[0].servers = 0; }],
    'the process listing failed': ['readiness', (r) => { r.ps_error = 'ps -axo pid=,stat=,args=: exit status 1'; }],
    'the bystander was stopped': ['verify', (r) => { r.bystander = 'stopped'; }],
    'a step printed something else': ['verify', (r) => { r.events.find((e) => e.event.event === 'command_result' && e.event.name === 'check').event.output = 'ok\nswept 1\n'; }],
    'a step exited otherwise': ['readiness', (r) => { r.events.find((e) => e.event.event === 'command_result').event.status = 143; }],
    'the check step wrote no sweep event': ['verify', (r) => { r.events = r.events.filter((e) => e !== swept(r, 'check')); }],
    'the setup step wrote two sweep events': ['readiness', (r) => { r.events.splice(1, 0, ev(0, 1100, { event: 'setup_sweep', name: 'setup-1', stopped: 0, ms: 1 })); }],
    'the sweep event comes after the result': ['readiness', (r) => { r.events.push(r.events.splice(1, 1)[0]); }],
    'the sweep event has another name': ['verify', (r) => { swept(r, 'acceptance').event.event = 'acceptance_sweep'; }],
    'the timed-out step is not swept': ['timeout', (r) => { r.final_servers = 1; }],
    'the step did not time out': ['timeout', (r) => { r.attempt[2].status = 'failed'; }],
    'the timed-out step wrote no sweep event': ['timeout', (r) => { r.events = r.events.filter((e) => !isSweep(e)); }],
    'a quiet sweep event lists more fields': ['quiet', (r) => { const e = swept(r, 'check'); e.event.pids = []; e.fields = Object.keys(e.event).sort(); }],
    'a quiet sweep stopped a process': ['quiet', (r) => { swept(r, 'setup-1').event.stopped = 1; }],
    'a quiet pass swept the steps in another order': ['quiet', (r) => { const evs = r.events.filter((e) => e.pass === 2 && isSweep(e)); [evs[0].event.name, evs[1].event.name] = [evs[1].event.name, evs[0].event.name]; }],
    'a step took 200 ms longer than the control': ['quiet', (r) => { for (const e of r.events) if (e.event.event === 'command_result' && e.event.name === 'check') e.at_ms += 200; }],
  };
  const mode = process.argv[2];
  if (mode === 'good') {
    for (const [name, r] of Object.entries(good)) {
      try {
        judge[name](structuredClone(r));
      } catch (e) {
        console.log(`observer rejected known-good report ${name}: ${e.message}`);
        process.exit(1);
      }
    }
    console.log('observer accepted');
  } else if (mode === 'bad') {
    for (const [what, [name, spoil]] of Object.entries(bad)) {
      const r = structuredClone(good[name]);
      spoil(r);
      try {
        judge[name](r);
      } catch {
        continue;
      }
      console.log(`observer accepted known-bad report: ${what}`);
      process.exit(0);
    }
    console.log('observer rejected every known-bad report');
    process.exit(1);
  } else {
    console.log('usage: node features/steps/sweep_steps_observer.js good|bad');
    process.exit(2);
  }
}
