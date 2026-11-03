'use strict';
const assert = require('node:assert/strict');
function observe(v, mode, marker) {
 const text=v.text, r=v.record, st=r.steps.find(s=>s.name==='acceptance');
 assert.ok(st, 'acceptance step retained');
 assert.equal(v.reason,'step_timeout'); assert.equal(v.exit,3);
 assert.equal(st.status,'timed_out'); assert.equal(st.timed_out,true);
 assert.deepEqual(r.not_run,['check: later']);
 for(const s of ['Steps that ran, with wall time','acceptance: timed out','Not run: check: later','does not establish the cause','Evidence: ']) assert.ok(text.includes(s),s);
 if(mode==='unknown') {
  assert.ok(text.toLowerCase().includes('its output could not be read'));
  assert.ok(!text.includes('wrote no output'));
  assert.equal(st.output_unavailable,true);
  assert.ok(!Object.hasOwn(st,'exit'));
 } else if(marker) {
  assert.ok(text.includes(marker)); assert.ok(st.output.includes(marker));
  assert.notEqual(st.output_unavailable,true);
 } else {
  assert.ok(text.includes('It wrote no output before it was stopped.'));
  assert.ok(!st.output); assert.notEqual(st.output_unavailable,true);
 }
}
module.exports=observe;
if(require.main===module) {
 const base='Steps that ran, with wall time\nacceptance: timed out\nNot run: check: later\ndoes not establish the cause\nEvidence: /fixture';
 const make=(text,st)=>({text:base+'\n'+text,reason:'step_timeout',exit:3,record:{not_run:['check: later'],steps:[{name:'acceptance',status:'timed_out',timed_out:true,...st}]}});
 try {
  observe(make('partial-marker',{output:'partial-marker'}),'normal','partial-marker');
  observe(make('It wrote no output before it was stopped.',{}),'normal','');
  observe(make('Its output could not be read.',{output_unavailable:process.argv[2]!=='bad'}),'unknown','partial-marker');
  console.log('observer accepted');
 } catch(e) {console.log('observer rejected'); process.exitCode=1;}
}
