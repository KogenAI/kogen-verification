'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
// The driver runs cohorts of fake commands (true, exit 3, sleep) through the real cohort runner and a whole verification pass, and writes the progress lines and command_result events of each case.
const driver=String.raw`package verify

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

type cohortBuf struct {
	mu sync.Mutex
	b  strings.Builder
}

func (c *cohortBuf) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.b.Write(p)
}

func (c *cohortBuf) lines(prefixes ...string) []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := []string{}
	for _, l := range strings.Split(c.b.String(), "\n") {
		for _, p := range prefixes {
			if strings.HasPrefix(l, p) {
				out = append(out, l)
				break
			}
		}
	}
	return out
}

func cohortResults(log *memLog) []map[string]any {
	results := []map[string]any{}
	for _, e := range log.named("command_result") {
		results = append(results, map[string]any{"name": e["name"], "status": e["status"], "wall_ms": e["wall_ms"]})
	}
	return results
}

func TestCohortElapsedDriver(t *testing.T) {
	out := map[string]any{}
	runCase := func(name string, items []item) {
		dir := t.TempDir()
		s := sys.NewWith(testEnv(), dir)
		buf := &cohortBuf{}
		s.Stderr = buf
		log := &memLog{}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		_, err := runCohort(ctx, s, Input{Log: &lockedLogger{inner: log}}, dir, items)
		errText := ""
		if err != nil {
			errText = err.Error()
		}
		out[name] = map[string]any{"lines": buf.lines("kogen:"), "results": cohortResults(log), "error": errText}
	}
	runCase("pair", []item{{name: "ca", kind: "check", command: "true"}, {name: "cb", kind: "check", command: "exit 3"}})
	runCase("order", []item{{name: "slow", kind: "check", command: "sleep 1.6"}, {name: "quick", kind: "check", command: "true"}})
	runCase("cancel", []item{{name: "first", kind: "check", command: "exit 3"}, {name: "second", kind: "check", command: "exec sleep 30"}})

	// The same cohort through a whole verification pass: the standard go build and go vet
	// commands, served by a fake go, run together; vet fails at once and build ends later.
	p := newProj(t)
	bin := filepath.Join(t.TempDir(), "bin")
	if err := os.Mkdir(bin, 0o700); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nif test \"$1\" = version; then echo go; exit 0; fi\nif test \"$1\" = vet; then exit 3; fi\nsleep 0.6; exit 0\n"
	if err := os.WriteFile(filepath.Join(bin, "go"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	p.Env = append(p.Env, "PATH="+bin+":"+os.Getenv("PATH"))
	p.Config.Checks = []project.Check{{Name: "build", Run: "go build ./..."}, {Name: "vet", Run: "go vet ./..."}}
	s, _ := p.session()
	buf := &cohortBuf{}
	s.Stderr = buf
	log := &memLog{}
	in := p.input(1)
	in.Log = log
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	_, err := Verify(ctx, s, in)
	errText := ""
	if err != nil {
		errText = err.Error()
	}
	out["verify"] = map[string]any{"lines": buf.lines("kogen: build ", "kogen: vet "), "results": cohortResults(log), "error": errText}

	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("COHORT_ELAPSED_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;
function observe(report,name,want){
 const r=report[name];
 assert.ok(r,`case ${name} missing from the TestCohortElapsedDriver report`);
 assert.equal(r.error,'',`${name}: the cohort returned an error`);
 const ran=r.results.filter(x=>x.name!=='acceptance');
 const expected=want.names.map(n=>{
  const x=ran.find(y=>y.name===n.name);
  assert.ok(x,`${name}: ${n.name} has no command_result event`);
  assert.equal(x.status,n.status,`${name}: status of ${n.name}`);
  assert.ok(Number.isInteger(x.wall_ms)&&x.wall_ms>=0,`${name}: ${n.name} wall_ms ${x.wall_ms}`);
  const secs=Math.floor((x.wall_ms+500)/1000);
  return n.status===0?`kogen: ${n.name} passed (${secs} s)`:`kogen: ${n.name} failed, exit ${n.status} (${secs} s)`;
 });
 if(want.atLeastSeconds)for(const [n,min] of Object.entries(want.atLeastSeconds)){
  const x=ran.find(y=>y.name===n);
  assert.ok(x&&Math.floor((x.wall_ms+500)/1000)>=min,`${name}: ${n} took ${x&&x.wall_ms} ms, too fast for the rounding check`);
 }
 for(const n of want.absent)assert.ok(!r.lines.some(l=>l.startsWith(`kogen: ${n} `)),`${name}: a line names ${n}, which was cancelled: ${JSON.stringify(r.lines)}`);
 const got=want.ordered?r.lines:[...r.lines].sort();
 assert.deepEqual(got,want.ordered?expected:[...expected].sort(),`${name}: cohort progress lines ${JSON.stringify(r.lines)}`);
}
const wants={
 pair:{names:[{name:'ca',status:0},{name:'cb',status:3}],absent:[],ordered:false},
 order:{names:[{name:'quick',status:0},{name:'slow',status:0}],absent:[],ordered:true,atLeastSeconds:{slow:2}},
 cancel:{names:[{name:'first',status:3}],absent:['second'],ordered:true},
 verify:{names:[{name:'vet',status:3},{name:'build',status:0}],absent:[],ordered:true},
};
const walls={pair:{ca:9,cb:9},order:{quick:9,slow:1617},cancel:{first:25,second:54},verify:{vet:10,build:618}};
const goodReport=()=>{
 const rep={};
 for(const [n,w] of Object.entries(wants)){
  const results=Object.entries(walls[n]).map(([k,ms])=>({name:k,status:k==='second'?-1:w.names.find(x=>x.name===k).status,wall_ms:ms}));
  const lines=w.names.map(x=>{const s=Math.floor((walls[n][x.name]+500)/1000);return x.status===0?`kogen: ${x.name} passed (${s} s)`:`kogen: ${x.name} failed, exit ${x.status} (${s} s)`;});
  rep[n]={lines,results,error:''};
 }
 return rep;
};
function controls(bad){
 const good=goodReport();
 for(const n of Object.keys(wants))observe(good,n,wants[n]);
 if(!bad)return;
 const mutations=[
  ['pair',x=>{x.pair.lines=[];}],
  ['pair',x=>{x.pair.lines=['kogen: cohort passed (0 s)'];}],
  ['pair',x=>{x.pair.lines=[x.pair.lines[0]];}],
  ['pair',x=>{x.pair.lines[1]='kogen: cb passed (0 s)';}],
  ['order',x=>{x.order.lines.reverse();}],
  ['order',x=>{x.order.lines[1]='kogen: slow passed (1 s)';}],
  ['cancel',x=>{x.cancel.lines.push('kogen: second failed, exit -1 (0 s)');}],
  ['cancel',x=>{x.cancel.lines.push('kogen: second passed (0 s)');}],
  ['cancel',x=>{x.cancel.lines=[];}],
  ['verify',x=>{x.verify.lines.reverse();}],
  ['verify',x=>{x.verify.lines.pop();}],
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
   scratch=fs.mkdtempSync(path.join(os.tmpdir(),'cohort-elapsed-acceptance-'));
   for(const e of fs.readdirSync(process.cwd()))if(!['.git','node_modules'].includes(e))fs.cpSync(path.join(process.cwd(),e),path.join(scratch,e),{recursive:true,filter:src=>path.basename(src)!=='node_modules'});
   fs.writeFileSync(path.join(scratch,'verify/cohort_elapsed_driver_test.go'),driver);
   const report=path.join(scratch,'cohort-elapsed-report.json');
   const command='go test ./verify -run ^TestCohortElapsedDriver$ -count=1 -v -timeout=100s';
   const r=await new Promise(resolve=>{
    const child=cp.spawn('go',['test','./verify','-run','^TestCohortElapsedDriver$','-count=1','-v','-timeout=100s'],{cwd:scratch,env:{...process.env,COHORT_ELAPSED_REPORT:report}});
    let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});
    child.on('error',e=>resolve({status:null,out:out+String(e)}));child.on('close',status=>resolve({status,out}));
   });
   assert.equal(r.status,0,`TestCohortElapsedDriver via ${command}: exit ${r.status}\n${r.out}`);
   assert.match(r.out,/--- PASS: TestCohortElapsedDriver /,`TestCohortElapsedDriver via ${command} was absent, skipped or ran zero times (exit ${r.status})\n${r.out}`);
   assert.ok(fs.existsSync(report),`TestCohortElapsedDriver via ${command} passed but wrote no report`);
   return JSON.parse(fs.readFileSync(report,'utf8'));
  })();
  return pending;
 }
 When('verify-pass-lines-cohort-elapsed: the cohort runs of fake commands have run',{timeout:115000},async function(){this.cohortElapsedReport=await runDriver();});
 Then('verify-pass-lines-cohort-elapsed: the {string} cohort progress lines match:',function(name,text){observe(this.cohortElapsedReport,name,JSON.parse(text));});
 AfterAll(()=>{if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
}
