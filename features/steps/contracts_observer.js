const fs = require('node:fs');
function observe(text) {
  const events = text.trim().split('\n').map(line => JSON.parse(line));
  const tests = events.filter(e => e.Test && !e.Test.includes('/') && e.Action === 'pass');
  if (!tests.length || events.some(e => ['fail', 'skip'].includes(e.Action)) || !events.some(e => !e.Test && e.Action === 'pass')) throw new Error('expected executed passing tests and a passing package, with no failures or skips');
}
module.exports = observe;
if (require.main === module) {
  try { observe(fs.readFileSync(0, 'utf8')); console.log('accepted'); }
  catch (_) { console.log('rejected'); process.exitCode = 1; }
}
