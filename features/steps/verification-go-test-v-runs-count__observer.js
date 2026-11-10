const assert = require('node:assert/strict');
function check(actual, expected) { assert.deepStrictEqual(actual, expected); }
module.exports = check;
if (require.main === module) {
 const expected = {seen:true,block:'',unwritten:null};
 const actual = process.argv[2] === 'good' ? expected : {...expected,seen:false};
 try { check(actual,expected); console.log('accepted'); } catch (_) { console.log('rejected'); process.exitCode=1; }
}
