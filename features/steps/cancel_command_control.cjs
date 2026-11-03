'use strict';
const assert = require('node:assert/strict');
const h = require('./cancel_command_harness.cjs');
const polarity = process.argv[2];
try {
  if (polarity === 'bad') {
    const data = h.drive('ordinary', 'running', 'bad');
    try { h.observe(data, { error: 'canceled', second: false, live: 0, bystander: true }); }
    catch { console.log('rejected'); process.exitCode = 1; }
    if (!process.exitCode) throw new Error('bad command was accepted');
  } else {
    assert.equal(polarity, 'good');
    for (const route of ['probe', 'ordinary', 'approval']) {
      for (const mode of ['running', 'before', 'enter', 'starting', 'started', 'success', 'nonzero', 'interrupt-before', 'interrupt-running', ...(route === 'ordinary' ? [] : ['timeout'])]) {
        const data = h.drive(route, mode, 'good');
        const expected = { live: 0, bystander: true, second: false, probe_limit_seconds: 300, approval_limit_seconds: 120, handoff: ['enter', 'starting', 'started'].includes(mode) ? 1 : 0 };
        if (mode.startsWith('interrupt')) expected.error = 'SIGINT';
        else if (mode === 'success' || mode === 'nonzero') Object.assign(expected, { error: 'none', status: mode === 'success' ? 0 : 7, output: 'original\n', timed_out: false });
        else if (mode === 'timeout') expected.timed_out = true;
        else Object.assign(expected, { error: 'canceled', status: 0, output: '', timed_out: false });
        if (mode === 'running' || mode === 'interrupt-running') expected.ready = true;
        if (mode === 'before' || mode === 'enter' || mode === 'interrupt-before') expected.ready = false;
        h.observe(data, expected);
        // Reach each observer predicate independently: a preceding red cannot mask it.
        for (const key of Object.keys(expected)) {
          const bad = { ...data, [key]: typeof expected[key] === 'boolean' ? !expected[key] : typeof expected[key] === 'number' ? expected[key] + 1 : expected[key] + '-wrong' };
          assert.throws(() => h.observe(bad, expected), `${route}/${mode}: observer accepted wrong ${key}`);
        }
      }
    }
    console.log('qualified');
  }
} finally { h.cleanup(); }
