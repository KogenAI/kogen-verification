const { When, Then } = require('@cucumber/cucumber');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const observe = require('./maintained_observer');
When('ordinary verification receives the {string} maintained model list', function(mode) {
 const tmp = fs.mkdtempSync(path.join(os.tmpdir(),'maintained-acceptance-'));
 try {
  const root = path.join(tmp,'repo');
  fs.cpSync(process.cwd(),root,{recursive:true,filter:p => !['.git','node_modules'].includes(path.basename(p))});
  fs.copyFileSync(path.join(root,'features/steps/testdata/maintained/driver.go'),path.join(root,'verify/maintained_acceptance_test.go'));
  const output = path.join(tmp,'result.json');
  const r = spawnSync('go',['test','./verify','-run','^TestMaintainedAcceptanceDriver$','-count=1'],{cwd:root,env:{...process.env,MAINTAINED_MODE:mode,MAINTAINED_RESULT:output},encoding:'utf8',timeout:90000});
  assert.equal(r.status,0,`go test ./verify -run ^TestMaintainedAcceptanceDriver$ -count=1: ${r.error || ''}\n${r.stdout}${r.stderr}`);
  assert.ok(fs.existsSync(output),'TestMaintainedAcceptanceDriver must run and write its result: go test ./verify -run ^TestMaintainedAcceptanceDriver$ -count=1; result absent (test absent, skipped or zero runs)');
  this.maintained = JSON.parse(fs.readFileSync(output,'utf8'));
 } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});
Then('maintained verification has green {word}, checks {int}, cause {string} and Quint calls:', function(green,checks,cause,calls) {
 observe(this.maintained,{green:green === 'true',checks,cause,calls:calls+'\n'});
});
