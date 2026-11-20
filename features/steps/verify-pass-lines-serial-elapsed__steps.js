'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
// The driver runs real serial verification passes with fake commands (true, exit N, sleep) in a
// copy of the checkout and writes the progress lines and command_result events of each pass.
const driver=String.raw`package verify

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
)

func TestSerialElapsedDriver(t *testing.T) {
	out := map[string]any{}
	runCase := func(name string, setup []string, checks []project.Check) {
		p := newProj(t)
		p.Config.Setup = setup
		p.Config.Checks = checks
		s, stderr := p.session()
		log := &memLog{}
		in := p.input(1)
		in.Log = log
		_, err := Run(context.Background(), s, in)
		errText := ""
		if err != nil {
			errText = err.Error()
		}
		lines := []string{}
		for _, line := range strings.Split(stderr.String(), "\n") {
			if line == "" || strings.HasPrefix(line, "kogen: verifying") || strings.HasPrefix(line, "kogen: pass ") {
				continue
			}
			lines = append(lines, line)
		}
		results := []map[string]any{}
		for _, e := range log.named("command_result") {
			results = append(results, map[string]any{"name": e["name"], "status": e["status"], "wall_ms": e["wall_ms"]})
		}
		out[name] = map[string]any{"lines": lines, "results": results, "error": errText}
	}

	runCase("serial", []string{"true"}, []project.Check{{Name: "ca", Run: "true"}, {Name: "cb", Run: "exit 3"}, {Name: "cc", Run: "true"}})
	runCase("timed", []string{"sleep 0.6", "true"}, []project.Check{{Name: "slow", Run: "sleep 1.6"}, {Name: "quick", Run: "sleep 0.3"}, {Name: "gone", Run: "sleep 0.7; exit 127"}, {Name: "never", Run: "true"}})
	runCase("setup-red", []string{"exit 127", "true"}, []project.Check{{Name: "ca", Run: "true"}})

	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("SERIAL_ELAPSED_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;
// observe checks one pass of the driver's report. The commands that ran (the acceptance item
// aside) must be exactly want.commands in order with their statuses. The progress lines must be,
// in order: for a setup command the running line then its end line, for a check its end line,
// where an end line is "kogen: <name> passed (<n> s)" or "kogen: <name> failed, exit <status> (<n> s)"
// and n is the wall_ms the command_result event records rounded half up. No line names an item
// listed in want.absent.
function observe(report,name,want){
 const r=report[name];
 assert.ok(r,`case ${name} missing from the TestSerialElapsedDriver report`);
 assert.equal(r.error,'',`${name}: the pass returned an error`);
 const ran=r.results.filter(x=>x.name!=='acceptance');
 assert.deepEqual(ran.map(x=>[x.name,x.status]),want.commands.map(c=>[c.name,c.status]),`${name}: commands that ran`);
 const expected=[];
 ran.forEach((x,i)=>{
  assert.ok(Number.isInteger(x.wall_ms)&&x.wall_ms>=0,`${name}: ${x.name} wall_ms ${x.wall_ms}`);
  const secs=Math.floor((x.wall_ms+500)/1000);
  if(want.commands[i].setup!==undefined)expected.push(`kogen: running ${x.name}: ${want.commands[i].setup}`);
  expected.push(x.status===0?`kogen: ${x.name} passed (${secs} s)`:`kogen: ${x.name} failed, exit ${x.status} (${secs} s)`);
 });
 if(want.atLeastSeconds)for(const [n,min] of Object.entries(want.atLeastSeconds)){
  const x=ran.find(y=>y.name===n);
  assert.ok(x&&Math.floor((x.wall_ms+500)/1000)>=min,`${name}: ${n} took ${x&&x.wall_ms} ms, too fast for the rounding check`);
 }
 assert.deepEqual(r.lines,expected,`${name}: progress lines`);
 for(const n of want.absent)assert.ok(!r.lines.some(l=>l.startsWith(`kogen: ${n} `)||l.startsWith(`kogen: running ${n}:`)),`${name}: a line names ${n}, which never ran`);
}
const goodCase=(want,wall)=>{
 const results=[],lines=[];
 want.commands.forEach((c,i)=>{
  if(i===1)results.push({name:'acceptance',status:0,wall_ms:12});
  const ms=wall[i];
  results.push({name:c.name,status:c.status,wall_ms:ms});
  const secs=Math.floor((ms+500)/1000);
  if(c.setup!==undefined)lines.push(`kogen: running ${c.name}: ${c.setup}`);
  lines.push(c.status===0?`kogen: ${c.name} passed (${secs} s)`:`kogen: ${c.name} failed, exit ${c.status} (${secs} s)`);
 });
 return {lines,results,error:''};
};
const wants={
 serial:{commands:[{name:'setup-1',setup:'true',status:0},{name:'ca',status:0},{name:'cb',status:3}],absent:['cc']},
 timed:{commands:[{name:'setup-1',setup:'sleep 0.6',status:0},{name:'setup-2',setup:'true',status:0},{name:'slow',status:0},{name:'quick',status:0},{name:'gone',status:127}],absent:['never'],atLeastSeconds:{slow:2}},
 'setup-red':{commands:[{name:'setup-1',setup:'exit 127',status:127}],absent:['setup-2','ca']},
};
const walls={serial:[7,6,7],timed:[613,7,1609,311,709],'setup-red':[7]};
function controls(bad){
 const good={};
 for(const n of Object.keys(wants))good[n]=goodCase(wants[n],walls[n]);
 for(const n of Object.keys(wants))observe(good,n,wants[n]);
 if(!bad)return;
 const mutations=[
  ['timed',x=>{x.timed.lines[1]='kogen: setup-1 passed (0 s)';}],
  ['timed',x=>{x.timed.lines[4]='kogen: slow passed (1 s)';}],
  ['timed',x=>{x.timed.lines[5]='kogen: quick passed (1 s)';}],
  ['serial',x=>{x.serial.lines[3]='kogen: cb passed (0 s)';}],
  ['serial',x=>{x.serial.lines[3]='kogen: cb failed (0 s)';}],
  ['serial',x=>{x.serial.lines.splice(1,1);}],
  ['serial',x=>{x.serial.lines.push('kogen: cc passed (0 s)');}],
  ['serial',x=>{x.serial.lines.splice(0,1);}],
  ['serial',x=>{const [a,b]=[x.serial.lines[1],x.serial.lines[2]];x.serial.lines[1]=b;x.serial.lines[2]=a;}],
  ['setup-red',x=>{x['setup-red'].lines[1]='kogen: setup-1 failed, exit 1 (0 s)';}],
  ['setup-red',x=>{delete x['setup-red'];}],
 ];
 for(const [n,mutate] of mutations){const x=structuredClone(good);mutate(x);assert.throws(()=>observe(x,n,wants[n]),undefined,`mutation of ${n} was accepted`);}
}
if(require.main===module){
 const bad=process.argv[2]==='bad';
 try{controls(bad);console.log(bad?'bad controls rejected':'good controls accepted');process.exitCode=bad?1:0;}catch(e){console.error(e);process.exitCode=2;}
}else{
 const {When,Then,AfterAll}=require('@cucumber/cucumber');
 let scratch,pending;
 function runDriver(){
  if(!pending)pending=(async()=>{
   scratch=fs.mkdtempSync(path.join(os.tmpdir(),'serial-elapsed-acceptance-'));
   for(const e of fs.readdirSync(process.cwd()))if(!['.git','node_modules'].includes(e))fs.cpSync(path.join(process.cwd(),e),path.join(scratch,e),{recursive:true,filter:src=>path.basename(src)!=='node_modules'});
   fs.writeFileSync(path.join(scratch,'verify/serial_elapsed_driver_test.go'),driver);
   const report=path.join(scratch,'serial-elapsed-report.json');
   const command='go test ./verify -run ^TestSerialElapsedDriver$ -count=1 -v -timeout=100s';
   const r=await new Promise(resolve=>{
    const child=cp.spawn('go',['test','./verify','-run','^TestSerialElapsedDriver$','-count=1','-v','-timeout=100s'],{cwd:scratch,env:{...process.env,SERIAL_ELAPSED_REPORT:report}});
    let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});
    child.on('error',e=>resolve({status:null,out:out+String(e)}));child.on('close',status=>resolve({status,out}));
   });
   assert.equal(r.status,0,`TestSerialElapsedDriver via ${command}: exit ${r.status}\n${r.out}`);
   assert.match(r.out,/--- PASS: TestSerialElapsedDriver /,`TestSerialElapsedDriver via ${command} was absent, skipped or ran zero times (exit ${r.status})\n${r.out}`);
   assert.ok(fs.existsSync(report),`TestSerialElapsedDriver via ${command} passed but wrote no report`);
   return JSON.parse(fs.readFileSync(report,'utf8'));
  })();
  return pending;
 }
 When('verify-pass-lines-serial-elapsed: the serial verification passes of fake commands have run',{timeout:115000},async function(){this.serialElapsedReport=await runDriver();});
 Then('verify-pass-lines-serial-elapsed: the {string} pass progress lines match:',function(name,text){observe(this.serialElapsedReport,name,JSON.parse(text));});
 AfterAll(()=>{if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
}
