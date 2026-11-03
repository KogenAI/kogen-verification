'use strict';
const assert = require('node:assert/strict');
module.exports = function observe(actual, expected) {
  const calls = expected.names === null ? [] : [ ['typecheck', 'model.qnt'], ...expected.names.map(n => ['run','model.qnt','--backend','typescript','--invariant',n,'--seed','17','--max-samples','1','--max-steps','1']) ];
  assert.deepEqual(actual.calls, calls);
  assert.equal(actual.state, expected.state);
  const problems = actual.problems || [];
  assert.equal(problems.length, expected.problem ? 1 : 0);
  if (expected.problem) {
    assert.match(problems[0], new RegExp(expected.problem));
    assert.equal(problems[0].trim().split('\n').length, expected.lines);
  }
};
