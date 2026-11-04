'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const tools=['go','node','npm','ruby','bundle','python3','elixir','erl','mix','git','quint'];
const locks=['go.sum','go.mod','mix.lock','package-lock.json','yarn.lock','pnpm-lock.yaml','Gemfile.lock','poetry.lock','requirements.txt'];
const secret='identity-secret-7b98b1';
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x;}
function sha(x){return crypto.createHash('sha256').update(x).digest('hex');}
function digest(c,i){return sha(JSON.stringify(canonical([c,i.tree,i.tools,i.lockfiles,i.environment,i.host])));}
function observe(rs){
 assert.equal(rs.length,8);const ids=[];
 for(const r of rs){
  assert.equal(r.pass,r.control,'Pass bytes equal no-logger control');
  assert.ok(!JSON.stringify(r).includes(secret),'no environment secret in any evidence');
  const es=r.events, ii=es.filter(e=>e.event==='check_identity');assert.equal(ii.length,1,'one identity per pass');const i=ii[0];ids.push(i);
  assert.equal(i.tree,JSON.parse(r.pass).tree,'exact candidate tree');assert.deepEqual(Object.keys(i).sort(),['environment','event','host','lockfiles','tools','tree']);
  assert.deepEqual(i.tools.map(t=>t.name),tools);assert.deepEqual(i.lockfiles.map(l=>l.path),locks);
  for(const l of i.lockfiles)assert.equal(l.sha256,sha(r.lockBytes[l.path]),l.path);
  assert.deepEqual(i.host,r.host);assert.deepEqual(i.environment.names,[...new Set(i.environment.names)].sort());assert.match(i.environment.sha256,/^[a-f0-9]{64}$/);assert.ok(i.environment.names.includes('IDENTITY_SECRET'));
  assert.equal(i.tools.find(t=>t.name==='go').status,'absent');assert.equal(i.tools.find(t=>t.name==='ruby').status,'timed_out');assert.equal(i.tools.find(t=>t.name==='node').version,r.version);assert.equal(i.tools.find(t=>t.name==='node').path,r.node);
  assert.ok(r.elapsed<10000,'bounded hanging version probe');assert.equal(r.nodeCalls,1,'one version invocation per pass');
  const cmds=es.filter(e=>e.event==='command');assert.ok(cmds.length>=3,'setup, acceptance and checks executed');assert.ok(es.indexOf(i)<es.indexOf(cmds[0]),'identity before first command');
  for(const c of cmds){assert.equal(c.identity_sha256,digest(c.command,i),'command identity');assert.match(c.identity_sha256,/^[a-f0-9]{64}$/);}
 }
 const sig=n=>rs[n].events.find(e=>e.event==='command'&&e.name==='proof').identity_sha256;
 assert.equal(sig(0),sig(1),'identical passes');for(const n of [2,3,4,5])assert.notEqual(sig(0),sig(n),'changed input '+n);assert.equal(sig(0),sig(6),'unreceived ambient variable');assert.notEqual(sig(0),sig(7),'command text');
 assert.notEqual(ids[0].tree,ids[2].tree);assert.notEqual(ids[0].lockfiles[0].sha256,ids[3].lockfiles[0].sha256);assert.notEqual(ids[0].environment.sha256,ids[5].environment.sha256);
}
const driver=String.raw`package verify
import("context";"encoding/json";"os";"os/exec";"path/filepath";"runtime";"strings";"testing";"time";"github.com/KogenAI/kogen-coordinator/project";"github.com/KogenAI/kogen-loop/sys")
type identityLog struct{ Events []map[string]any }
func(l *identityLog)Log(e map[string]any){l.Events=append(l.Events,e)}
func TestIdentityIntentDriver(t *testing.T){
 p:=newProj(t);bin:=t.TempDir();trace:=filepath.Join(t.TempDir(),"calls");node:=filepath.Join(bin,"node")
 for _,n:=range []string{"git","grep","cp"}{v,e:=exec.LookPath(n);if e!=nil{t.Fatal(e)};if e=os.Symlink(v,filepath.Join(bin,n));e!=nil{t.Fatal(e)}}
 writeNode:=func(v string){if e:=os.WriteFile(node,[]byte("#!/bin/sh\nprintf 'x\\n' >> '"+trace+"'\nprintf '"+v+"\\nignored second line\\n'\n"),0700);e!=nil{t.Fatal(e)}};writeNode("stub node v1")
 if e:=os.WriteFile(filepath.Join(bin,"ruby"),[]byte("#!/bin/sh\nwhile :; do :; done\n"),0700);e!=nil{t.Fatal(e)}
 base:=append([]string{},p.Env...);for j:=len(base)-1;j>=0;j--{if strings.HasPrefix(base[j],"PATH=")||strings.HasPrefix(base[j],"IDENTITY_SECRET="){base=append(base[:j],base[j+1:]...)}};base=append(base,"PATH="+bin,"IDENTITY_SECRET=identity-secret-7b98b1")
 locks:=[]string{"go.sum","go.mod","mix.lock","package-lock.json","yarn.lock","pnpm-lock.yaml","Gemfile.lock","poetry.lock","requirements.txt"};for _,n:=range locks{p.write(n,"lock-v1\n")};p.commit("locks")
 p.Config.Setup=[]string{":"};p.Config.Checks=[]project.Check{{Name:"proof",Run:":"},{Name:"red",Run:"exit 3"}}
 var reports []any
 for n:=0;n<8;n++{
  p.write("app.txt","green\n");p.write("go.sum","lock-v1\n");writeNode("stub node v1");env:=append([]string{},base...);command:=":";version:="stub node v1"
  switch n{case 2:p.write("README.md","changed\n");case 3:p.write("go.sum","lock-v2\n");case 4:writeNode("stub node v2");version="stub node v2";case 5:env=append(env,"RECEIVED_CHANGE=1");case 6:t.Setenv("UNRECEIVED_CHANGE","outside-session");case 7:command=": # changed command"};if n!=2{p.write("README.md","readme\n")};p.Config.Checks[0].Run=command
  in:=p.input(1);l:=&identityLog{};in.Log=l;os.Remove(trace);s:=sys.NewWith(env,p.Root);ctx,cancel:=context.WithTimeout(context.Background(),20*time.Second);start:=time.Now();pass,e:=Verify(ctx,s,in);elapsed:=time.Since(start).Milliseconds();cancel();if e!=nil{t.Fatal(e)};calls,e:=os.ReadFile(trace);if e!=nil{calls=nil};b,e:=json.Marshal(pass);if e!=nil{t.Fatal(e)}
  in.Log=nil;s=sys.NewWith(env,p.Root);ctx,cancel=context.WithTimeout(context.Background(),20*time.Second);control,e:=Verify(ctx,s,in);cancel();if e!=nil{t.Fatal(e)};cb,e:=json.Marshal(control);if e!=nil{t.Fatal(e)};lb:=map[string]string{};for _,name:=range locks{lb[name]=p.read(name)}
  reports=append(reports,map[string]any{"events":l.Events,"pass":string(b),"control":string(cb),"elapsed":elapsed,"nodeCalls":strings.Count(string(calls),"x\n"),"node":node,"version":version,"host":map[string]string{"os":runtime.GOOS,"arch":runtime.GOARCH},"lockBytes":lb})
 };b,e:=json.Marshal(reports);if e!=nil{t.Fatal(e)};if e=os.WriteFile(os.Getenv("IDENTITY_REPORT"),b,0600);e!=nil{t.Fatal(e)}
}
`;
function controls(bad){
 const rs=[];for(let n=0;n<8;n++){
  const lockBytes=Object.fromEntries(locks.map(k=>[k,k==='go.sum'&&n===3?'lock-v2\n':'lock-v1\n']));const version=n===4?'stub node v2':'stub node v1';
  const i={event:'check_identity',tree:'tree'+([2,3].includes(n)?n:0),tools:tools.map(name=>({name,path:name==='node'?'/stub/node':null,status:name==='node'?'ok':name==='ruby'?'timed_out':'absent',version:name==='node'?version:null})),lockfiles:locks.map(p=>({path:p,sha256:sha(lockBytes[p])})),environment:{names:['IDENTITY_SECRET','PATH'],sha256:sha(n===5?'changed':'base')},host:{os:'linux',arch:'amd64'}};
  const cmds=['setup-1','acceptance','proof'].map(name=>{const command=name==='proof'&&n===7?': # changed command':':';return {event:'command',name,command,identity_sha256:digest(command,i)};});const pass=JSON.stringify({tree:i.tree});rs.push({events:[i,...cmds],pass,control:pass,elapsed:10,nodeCalls:1,node:'/stub/node',version,host:i.host,lockBytes});
 }
 if(bad)rs[0].events.find(e=>e.name==='proof').identity_sha256='0'.repeat(64);
 observe(rs);
}
if(require.main===module){try{controls(process.argv[2]==='bad');console.log('accepted');}catch(e){console.log('rejected');process.exitCode=1;}}
else{
 const {When,Then,AfterAll}=require('@cucumber/cucumber');let scratch;
 When('k-verify-check-run-identity: I verify the synthetic candidates',{timeout:240000},function(){
  scratch=fs.mkdtempSync(path.join(os.tmpdir(),'identity-acceptance-'));for(const e of fs.readdirSync(process.cwd()))if(!['.git','node_modules'].includes(e))fs.cpSync(path.join(process.cwd(),e),path.join(scratch,e),{recursive:true});fs.writeFileSync(path.join(scratch,'verify/identity_intent_driver_test.go'),driver);
  const report=path.join(scratch,'identity-report.json');const r=cp.spawnSync('go',['test','./verify','-run','^TestIdentityIntentDriver$','-count=1','-timeout=200s'],{cwd:scratch,env:{...process.env,IDENTITY_REPORT:report},encoding:'utf8',timeout:220000,maxBuffer:8000000});assert.equal(r.status,0,`TestIdentityIntentDriver go test ./verify outcome ${r.status}: ${r.error||''}\n${r.stdout}\n${r.stderr}`);assert.ok(fs.existsSync(report),'TestIdentityIntentDriver go test ./verify absent/skipped/zero-run: report missing');this.identityReports=JSON.parse(fs.readFileSync(report));
 });
 Then('k-verify-check-run-identity: every identity satisfies the reproducibility and privacy contract',function(){observe(this.identityReports);});
 AfterAll(()=>{if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
}
