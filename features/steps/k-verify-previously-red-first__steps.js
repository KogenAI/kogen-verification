const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
function observe(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'execution_order' || key === 'pulled_forward') assert.deepEqual(actual.record[key], value, key);
    else assert.deepEqual(actual[key], value, key);
  }
}
if (require.main === module) {
  const good = {trace:['C','A','B'],green:true,complete:true,failing:[],checks:['C','A','B'],record:{execution_order:['acceptance','C','A','B'],pulled_forward:['C']}};
  const expected = {trace:['C','A','B'],green:true,complete:true,failing:[],checks:['C','A','B'],execution_order:['acceptance','C','A','B'],pulled_forward:['C']};
  if (process.argv[2] === 'bad') good.record.pulled_forward=[];
  try { observe(good,expected); console.log('observer accepted'); } catch { console.log('observer rejected'); process.exitCode=1; }
} else {
  const {When, Then} = require('@cucumber/cucumber');
  When('k-verify-previously-red-first: I verify the {string} stub candidate', function(mode) {
    const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'previous-red-'));
    try {
      const source=path.join(tmp,'driver_test.go');
      fs.writeFileSync(source,require('./k-verify-previously-red-first__driver.js'));
      const overlay=path.join(tmp,'overlay.json');
      fs.writeFileSync(overlay,JSON.stringify({Replace:{[path.resolve('verify/previous_red_acceptance_test.go')]:source}}));
      const report=path.join(tmp,'result.json');
      const r=cp.spawnSync('go',['test','-overlay',overlay,'./verify','-run','^TestPreviousRedAcceptanceDriver$','-count=1'],{encoding:'utf8',timeout:120000,env:{...process.env,PREVIOUS_RED_CASE:mode,PREVIOUS_RED_REPORT:report}});
      assert.equal(r.status,0,`TestPreviousRedAcceptanceDriver: go test -overlay ${overlay} ./verify -run ^TestPreviousRedAcceptanceDriver$ -count=1; outcome ${r.status}\n${r.stdout}${r.stderr}`);
      assert.ok(fs.existsSync(report),'TestPreviousRedAcceptanceDriver did not write its behavioral report');
      this.previousRed=JSON.parse(fs.readFileSync(report,'utf8'));
    } finally {fs.rmSync(tmp,{recursive:true,force:true});}
  });
  Then('k-verify-previously-red-first: the result is', function(doc) {observe(this.previousRed,JSON.parse(doc));});
  Then('k-verify-previously-red-first: the still-red pass saves the earlier stub wall', function() {
    // A and B have 1.2 seconds of mandatory sleeps; C has 0.05 seconds.
    // Observe the same real route without priority, not a guessed process-time ceiling.
    this.previousRedFast=this.previousRed.elapsed;
  });
  Then('k-verify-previously-red-first: the control takes at least {float} seconds longer', function(delta) {
    assert.ok(this.previousRed.elapsed-this.previousRedFast>=delta,`wall saving: fast=${this.previousRedFast}, control=${this.previousRed.elapsed}, required=${delta}`);
  });
}
