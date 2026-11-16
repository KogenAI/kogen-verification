'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
// The driver is a Go test run in a scratch copy of the checkout. For each case it checks a
// fixture Intent for readiness, removes the record, changes the checkout (or passes no result)
// and calls RecordPass; it writes what the refusal and the record directory show.
const driver=String.raw`package verify

import (
	"context"
	"encoding/json"
	"os"
	"testing"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

func TestReadinessRefusalDriver(t *testing.T) {
	cases := []struct {
		key      string
		change   func(p *proj)
		nilReady bool
	}{
		{"candidate-tree", func(p *proj) { p.write("extra.txt", "x") }, false},
		{"head", func(p *proj) { p.git("commit", "--allow-empty", "-qm", "External HEAD change") }, false},
		{"several", func(p *proj) {
			p.write(project.FeaturePath(fixtureSlug), fixtureFeature+"  Scenario: Third\n    Then the candidate succeeds\n")
		}, false},
		{"nil", func(p *proj) {}, true},
	}
	out := map[string]any{}
	for _, c := range cases {
		t.Run(c.key, func(t *testing.T) {
			isolateTmp(t)
			p := newProj(t)
			r := p.readiness()
			s, _ := p.session()
			ready, err := r.Check(context.Background(), s, fixtureSlug)
			if err != nil {
				t.Fatal(err)
			}
			os.Remove(readinessPath(p.Root, fixtureSlug))
			if c.nilReady {
				ready = nil
			}
			c.change(p)
			err = r.RecordPass(s, fixtureSlug, ready)
			e, refused := sys.AsError(err)
			rec := map[string]any{"refused": refused, "error": ""}
			if err != nil {
				rec["error"] = err.Error()
			}
			lines := []string{}
			if refused {
				lines = append(lines, e.Lines...)
				rec["class"], rec["reason"], rec["detail"], rec["exit"] = e.Class, e.Reason, e.Detail, e.Exit
			}
			rec["lines"] = lines
			_, rec["record"] = p.readinessRecord()
			out[c.key] = rec
		})
	}
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("REFUSAL_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;
const NEXT='next: stop whatever changed the checkout while Kogen was checking, then rerun the command that was refused';
const FIRST='readiness inputs changed during checking or publication';
const DETAIL='the Intent is not ready to build';
const cases={
 'an unrelated new file':'candidate-tree',
 'an empty commit':'head',
 'an extra scenario in the feature file':'several',
};
function entry(report,key){const r=report[key];assert.ok(r,`case ${key} missing from the TestReadinessRefusalDriver report`);return r;}
function observeShape(report,key,want){
 const r=entry(report,key);
 assert.equal(r.refused,true,`${key}: RecordPass was not refused (error: ${r.error})`);
 assert.deepEqual([r.class,r.reason,r.exit,r.detail],[want.class,want.reason,want.exit,want.detail],`${key}: class, reason, exit and detail`);
}
function observeNoRecord(report,key){assert.equal(entry(report,key).record,false,`${key}: a readiness record was published`);}
function observeLines(report,key,want){assert.deepEqual(entry(report,key).lines,want,`${key}: refusal lines`);}
const shape={class:'intent',reason:'not_ready',exit:1,detail:DETAIL};
const lines={
 'candidate-tree':[FIRST,'changed: candidate tree',NEXT],
 head:[FIRST,'changed: HEAD',NEXT],
 several:[FIRST,'changed: baseline contents, candidate tree',NEXT],
 nil:[FIRST],
};
function controls(bad){
 const good={};
 for(const k of Object.keys(lines))good[k]={refused:true,error:'x',class:'intent',reason:'not_ready',exit:1,detail:DETAIL,lines:[...lines[k]],record:false};
 for(const k of Object.keys(lines)){observeShape(good,k,shape);observeNoRecord(good,k);observeLines(good,k,lines[k]);}
 if(!bad)return;
 const mutations=[
  ['candidate-tree',x=>x['candidate-tree'].lines=[FIRST,'changed: baseline files, baseline contents, HEAD, candidate tree, feasibility evidence',NEXT],'lines'],
  ['head',x=>x.head.lines=[FIRST,'changed: candidate tree',NEXT],'lines'],
  ['several',x=>x.several.lines=[FIRST,'changed: baseline contents',NEXT],'lines'],
  ['several',x=>x.several.lines=[FIRST,'changed: candidate tree, baseline contents',NEXT],'lines'],
  ['candidate-tree',x=>x['candidate-tree'].lines=[FIRST,'changed: candidate tree'],'lines'],
  ['nil',x=>x.nil.lines=[FIRST,'changed: candidate tree',NEXT],'lines'],
  ['head',x=>x.head.reason='lint','shape'],
  ['head',x=>x.head.exit=3,'shape'],
  ['head',x=>x.head.detail='readiness inputs changed during publication','shape'],
  ['head',x=>x.head.refused=false,'shape'],
  ['head',x=>x.head.record=true,'record'],
  ['nil',x=>delete x.nil,'lines'],
 ];
 for(const [k,mutate,kind] of mutations){
  const x=structuredClone(good);mutate(x);
  const f=kind==='lines'?()=>observeLines(x,k,lines[k]):kind==='shape'?()=>observeShape(x,k,shape):()=>observeNoRecord(x,k);
  assert.throws(f,undefined,`mutation of ${k} (${kind}) was accepted`);
 }
}
if(require.main===module){
 const bad=process.argv[2]==='bad';
 try{controls(bad);console.log(bad?'bad controls rejected':'good controls accepted');process.exitCode=bad?1:0;}catch(e){console.error(e);process.exitCode=2;}
}else{
 const {When,Then,AfterAll}=require('@cucumber/cucumber');
 let scratch,pending;
 function runDriver(){
  if(!pending)pending=(async()=>{
   scratch=fs.mkdtempSync(path.join(os.tmpdir(),'refusal-acceptance-'));
   for(const e of fs.readdirSync(process.cwd()))if(!['.git','node_modules'].includes(e))fs.cpSync(path.join(process.cwd(),e),path.join(scratch,e),{recursive:true,filter:src=>path.basename(src)!=='node_modules'});
   fs.writeFileSync(path.join(scratch,'verify/readiness_refusal_driver_test.go'),driver);
   const report=path.join(scratch,'refusal-report.json');
   const command='go test ./verify -run ^TestReadinessRefusalDriver$ -count=1 -v -timeout=100s';
   const r=await new Promise(resolve=>{
    const child=cp.spawn('go',['test','./verify','-run','^TestReadinessRefusalDriver$','-count=1','-v','-timeout=100s'],{cwd:scratch,env:{...process.env,REFUSAL_REPORT:report}});
    let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});
    child.on('error',e=>resolve({status:null,out:out+String(e)}));child.on('close',status=>resolve({status,out}));
   });
   assert.equal(r.status,0,`TestReadinessRefusalDriver via ${command}: exit ${r.status}\n${r.out}`);
   assert.match(r.out,/--- PASS: TestReadinessRefusalDriver /,`TestReadinessRefusalDriver via ${command} was absent, skipped or ran zero times (exit ${r.status})\n${r.out}`);
   assert.ok(fs.existsSync(report),`TestReadinessRefusalDriver via ${command} passed but wrote no report`);
   return JSON.parse(fs.readFileSync(report,'utf8'));
  })();
  return pending;
 }
 const key=name=>{const k=cases[name];assert.ok(k,`unknown change ${name}`);return k;};
 When('readiness-refusal-names-changed-inputs: RecordPass runs after {string} changed the checkout',{timeout:115000},async function(name){this.refusalKey=key(name);this.refusalReport=await runDriver();});
 When('readiness-refusal-names-changed-inputs: RecordPass runs with no readiness result',{timeout:115000},async function(){this.refusalKey='nil';this.refusalReport=await runDriver();});
 Then('readiness-refusal-names-changed-inputs: the refusal has class {string}, reason {string}, exit {int} and detail {string}',function(c,r,e,d){observeShape(this.refusalReport,this.refusalKey,{class:c,reason:r,exit:e,detail:d});});
 Then('readiness-refusal-names-changed-inputs: no readiness record is published',function(){observeNoRecord(this.refusalReport,this.refusalKey);});
 Then('readiness-refusal-names-changed-inputs: the refusal lines are:',function(text){observeLines(this.refusalReport,this.refusalKey,JSON.parse(text));});
 AfterAll(()=>{if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
}
