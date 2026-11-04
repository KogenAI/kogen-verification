'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const driver=String.raw`package verify
import("context";"encoding/json";"os";"path/filepath";"sync";"testing";"time";"github.com/KogenAI/kogen-coordinator/project";"github.com/KogenAI/kogen-loop/sys")
type wallLog struct { mu sync.Mutex; Events []map[string]any }
func(l *wallLog) Log(e map[string]any){l.mu.Lock();defer l.mu.Unlock();if e["event"]=="command" || e["event"]=="command_result" || e["event"]=="pass" {l.Events=append(l.Events,e)}}
func TestWallIntentDriver(t *testing.T){
 p:=newProj(t); mode:=os.Getenv("WALL_CASE")
 p.Config.Fix=[]string{"sleep 1"};p.Config.Setup=[]string{"sleep 1"};p.Config.Acceptance.Run="sleep 1; "+p.Config.Acceptance.Run
 p.Config.Checks=[]project.Check{{Name:"slow",Run:"sleep 2"},{Name:"red",Run:"exit 3"},{Name:"tail",Run:"echo never"}}
 if mode=="cohort" || mode=="cancel" {
  bin:=t.TempDir(); script:="#!/bin/sh\nsleep 5\n"
  if mode=="cancel" {script="#!/bin/sh\nif test \"$1\" = build; then sleep 1; exit 3; fi\nsleep 30\n"}
  if e:=os.WriteFile(filepath.Join(bin,"go"),[]byte(script),0700);e!=nil{t.Fatal(e)}
  p.Env=append(p.Env,"PATH="+bin+":"+os.Getenv("PATH"));p.Config.Checks=[]project.Check{{Name:"compile",Run:"go build ./..."},{Name:"vet",Run:"go vet ./..."},{Name:"tail",Run:"echo never"}}
 }
 if mode=="model" {p.write("m.qnt","module m { val safe = true }\n");p.Intent.Model=&project.ModelSpec{Path:"m.qnt",Invariants:[]string{"safe"},Seed:"1",Samples:"1",Steps:"1"};p.Config.Checks=nil}
 var reports []any
 for i:=0;i<2;i++ {l:=&wallLog{};in:=p.input(1);in.Log=l
 if mode=="model" {in.Tools=Tools{Node:os.Getenv("KOGEN_NODE"),Quint:os.Getenv("KOGEN_QUINT")}}
 s:=sys.NewWith(p.Env,p.Root);ctx,cancel:=context.WithTimeout(context.Background(),25*time.Second)
 pass,e:=Run(ctx,s,in);cancel();if e!=nil{t.Fatal(e)};b,e:=json.Marshal(pass);if e!=nil{t.Fatal(e)}
 reports=append(reports,map[string]any{"pass":string(b),"events":l.Events})
 };b,e:=json.Marshal(reports);if e!=nil{t.Fatal(e)};if e=os.WriteFile(os.Getenv("WALL_REPORT"),b,0600);e!=nil{t.Fatal(e)}
}
`;
function observe(reports,mode,b){
 assert.equal(reports.length,2);
 const clean=x=>{if(Array.isArray(x))return x.map(clean);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).filter(([k])=>!k.endsWith('_ms')).map(([k,v])=>[k,clean(v)]));if(typeof x==='string')return x.replace(/\/[^\s"']*kogen-verify-[^\s"']*/g,'<scratch>');return x;};
 for(const r of reports){
  const results=r.events.filter(e=>e.event==='command_result');
  const names=mode==='serial'?['fix-1','setup-1','acceptance','slow','red']:mode==='model'?['fix-1','setup-1','acceptance','model','model']:['fix-1','setup-1','acceptance','compile','vet',...(mode==='cohort'?['tail']:[])];
  assert.deepEqual(results.map(e=>e.name).sort(),names.sort(),'exact executed command_result multiset');
  for(const e of results)assert.ok(Number.isInteger(e.wall_ms)&&e.wall_ms>=0,`${e.name} integer wall_ms`);
  const duration=name=>results.find(e=>e.name===name).wall_ms;
  for(const name of ['fix-1','setup-1','acceptance'])assert.ok(duration(name)>=b.sleep_min&&duration(name)<b.sleep_max,`${name} sleeping duration`);
  const passes=r.events.filter(e=>e.event==='pass');assert.equal(passes.length,1);const wall=passes[0].checks_wall_ms;assert.ok(Number.isInteger(wall)&&wall>=0,'pass checks_wall_ms');
  assert.ok(wall>=duration('setup-1')+duration('acceptance'),'whole pass includes setup and acceptance');
  if(mode==='serial')assert.ok(duration('slow')>=b.check_min&&duration('slow')<b.check_max,'sleep 2 timing');
  if(mode==='cohort'){for(const name of ['compile','vet'])assert.ok(duration(name)>=b.cohort_min&&duration(name)<b.cohort_max,'per-check cohort timing');assert.ok(duration('compile')+duration('vet')>wall,'overlapping sum exceeds whole pass');}
  if(mode==='cancel'){assert.ok(duration('vet')<b.cancel_max,'cancelled check measured only until cancellation');assert.ok(JSON.parse(r.pass).cancelled.some(e=>e.name==='vet'),'sibling is cancelled');}
  const pass=JSON.parse(r.pass);assert.ok(!r.pass.includes('wall_ms'),'Pass JSON unchanged by timing');
  if(mode==='serial'||mode==='cancel'){assert.ok(pass.not_run.includes('tail'));assert.ok(!results.some(e=>e.name==='tail'),'never-started tail has no result');}
  if(mode==='serial'&&b.control_pass)assert.equal(r.pass,b.control_pass,'byte-identical control Pass JSON');
 }
 assert.equal(reports[0].pass,reports[1].pass,'same stub Pass bytes unchanged across runs');
 // The sequential log has a deterministic order. Concurrent scheduling order is not a product guarantee.
 if(mode==='serial')assert.deepEqual(clean(reports[0].events),clean(reports[1].events),'command/pass logs identical after *_ms masking and scratch path normalization');
}
const bounds={sleep_min:1000,sleep_max:3000,check_min:2000,check_max:5000,cohort_min:5000,cohort_max:11000,cancel_max:3000};
function controls(bad){
 for(const mode of ['serial','cohort','cancel','model']){
  const names=mode==='serial'?['fix-1','setup-1','acceptance','slow','red']:mode==='model'?['fix-1','setup-1','acceptance','model','model']:['fix-1','setup-1','acceptance','compile','vet',...(mode==='cohort'?['tail']:[])];
  const events=names.map(name=>({event:'command_result',name,wall_ms:name==='slow'?2000:['compile','vet'].includes(name)?(mode==='cohort'?5000:1000):1000}));events.push({event:'pass',checks_wall_ms:mode==='cohort'?7200:5000});
  const pass=JSON.stringify({not_run:mode==='serial'||mode==='cancel'?['tail']:[],cancelled:mode==='cancel'?[{name:'vet'}]:[]});const r={pass,events};const b={...bounds,...(mode==='serial'?{control_pass:pass}:{})};observe([r,structuredClone(r)],mode,b);
  if(bad){const mutations=[x=>delete x.events[0].wall_ms,x=>x.events.find(e=>e.event==='pass').checks_wall_ms=0,x=>x.pass=x.pass.replace('not_run','wall_ms')];if(mode==='serial')mutations.push(x=>x.events.find(e=>e.name==='slow').wall_ms=0,x=>x.pass+=' ');if(mode==='cohort')mutations.push(x=>x.events.find(e=>e.event==='pass').checks_wall_ms=12000);if(mode==='cancel')mutations.push(x=>x.events.find(e=>e.name==='vet').wall_ms=30000);for(const mutate of mutations){const x=structuredClone(r);mutate(x);assert.throws(()=>observe([x,structuredClone(x)],mode,b));}}
 }
}
if(require.main===module){try{controls(process.argv[2]==='bad');console.log(process.argv[2]==='bad'?'bad controls rejected':'good controls accepted');process.exitCode=process.argv[2]==='bad'?1:0;}catch(e){console.error(e);process.exitCode=2;}}
else {
 const {When,Then,AfterAll}=require('@cucumber/cucumber');let scratch;
 When('k-verify-check-wall-ms: I run the {string} verification stub',{timeout:180000},function(mode){
  if(!scratch){scratch=fs.mkdtempSync(path.join(os.tmpdir(),'wall-acceptance-'));for(const e of fs.readdirSync(process.cwd()))if(!['.git','node_modules'].includes(e))fs.cpSync(path.join(process.cwd(),e),path.join(scratch,e),{recursive:true});fs.writeFileSync(path.join(scratch,'verify/wall_intent_driver_test.go'),driver);}
  const report=path.join(scratch,'wall-report.json');fs.rmSync(report,{force:true});const r=cp.spawnSync('go',['test','./verify','-run','^TestWallIntentDriver$','-count=1','-timeout=100s'],{cwd:scratch,env:{...process.env,WALL_CASE:mode,WALL_REPORT:report},encoding:'utf8',timeout:150000,maxBuffer:8000000});
  assert.equal(r.status,0,`TestWallIntentDriver via go test ./verify outcome ${r.status}: ${r.error||''}\n${r.stdout}\n${r.stderr}`);assert.ok(fs.existsSync(report),'TestWallIntentDriver via go test ./verify absent/skipped/zero-run: report missing');this.wallReports=JSON.parse(fs.readFileSync(report));this.wallMode=mode;
 });
 Then('k-verify-check-wall-ms: the timing evidence satisfies:',function(text){observe(this.wallReports,this.wallMode,JSON.parse(text));});
 AfterAll(()=>{if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
}
