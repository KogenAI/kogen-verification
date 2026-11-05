'use strict';
// Judges the report of TestSpecUpdateNoticeDriver (see the __driver.js file). Expected keys are
// dotted paths into the report, compared as JSON values (object key order is ignored, array
// order is kept). Derived keys: resultsNotices and feedbackNotices are the lines of the
// reviewer material and of the feedback that start with "specs not updated:", in order;
// errorIncludes is a text the error returned by Verify must contain, and feedbackIncludes a
// text the feedback must contain. Loading this file defines no steps and does no work.
const assert = require('node:assert/strict');

const NOTICE = 'specs not updated:';
const notices = (text) => String(text ?? '').split('\n').filter((line) => line.startsWith(NOTICE));

function observe(got, expected) {
  const derived = { ...got, resultsNotices: notices(got.results), feedbackNotices: notices(got.feedback) };
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'errorIncludes') {
      assert.ok(String(got.error ?? '').includes(value), `error ${JSON.stringify(got.error)} does not include ${JSON.stringify(value)}`);
      continue;
    }
    if (key === 'feedbackIncludes') {
      assert.ok(String(got.feedback ?? '').includes(value), `feedback does not include ${JSON.stringify(value)}:\n${got.feedback}`);
      continue;
    }
    const actual = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), derived);
    assert.deepEqual(actual, value, `${key}: got ${JSON.stringify(actual)}, want ${JSON.stringify(value)}`);
  }
}

module.exports = observe;

if (require.main === module) {
  const line = 'specs not updated: implementation files changed: 1 (src/a.go); maintained specifications unchanged: spec/model.qnt, spec/features/a.feature';
  const record = {
    implementation_changed_count: 1, implementation_changed: ['src/a.go'], specs_changed_count: 0, specs_changed: [],
    specs_unchanged: ['spec/model.qnt', 'spec/features/a.feature'], specs_not_updated: true,
  };
  const got = {
    declarable: true, error: '', green: true, failing: [], record: { green: true, spec_update: { ...record } },
    results: `acceptance: passed (2 scenarios)\nmodel: not applicable\ncheck lint: passed\n${line}`,
    feedback: `Verification pass 1 is not green. Fix the implementation (the approved acceptance files cannot change), then call finish again.\n${line}`,
  };
  // The known-bad report is right everywhere except that the reviewer material repeats the line.
  if (process.argv[2] === 'bad') got.results += `\n${line}`;
  try {
    observe(got, { declarable: true, error: '', green: true, failing: [], 'record.spec_update': record, resultsNotices: [line], feedbackNotices: [line] });
    console.log('accepted');
  } catch {
    console.log('rejected');
    process.exitCode = 1;
  }
}
