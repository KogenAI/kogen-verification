const {When,Then}=require('@cucumber/cucumber');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');
const observe=require('./uncovered_observer.cjs');
When('an acceptance coverage pass uses {string}',function(mode){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'uc-'));
 try{
 const root=path.join(tmp,'repo');fs.cpSync(process.cwd(),root,{recursive:true,filter:p=>!['.git','node_modules'].includes(path.basename(p))});
 fs.copyFileSync(path.join(root,'features/steps/testdata/uncovered/driver.go'),path.join(root,'verify/uncovered_acceptance_test.go'));
 const out=path.join(tmp,'result.json');const cmd='go test ./verify -run ^TestUncoveredAcceptanceDriver$ -count=1';
 const r=spawnSync('go',['test','./verify','-run','^TestUncoveredAcceptanceDriver$','-count=1'],{cwd:root,env:{...process.env,UC_MODE:mode,UC_RESULT:out},encoding:'utf8',timeout:120000});
 assert.equal(r.status,0,`TestUncoveredAcceptanceDriver: ${cmd}: ${r.error||''}\n${r.stdout}${r.stderr}`);
 assert.ok(fs.existsSync(out),`TestUncoveredAcceptanceDriver: ${cmd}: absent, skipped or zero runs; no result`);
 this.uc=JSON.parse(fs.readFileSync(out,'utf8'));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
Then('acceptance coverage observations are:',function(text){observe(this.uc,JSON.parse(text));});
