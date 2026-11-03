'use strict';
const {When,Then}=require('@cucumber/cucumber');
const fs=require('node:fs'), os=require('node:os'), path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const observe=require('./hostload_observer');
When('an approval readiness attempt is {string}',{timeout:240000},function(mode){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'hostload-'));
 try {
  const root=path.join(tmp,'repo');
  fs.cpSync(process.cwd(),root,{recursive:true,filter:p=>!['.git','node_modules','.kogen'].includes(path.basename(p))});
  fs.copyFileSync(path.join(root,'features/steps/testdata/hostload/driver.go'),path.join(root,'verify/hostload_acceptance_test.go'));
  const output=path.join(tmp,'result.json');
  const cmd='go test ./verify -run ^TestHostLoadAcceptanceDriver$ -count=1';
  const r=spawnSync('go',['test','./verify','-run','^TestHostLoadAcceptanceDriver$','-count=1'],{cwd:root,env:{...process.env,HOSTLOAD_MODE:mode,HOSTLOAD_RESULT:output},encoding:'utf8',timeout:210000});
  assert.ok(fs.existsSync(output),`${cmd}: TestHostLoadAcceptanceDriver did not produce result (absent, skipped, zero runs or failed): exit ${r.status}; ${r.error||''}\n${r.stdout}${r.stderr}`);
  this.hostload=JSON.parse(fs.readFileSync(output,'utf8')); this.hostloadMode=mode;
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
Then('every executed step has retained host measurements',function(){observe(this.hostload,this.hostloadMode);});
