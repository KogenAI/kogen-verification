const assert = require('node:assert/strict');
function observe(got, expected) {
  assert.equal(got.green, expected.green, 'verification green');
  assert.equal(got.calls, expected.calls, 'exact Quint invocations and recorded parameters');
  assert.equal(got.checks, expected.checks, 'later configured checks');
  if (expected.cause) {
    assert.ok(got.failing.some(x => x.includes(expected.cause)), 'failing cause names ' + expected.cause);
    assert.ok(got.feedback.includes(expected.cause), 'feedback names ' + expected.cause);
  } else assert.deepEqual(got.failing, []);
}
module.exports = observe;
if (require.main === module) {
  const expected = {green:false,calls:'quint typecheck broken.qnt\n',checks:0,cause:'broken.qnt'};
  const got = {green:false,calls:expected.calls,checks:0,failing:['broken.qnt'],feedback:'broken.qnt: failed'};
  if (process.argv[2] === 'bad') got.feedback = 'model.qnt: failed';
  try { observe(got, expected); console.log('accepted'); }
  catch (_) { console.log('rejected'); process.exitCode = 1; }
}
