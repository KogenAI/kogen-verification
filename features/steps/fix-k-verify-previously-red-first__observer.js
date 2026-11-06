'use strict';
// Judges the report of TestFixPreviouslyRedFirstReloadDriver (see the __driver.js file): every
// expected key must equal the reported value as JSON (object key order is ignored, array order
// is kept). Loading this file defines no steps and does no work.
const assert = require('node:assert/strict');

function observe(got, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(got[key], value, `case ${got.mode}: ${key}: got ${JSON.stringify(got[key])}, want ${JSON.stringify(value)}`);
  }
}

module.exports = observe;

if (require.main === module) {
  // Known-good: the fixed dependency-ordered pass. Known-bad: the same case as the unfixed tree
  // reported it, complete in memory but rejected after its record was reloaded.
  const good = { mode: 'dependency-ordered', green: true, trace: ['B', 'A'], checks: ['B=0', 'A=0'], complete: true, record_dependency_reordered: true, reloaded_complete: true, rerecorded_identical: true, swapped_reloaded_complete: true };
  const bad = { mode: 'dependency-ordered', green: true, trace: ['B', 'A'], checks: ['B=0', 'A=0'], complete: true, record_dependency_reordered: 'absent', reloaded_complete: false, rerecorded_identical: true, swapped_reloaded_complete: true };
  try {
    observe(process.argv[2] === 'bad' ? bad : good, { green: true, trace: ['B', 'A'], checks: ['B=0', 'A=0'], complete: true, record_dependency_reordered: true, reloaded_complete: true, rerecorded_identical: true });
    console.log('accepted');
  } catch {
    console.log('rejected');
    process.exitCode = 1;
  }
}
