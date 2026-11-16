'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
// The Go driver calls only RequireTools and RequireRunner, which exist today, and reports each refusal as JSON.
const driver=String.raw`package verify

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

func TestToolMissingDriver(t *testing.T) {
	out := map[string]any{}
	record := func(name string, err error) {
		e, ok := sys.AsError(err)
		if !ok {
			t.Fatalf("%s: not a refusal: %v", name, err)
		}
		out[name] = map[string]any{"class": e.Class, "reason": e.Reason, "detail": e.Detail, "exit": e.Exit, "lines": e.Lines}
	}
	root := t.TempDir()
	s := sys.NewWith(testEnv(), root)
	record("one-check", RequireTools(s, Tools{}, root, configWith("true", "nope-tool --x"), true))
	cfg := configWith("true", "nope-tool test")
	cfg.Setup = []string{"nope-tool install"}
	cfg.Fix = []string{"nope-tool fmt"}
	record("every-command", RequireTools(s, Tools{}, root, cfg, true))
	record("secret", RequireTools(s, Tools{}, root, configWith("true", "nope-tool --token abc123"), true))
	acc := &project.Config{Acceptance: &project.Acceptance{Run: "definitely-not-a-tool"}}
	record("acceptance", RequireRunner(context.Background(), s, Tools{}, root, acc))
	ns := sys.NewWith(append(testEnv(), "KOGEN_NODE="), root)
	record("kogen-node", RequireTools(ns, Tools{}, root, configWith("\"$KOGEN_NODE\" --version"), true))
	empty := t.TempDir()
	gs := sys.NewWith(testEnv("PATH="+empty), root)
	record("git", RequireTools(gs, Tools{}, root, configWith("true"), false))
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("TOOL_MISSING_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;
function refusal(report,name,detail,lines){
 const r=report[name];
 assert.ok(r,'case '+name+' missing from the TestToolMissingDriver report');
 assert.equal(r.class+'/'+r.reason,'environment/tool_missing',name+': refusal kind');
 assert.equal(r.exit,3,name+': exit');
 assert.equal(r.detail,detail,name+': detail');
 assert.deepEqual(r.lines||[],lines,name+': lines');
}
if(require.main===module){
 const bad=process.argv[2]==='bad';
 try{
  const want=['commands.checks[cb]: nope-tool --token [REDACTED]','next: install nope-tool or change that command in .kogen/project.yaml (commit the change), then rerun the command that was refused'];
  const good={x:{class:'environment',reason:'tool_missing',exit:3,detail:'nope-tool is not available',lines:[...want]}};
  refusal(good,'x','nope-tool is not available',want);
  if(bad){
   const mut=f=>{const c=structuredClone(good);f(c.x);return c;};
   assert.throws(()=>refusal(mut(r=>{r.lines=null;}),'x','nope-tool is not available',want));
   assert.throws(()=>refusal(mut(r=>{r.lines[0]='commands.checks[cb]: nope-tool --token abc123';}),'x','nope-tool is not available',want));
   assert.throws(()=>refusal(mut(r=>{r.detail='nope-tool is not available; install it';}),'x','nope-tool is not available',want));
   assert.throws(()=>refusal(mut(r=>{r.exit=1;}),'x','nope-tool is not available',want));
   assert.throws(()=>refusal(mut(r=>{r.lines=[r.lines[1],r.lines[0]];}),'x','nope-tool is not available',want));
   assert.throws(()=>refusal(good,'y','nope-tool is not available',want));
  }
  console.log(bad?'bad controls rejected':'good controls accepted');process.exitCode=bad?1:0;
 }catch(e){console.error(e);process.exitCode=2;}
}else{
 const {When,Then,AfterAll}=require('@cucumber/cucumber');
 const P='verify-tool-missing-names-command-and-next-step: ';
 let scratch,pending;
 function runDriver(){
  if(!pending)pending=(async()=>{
   scratch=fs.mkdtempSync(path.join(os.tmpdir(),'tool-missing-acceptance-'));
   for(const e of fs.readdirSync(process.cwd()))if(!['.git','node_modules'].includes(e))fs.cpSync(path.join(process.cwd(),e),path.join(scratch,e),{recursive:true,filter:src=>path.basename(src)!=='node_modules'});
   fs.writeFileSync(path.join(scratch,'verify/tool_missing_acceptance_driver_test.go'),driver);
   const report=path.join(scratch,'tool-missing-report.json');
   const command='go test ./verify -run ^TestToolMissingDriver$ -count=1 -v -timeout=100s';
   const r=await new Promise(resolve=>{
    const child=cp.spawn('go',['test','./verify','-run','^TestToolMissingDriver$','-count=1','-v','-timeout=100s'],{cwd:scratch,env:{...process.env,TOOL_MISSING_REPORT:report}});
    let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});
    child.on('error',e=>resolve({status:null,out:out+String(e)}));child.on('close',status=>resolve({status,out}));
   });
   assert.equal(r.status,0,'TestToolMissingDriver via '+command+': exit '+r.status+'\n'+r.out);
   assert.match(r.out,/--- PASS: TestToolMissingDriver /,'TestToolMissingDriver via '+command+' was absent, skipped or ran zero times\n'+r.out);
   return JSON.parse(fs.readFileSync(report,'utf8'));
  })();
  return pending;
 }
 When(P+'the missing programs have been looked up in a temporary copy of the project',{timeout:115000},async function(){this.rep=await runDriver();});
 Then(P+'the {string} refusal is environment\\/tool_missing with exit 3, detail {string} and exactly these lines:',function(name,detail,text){refusal(this.rep,name,detail,text.split('\n'));});
 AfterAll(()=>{if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
}
