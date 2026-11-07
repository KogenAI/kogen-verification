'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const P = 'k-verify-probe-env-matches-shaper-session: ';
const SECRET = 'sk-synthetic-credential-7f91';
const DRIVER = `package main
import (
 "context"
 "encoding/json"
 "os"
 "path/filepath"
 "github.com/KogenAI/kogen-coordinator/project"
 "github.com/KogenAI/kogen-loop/sys"
 "github.com/KogenAI/kogen-verification/verify"
)
type sink struct { Events []map[string]any }
func (s *sink) Log(e map[string]any) { s.Events = append(s.Events,e) }
func main() {
 root,err:=os.MkdirTemp("","env-probe-fixture-"); if err!=nil {panic(err)}; defer os.RemoveAll(root)
 command:=os.Args[1]; expected:=os.Args[2]
 if err=os.WriteFile(filepath.Join(root,"check.sh"),[]byte(command),0600); err!=nil {panic(err)}
 d:=verify.Declaration{ID:"reporter",Kind:"capability",Inputs:[]string{"check.sh"},Observers:[]string{},Checks:[]verify.DeclaredCheck{{Name:"support",Command:"sh check.sh",Exit:0,Output:expected}}}
 b,_:=json.Marshal(d)
 intent:= &project.Intent{Root:root,Slug:"fixture",Feasibility:[]string{"- evidence: "+string(b)}}
 logs:= &sink{}
 result,err:=verify.Execute(context.Background(),sys.New(),verify.Tools{},root,intent,root,nil)
 text:=""; if e,ok:=sys.AsError(err);ok {text=e.Render()} else if err!=nil {panic(err)}
 retained,err2:=os.ReadFile(filepath.Join(root,".kogen/local/readiness/fixture-feasibility.ndjson")); if err2!=nil {panic(err2)}
 // Run the same real probe with its logger attached to inspect the run-log channel too.
 _,err2=(verify.Probe{Root:root,Command:"sh check.sh",Log:logs}).Run(context.Background(),sys.New()); if err2!=nil {panic(err2)}
 if err=json.NewEncoder(os.Stdout).Encode(map[string]any{"accepted":err==nil,"refusal":text,"evidence":string(retained),"logs":logs.Events,"result":result});err!=nil {panic(err)}
}
`;
function run(file,args,options={}) { return new Promise((resolve,reject)=>execFile(file,args,{...options,encoding:'utf8',maxBuffer:8*1024*1024},(error,stdout,stderr)=>{if(error) reject(new Error(`${file} ${args.join(' ')}: ${error.message}\n${stdout}${stderr}`));else resolve(stdout);})); }
let build;
async function harness() {
 if (!build) build=(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'env-probe-build-'));
 const source=path.join(dir,'main.go'); fs.writeFileSync(source,DRIVER);
 const binary=path.join(dir,'driver');
 await run('go',['build','-o',binary,source]); return {dir,binary};
 })();
 return build;
}
function observe(r,expected,actual,accepted,names) {
 assert.equal(r.accepted,accepted,'readiness disposition');
 const retained=JSON.parse(r.evidence.trim());
 assert.equal(retained.length,1,'one retained obligation');
 assert.equal(retained[0].checks.length,1,'one retained check');
 assert.equal(retained[0].checks[0].output,actual,'actual restricted output retained');
 assert.equal(retained[0].checks[0].exit,0,'probe exit');
 assert.equal(retained[0].checks[0].timed_out,false,'probe completed');
 assert.ok(!JSON.stringify(r).includes(SECRET),'credential value must not reach refusal, logs, evidence or result');
 if(accepted) { assert.equal(r.refusal,'','successful probes have no extra diagnostic'); return; }
 assert.ok(r.refusal.includes('declared feasibility evidence failed'),'existing refusal heading');
 assert.ok(r.refusal.includes('expected ') && r.refusal.includes('; actual '),'expected/actual detail remains');
 assert.ok(r.refusal.includes(JSON.stringify(expected)),'declared output detail');
 assert.ok(r.refusal.includes(JSON.stringify(actual)),'actual output detail');
 const lines=r.refusal.split('\n').filter(x=>/restricted environment/i.test(x));
 assert.ok(lines.length>0,'refusal explains restricted environment');
 for(const name of names) assert.ok(lines.some(x=>new RegExp('\\b'+name+'\\b').test(x)),`restricted environment diagnostic names ${name}`);
}
function sample(accepted=false) {
 return {accepted,refusal:accepted?'':'declared feasibility evidence failed\nreporter/support: expected {"output":"runs\\n"}; actual {"output":"tests\\n"}\nprobes run under a restricted environment; caller variables not passed on: REPORTER, SECRET_TOKEN_X\n', evidence:JSON.stringify([{checks:[{output:'tests\n',exit:0,timed_out:false}]}]),logs:[],result:null};
}
if(require.main===module) {
 const mode=process.argv[2];
 if(mode==='good') {
 observe(sample(),'runs\n','tests\n',false,['REPORTER','SECRET_TOKEN_X']);
 observe(sample(true),'tests\n','tests\n',true,[]);
 console.log('observer good');
 } else if(mode==='bad') {
 const mutations=[r=>{r.refusal=r.refusal.split('\n').filter(x=>!x.includes('restricted environment')).join('\n');},r=>{r.refusal=r.refusal.replace('REPORTER','OTHER');},r=>{r.logs=[{value:SECRET}];},r=>{r.evidence=JSON.stringify([{checks:[{output:'runs\n',exit:0,timed_out:false}]}]);},r=>{r.refusal=r.refusal.replace('expected ','wanted ');}];
 for(const mutate of mutations) {const r=sample();mutate(r);assert.throws(()=>observe(r,'runs\n','tests\n',false,['REPORTER','SECRET_TOKEN_X']));}
 const passing=sample(true);passing.refusal='restricted environment';assert.throws(()=>observe(passing,'tests\n','tests\n',true,[]));
 console.log('observer bad rejected');process.exitCode=1;
 } else {throw new Error('expected good or bad');}
} else {
 const {Given,Then,AfterAll}=require('@cucumber/cucumber');
 Given(P+'the caller sets REPORTER to 0 and a synthetic SECRET_TOKEN_X',function(){this.probeEnv={...process.env,REPORTER:'0',SECRET_TOKEN_X:SECRET};});
 Then(P+'declaring {string} for command {string} is {word} with actual {string}',async function(expected,command,outcome,actual){
 const h=await harness();const r=JSON.parse(await run(h.binary,[command,expected.replaceAll('\\n','\n')],{env:this.probeEnv}));
 observe(r,expected.replaceAll('\\n','\n'),actual.replaceAll('\\n','\n'),outcome==='accepted',['REPORTER','SECRET_TOKEN_X']);
 });
 AfterAll(async()=>{if(build){const h=await build;fs.rmSync(h.dir,{recursive:true,force:true});}});
}
