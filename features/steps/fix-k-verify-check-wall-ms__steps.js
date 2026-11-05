'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
// The driver runs real verification passes whose commands are `true` and `echo`, in a copy of
// the checkout, and writes what each pass logged.
const driver=String.raw`package verify

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

func TestFixWallMsDriver(t *testing.T) {
	out := map[string]any{}
	record := func(name string, log *memLog, p Pass, err error) {
		results := []string{}
		for _, e := range log.named("command_result") {
			results = append(results, e["name"].(string))
		}
		walls := []any{}
		for _, e := range log.named("pass") {
			walls = append(walls, e["checks_wall_ms"])
		}
		errText := ""
		if err != nil {
			errText = err.Error()
		}
		out[name] = map[string]any{"results": results, "walls": walls, "aborted": len(log.named("pass_aborted")), "not_run": nonNil(p.NotRun), "error": errText}
	}

	p := newProj(t)
	p.Config.Fix = []string{"true"}
	p.Config.Setup = []string{"true", "echo hi"}
	p.Config.Checks = []project.Check{{Name: "t", Run: "true"}, {Name: "e", Run: "echo hi"}, {Name: "red", Run: "exit 3"}, {Name: "tail", Run: "echo never"}}
	s, _ := p.session()
	log := &memLog{}
	in := p.input(1)
	in.Log = log
	got, err := Run(context.Background(), s, in)
	record("serial", log, got, err)

	p.Config.Setup = nil
	log = &memLog{}
	in = p.input(1)
	in.Log = log
	in.Stage = &Stage{ID: "one", Checks: []string{"true", "echo hi"}}
	got, err = Verify(context.Background(), s, in)
	record("stage", log, got, err)

	log = &memLog{}
	in = p.input(1)
	in.Log = log
	in.Stage = &Stage{ID: "empty"}
	got, err = Verify(context.Background(), s, in)
	record("empty-stage", log, got, err)

	p.Config.Setup = []string{"exit 2", "true"}
	log = &memLog{}
	in = p.input(1)
	in.Log = log
	got, err = Verify(context.Background(), s, in)
	record("setup-red", log, got, err)

	c := newProj(t)
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "go"), []byte("#!/bin/sh\necho ok\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	c.Env = append(c.Env, "PATH="+bin+":"+os.Getenv("PATH"))
	c.Config.Checks = []project.Check{{Name: "compile", Run: "go build ./..."}, {Name: "vet", Run: "go vet ./..."}}
	cs, _ := c.session()
	log = &memLog{}
	in = c.input(1)
	in.Log = log
	got, err = Verify(context.Background(), cs, in)
	record("cohort", log, got, err)

	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("FIX_WALL_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;
// observe checks one pass of the driver's report against its expectation: no error, exactly one
// pass event whose checks_wall_ms is 0 (nothing ran) or an integer in [0, 120000), and exactly
// the expected command_result names (in order unless the pass ran a concurrent cohort).
function observe(report,name,want){
 const r=report[name];
 assert.ok(r,`case ${name} missing from the TestFixWallMsDriver report`);
 assert.equal(r.error,'',`${name}: the pass returned an error`);
 assert.equal(r.aborted,0,`${name}: pass_aborted logged`);
 assert.equal(r.walls.length,1,`${name}: ${r.walls.length} pass events, want 1`);
 const wall=r.walls[0];
 assert.ok(Number.isInteger(wall),`${name}: checks_wall_ms ${wall} is not an integer`);
 if(want.wall==='zero')assert.equal(wall,0,`${name}: checks_wall_ms ${wall}, want 0`);
 else assert.ok(wall>=0&&wall<120000,`${name}: checks_wall_ms ${wall} outside [0, 120000)`);
 const order=x=>want.ordered?x:[...x].sort();
 assert.deepEqual(order(r.results),order(want.results),`${name}: command_result names`);
 assert.deepEqual(r.not_run,want.not_run,`${name}: not_run`);
}
const expected={
 serial:{wall:'nonnegative',ordered:true,results:['fix-1','setup-1','setup-2','acceptance','t','e','red'],not_run:['tail']},
 stage:{wall:'nonnegative',ordered:true,results:['stage-one-1','stage-one-2'],not_run:[]},
 'empty-stage':{wall:'zero',ordered:true,results:[],not_run:[]},
 'setup-red':{wall:'nonnegative',ordered:true,results:['setup-1'],not_run:['setup-2','acceptance','t','e','red','tail']},
 cohort:{wall:'nonnegative',ordered:false,results:['acceptance','compile','vet'],not_run:[]},
};
function controls(bad){
 const good={};
 for(const [name,want] of Object.entries(expected))good[name]={results:want.ordered?[...want.results]:[...want.results].reverse(),walls:[want.wall==='zero'?0:25],aborted:0,not_run:[...want.not_run],error:''};
 for(const name of Object.keys(expected))observe(good,name,expected[name]);
 if(!bad)return;
 const mutations=[
  ['serial',x=>x.serial.walls=[-9223372036854]],
  ['serial',x=>x.serial.results.splice(4,1)],
  ['serial',x=>x.serial.results.reverse()],
  ['stage',x=>x.stage.walls=[]],
  ['stage',x=>x.stage.walls=[1.5]],
  ['empty-stage',x=>x['empty-stage'].walls=[5]],
  ['setup-red',x=>x['setup-red'].aborted=1],
  ['setup-red',x=>x['setup-red'].error='boom'],
  ['cohort',x=>x.cohort.results.pop()],
  ['cohort',x=>delete x.cohort],
 ];
 for(const [name,mutate] of mutations){const x=structuredClone(good);mutate(x);assert.throws(()=>observe(x,name,expected[name]));}
}
if(require.main===module){
 const bad=process.argv[2]==='bad';
 try{controls(bad);console.log(bad?'bad controls rejected':'good controls accepted');process.exitCode=bad?1:0;}catch(e){console.error(e);process.exitCode=2;}
}else{
 const {When,Then,AfterAll}=require('@cucumber/cucumber');
 let scratch,pending;
 function runDriver(){
  if(!pending)pending=(async()=>{
   scratch=fs.mkdtempSync(path.join(os.tmpdir(),'fix-wall-acceptance-'));
   for(const e of fs.readdirSync(process.cwd()))if(!['.git','node_modules'].includes(e))fs.cpSync(path.join(process.cwd(),e),path.join(scratch,e),{recursive:true,filter:src=>path.basename(src)!=='node_modules'});
   fs.writeFileSync(path.join(scratch,'verify/fix_wall_ms_driver_test.go'),driver);
   const report=path.join(scratch,'fix-wall-report.json');
   const command='go test ./verify -run ^TestFixWallMsDriver$ -count=1 -v -timeout=100s';
   const r=await new Promise(resolve=>{
    const child=cp.spawn('go',['test','./verify','-run','^TestFixWallMsDriver$','-count=1','-v','-timeout=100s'],{cwd:scratch,env:{...process.env,FIX_WALL_REPORT:report}});
    let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});
    child.on('error',e=>resolve({status:null,out:out+String(e)}));child.on('close',status=>resolve({status,out}));
   });
   assert.equal(r.status,0,`TestFixWallMsDriver via ${command}: exit ${r.status}\n${r.out}`);
   assert.match(r.out,/--- PASS: TestFixWallMsDriver /,`TestFixWallMsDriver via ${command} was absent, skipped or ran zero times (exit ${r.status})\n${r.out}`);
   assert.ok(fs.existsSync(report),`TestFixWallMsDriver via ${command} passed but wrote no report`);
   return JSON.parse(fs.readFileSync(report,'utf8'));
  })();
  return pending;
 }
 When('fix-k-verify-check-wall-ms: the verification passes of true and echo commands have run',{timeout:115000},async function(){this.fixWallReport=await runDriver();});
 Then('fix-k-verify-check-wall-ms: the {string} pass log matches:',function(name,text){observe(this.fixWallReport,name,JSON.parse(text));});
 AfterAll(()=>{if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
}
