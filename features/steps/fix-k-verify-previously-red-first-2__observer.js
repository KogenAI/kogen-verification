'use strict';
// Judges the report of TestFixPreviouslyRedFirst2Driver (see the __driver.js file): every
// expected key must equal the reported value as JSON (object key order is ignored, array order
// is kept; null is not []). Loading this file defines no steps and does no work.
const assert = require('node:assert/strict');

function observe(got, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(got[key], value, `case ${got.mode}: ${key}: got ${JSON.stringify(got[key])}, want ${JSON.stringify(value)}`);
  }
}

module.exports = observe;

if (require.main === module) {
  // Known-good: the fixed cycle pass. Known-bad: the same case as the unfixed tree reported it,
  // with A and B silently dropped from a green pass.
  const good = { mode: 'cycle', green: false, checks: ['C=0', 'A=0', 'B=3'], speculative: [], cancelled: [], not_run: [], failing: ['B'], trace: ['C', 'A', 'B'] };
  const bad = { mode: 'cycle', green: true, checks: ['C=0'], speculative: [], cancelled: [], not_run: [], failing: [], trace: ['C'] };
  try {
    observe(process.argv[2] === 'bad' ? bad : good, { trace: ['C', 'A', 'B'], checks: ['C=0', 'A=0', 'B=3'], green: false, failing: ['B'], not_run: [] });
    console.log('accepted');
  } catch {
    console.log('rejected');
    process.exitCode = 1;
  }
}
