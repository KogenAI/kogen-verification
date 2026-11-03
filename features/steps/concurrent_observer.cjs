'use strict';
const assert = require('node:assert/strict');
function observe(r, e) {
  assert.equal(r.bystander_alive, true, 'unrelated caller-session command must survive');
  assert.equal(r.child_alive, false, 'cancelled check must leave no live child');
  const p = r.pass;
  assert.equal(p.green, e.green, 'pass green');
  assert.deepEqual(p.failing, e.failing, 'ordered stopping failure');
  assert.deepEqual(p.not_run, e.not_run, 'never started only');
  assert.deepEqual(p.checks.map(c => [c.name,c.status,c.output]), e.checks, 'ordered authoritative checks and exact outputs');
  const speculative = p.speculative || [];
  assert.deepEqual(speculative.map(c => [c.name,c.status,c.output]), e.speculative, 'completed speculative evidence');
  const cancelled = p.cancelled || [];
  assert.deepEqual(cancelled.map(c => c.name), e.cancelled, 'cancelled work separate from not run');
  if (e.partial) assert.ok(cancelled[0].output.includes(e.partial), 'preserve cancelled output');
  assert.equal(r.build_started,e.build_started,'compile launch');
  assert.equal(r.vet_started,e.vet_started,'vet launch');
  if (e.failing.length) {
    assert.ok(r.feedback.includes('check '+e.failing[0]+' ('), 'repair feedback includes stopping check');
  }
  if (e.speculative.length) {
    const label = 'Speculative results';
    const i = r.feedback.indexOf(label);
    assert.ok(i >= 0, 'separate labelled speculative-results section');
    assert.ok(!r.feedback.slice(0,i).includes('check vet ('), 'later failure is not a repair request');
    assert.ok(r.feedback.slice(i).includes('vet-output'), 'retain speculative output');
  }
  if (e.cancelled.length) assert.ok(r.feedback.includes('Cancelled work'), 'label cancelled work');
}
module.exports = {observe};
if (require.main === module) {
  const base = {pass:{green:false,failing:['compile'],not_run:['tail'],checks:[{name:'compile',status:17,output:'build-output\n'}],speculative:[{name:'vet',status:19,output:'vet-output\n'}]},feedback:'check compile (go build ./...): failed\nSpeculative results\ncheck vet (go vet ./...): failed\nvet-output',build_started:true,vet_started:true,child_alive:false,bystander_alive:true};
  const expected = {green:false,failing:['compile'],not_run:['tail'],checks:[['compile',17,'build-output\n']],speculative:[['vet',19,'vet-output\n']],cancelled:[],build_started:true,vet_started:true};
  const canceled = structuredClone(base);
  canceled.pass.speculative=[];
  canceled.pass.cancelled=[{name:'vet',status:-1,output:'vet-partial\n'}];
  canceled.feedback='check compile (go build ./...): failed\nCancelled work\nvet';
  const cancelExpected={...expected,speculative:[],cancelled:['vet'],partial:'vet-partial'};
  try {
    observe(base,expected);
    observe(canceled,cancelExpected);
    if(process.argv[2]==='bad') {
      // Each mutation starts from an independently accepted report; no early
      // assertion can mask the deeper speculation/cancellation observations.
      const cases=[
        [base,expected,r=>{r.bystander_alive=false;}],
        [base,expected,r=>{r.child_alive=true;}],
        [base,expected,r=>{r.pass.green=true;}],
        [base,expected,r=>{r.pass.failing=['vet'];}],
        [base,expected,r=>{r.pass.not_run=['vet','tail'];}],
        [base,expected,r=>{r.pass.checks[0].output='wrong';}],
        [base,expected,r=>{r.pass.speculative=[];}],
        [base,expected,r=>{r.build_started=false;}],
        [base,expected,r=>{r.vet_started=false;}],
        [base,expected,r=>{r.feedback='Speculative results\nvet-output';}],
        [base,expected,r=>{r.feedback=r.feedback.replace('Speculative results','later');}],
        [base,expected,r=>{r.feedback='check compile (x)\ncheck vet (x)\nSpeculative results\nvet-output';}],
        [base,expected,r=>{r.feedback=r.feedback.replace('vet-output','');}],
        [canceled,cancelExpected,r=>{r.pass.cancelled=[];}],
        [canceled,cancelExpected,r=>{r.pass.cancelled[0].output='';}],
        [canceled,cancelExpected,r=>{r.feedback='check compile (x)';}]
      ];
      for(const [r,e,mutate] of cases) {
        const bad=structuredClone(r); mutate(bad);
        let rejected=false; try {observe(bad,e);} catch (_) {rejected=true;}
        assert.ok(rejected,'observer must reject each independent broken report');
      }
      console.log('observer rejected'); process.exitCode=1;
    } else console.log('observer accepted');
  } catch (err) { console.error(err.message); process.exitCode=2; }
}
