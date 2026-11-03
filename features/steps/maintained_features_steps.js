const {When,Then}=require('@cucumber/cucumber');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const observe=require('./maintained_features_observer.cjs');
When('a verification pass receives the {string} maintained feature list',function(mode){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mf-'));
 try{
  const root=path.join(tmp,'repo');
  fs.cpSync(process.cwd(),root,{recursive:true,filter:p=>!['.git','node_modules'].includes(path.basename(p))});
  fs.copyFileSync(path.join(root,'features/steps/testdata/maintainedfeatures/driver.go'),path.join(root,'verify/mf_acceptance_test.go'));
  const output=path.join(tmp,'result.json');
  const r=spawnSync('go',['test','./verify','-run','^TestMaintainedFeaturesDriver$','-count=1'],{cwd:root,env:{...process.env,MF_MODE:mode,MF_RESULT:output},encoding:'utf8',timeout:120000});
  assert.equal(r.status,0,`TestMaintainedFeaturesDriver: go test ./verify -run ^TestMaintainedFeaturesDriver$ -count=1: ${r.error||''}\n${r.stdout}${r.stderr}`);
  assert.ok(fs.existsSync(output),'TestMaintainedFeaturesDriver: go test ./verify -run ^TestMaintainedFeaturesDriver$ -count=1: absent, skipped or zero runs; result missing');
  this.mf=JSON.parse(fs.readFileSync(output,'utf8'));
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
Then('the maintained feature observations equal:',function(text){observe(this.mf,JSON.parse(text));});
Then('maintained feature feedback contains {string}',function(text){assert.ok(this.mf.feedback.includes(text),`feedback missing ${text}: ${this.mf.feedback}`);});
