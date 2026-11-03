'use strict';
const assert = require('node:assert/strict');
function observe(r, mode) {
 assert.equal(r.records.length,1,'one retained attempt');
 assert.equal(r.private,true,'private evidence permissions');
 const a=r.records[0];
 assert.equal(a.kind,'approval_attempt');
 assert.equal(a.outcome,mode==='passed'?'passed':'refused');
 assert.deepEqual(a.steps.map(s=>s.name),r.executed,'retain every executed step, in order (including step-analysis when configured)');
 for (const name of ['snapshot','materialize','setup-1']) assert.ok(r.executed.includes(name),`executed ${name}`);
 if(mode==='passed') assert.ok(r.executed.includes('acceptance'),'executed acceptance');
 for(const s of a.steps) {
  const start=Date.parse(s.started_at), end=Date.parse(s.ended_at);
  assert.ok(Number.isFinite(start)&&Number.isFinite(end),`${s.name}: absolute instants`);
  assert.ok(start>=Date.parse(r.began)&&end<=Date.parse(r.ended)&&end>=start,`${s.name}: instants bracket execution`);
  assert.ok(Math.abs(end-start-s.duration_ms)<=5,`${s.name}: wall agrees with instants`);
  for(const key of ['load_start','load_end']) {
   const l=s[key];
   assert.ok(l && Number.isFinite(l.load1)&&Number.isFinite(l.load5)&&l.load1>=0&&l.load5>=0,`${s.name}: real supported-host ${key}`);
  }
 }
 if(mode==='timeout') {
  assert.equal(a.failure.reason,'step_timeout');
  assert.equal(a.failure.class,'environment');
  assert.equal(a.steps.at(-1).timed_out,true);
  assert.ok(/host load/i.test(r.text),'timeout reports host load');
  for(const l of [a.steps.at(-1).load_start,a.steps.at(-1).load_end]) {
   for(const n of [l.load1,l.load5]) assert.ok(r.text.includes(n.toFixed(2)),'render measured load to two decimals');
  }
  assert.ok(/does not establish the cause/i.test(r.text),'no causal attribution');
 }
}
module.exports=observe;
if(require.main===module) {
 const s={name:'snapshot',started_at:'2026-11-03T00:00:00.000Z',ended_at:'2026-11-03T00:00:00.010Z',duration_ms:10,load_start:{load1:16,load5:31},load_end:{load1:17,load5:30}};
 function fixture(mode) {
  const names=mode==='passed'?['snapshot','materialize','setup-1','acceptance','step-analysis']:['snapshot','materialize','setup-1'];
  const steps=names.map(name=>({...s,name}));
  if(mode==='timeout') steps.at(-1).timed_out=true;
  return {records:[{kind:'approval_attempt',outcome:mode==='passed'?'passed':'refused',steps,failure:{class:'environment',reason:'step_timeout'}}],executed:names,private:true,began:s.started_at,ended:s.ended_at,text:'Host load start 16.00 31.00 end 17.00 30.00; this does not establish the cause'};
 }
 if(process.argv[2]==='good') {
  for(const mode of ['passed','failed','timeout']) observe(fixture(mode),mode);
  console.log('observer accepted');
 } else {
  const cases=[['passed',r=>{delete r.records[0].steps.at(-1).load_end;}],['passed',r=>{r.records[0].steps.pop();}],['timeout',r=>{r.text='Host load 16.00 31.00 17.00 30.00';}]];
  for(const [mode,mutate] of cases) {
   const r=fixture(mode); mutate(r);
   let rejected=false; try {observe(r,mode);} catch(e){rejected=true;}
   if(!rejected) throw new Error('observer accepted known-bad control');
  }
  console.log('observer rejected'); process.exitCode=1;
 }
}
