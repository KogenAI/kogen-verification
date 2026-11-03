'use strict';
const {When,Then}=require('@cucumber/cucumber');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const observe=require('./unknown_timeout_observer');
function writable(p) { const s=fs.lstatSync(p); if(s.isSymbolicLink()) return; fs.chmodSync(p,s.mode|0o700); if(s.isDirectory()) for(const n of fs.readdirSync(p)) writable(path.join(p,n)); }
When('acceptance times out with observation {string} and output {string}',{timeout:240000},function(mode,marker){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'unknown-output-'));
 try {
  const root=path.join(tmp,'repo');
  fs.cpSync(process.cwd(),root,{recursive:true,filter:p=>!['.git','node_modules','.kogen'].includes(path.basename(p))});
  fs.copyFileSync(path.join(root,'features/steps/testdata/unknown_timeout/driver.go'),path.join(root,'verify/unknown_output_acceptance_test.go'));
  if(mode==='unknown') {
   const m=spawnSync('go',['list','-m','-f','{{.Dir}}','kogen-loop'],{cwd:root,encoding:'utf8'});
   assert.equal(m.status,0,m.stderr);
   const local=path.join(tmp,'loop');
   fs.cpSync(m.stdout.trim(),local,{recursive:true});
   writable(local);
   const edit=spawnSync('go',['mod','edit',`-replace=kogen-loop=${local}`],{cwd:root,encoding:'utf8'});
   assert.equal(edit.status,0,edit.stderr);
   const original=path.join(local,'sys/timeout_observation_linux.go');
   assert.ok(fs.existsSync(original),'Linux contracted group-observation seam required');
   const replacement=path.join(tmp,'observation.go');
   fs.writeFileSync(replacement,'package sys\nimport "errors"\nfunc timeoutGroupAlive(int) (bool,error) { return false, errors.New("contracted observation failure") }\n');
   fs.writeFileSync(path.join(tmp,'overlay.json'),JSON.stringify({Replace:{[original]:replacement}}));
  }
  const out=path.join(tmp,'result.json');
  const args=['test',...(mode==='unknown'?['-overlay',path.join(tmp,'overlay.json')]:[]),'./verify','-run','^TestUnknownOutputAcceptanceDriver$','-count=1'];
  const r=spawnSync('go',args,{cwd:root,env:{...process.env,UNKNOWN_OUTPUT_RESULT:out,UNKNOWN_OUTPUT_MARKER:marker},encoding:'utf8',timeout:210000});
  assert.ok(fs.existsSync(out),`TestUnknownOutputAcceptanceDriver: go ${args.join(' ')} absent, skipped, zero runs or failed; exit ${r.status}: ${r.error||''}\n${r.stdout}${r.stderr}`);
  assert.equal(r.status,0,`TestUnknownOutputAcceptanceDriver: go ${args.join(' ')} exit ${r.status}\n${r.stdout}${r.stderr}`);
  this.unknownOutput={value:JSON.parse(fs.readFileSync(out,'utf8')),mode,marker};
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
Then('the timeout output evidence is truthful',function(){const v=this.unknownOutput;observe(v.value,v.mode,v.marker);});
