'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
// The driver runs Execute on real feasibility declarations whose probe disagrees with the
// recorded expectation, in a copy of the checkout, and writes each case's refusal lines.
const driver=String.raw`package verify

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestLeadsActualDriver(t *testing.T) {
	isolateTmp(t)
	pad := " # " + strings.Repeat("padding ", 30)
	wide := strings.Repeat("x", 300)
	out := map[string]any{}
	run := func(name string, files map[string]string, ds ...Declaration) {
		p := newProj(t)
		p.write("in.txt", "input\n")
		for path, body := range files {
			p.write(path, body)
		}
		p.setFeasibility(ds...)
		s, _ := p.session()
		_, err := Execute(context.Background(), s, Tools{}, p.Root, p.Intent, p.Root, nil)
		rec := map[string]any{"error": "", "lines": []string{}}
		if err != nil {
			e := failWith(t, err, "intent", "not_ready")
			rec["error"] = e.Detail
			rec["lines"] = e.Lines
		}
		declared := []map[string]any{}
		for _, d := range ds {
			declared = append(declared, map[string]any{"id": d.ID, "command": d.Checks[0].Command, "exit": d.Checks[0].Exit, "output": d.Checks[0].Output})
		}
		rec["declared"] = declared
		out[name] = rec
	}
	run("boom", nil, capability("boom", "printf 'boom: cannot open file\\n'; exit 2"+pad, 0, wide, "in.txt"))
	run("long", map[string]string{"long.txt": strings.Repeat("abcdéfghi\n", 40)}, capability("long", "cat long.txt; exit 2"+pad, 0, wide, "long.txt"))
	run("silent", nil, capability("silent", "exit 3"+pad, 0, wide, "in.txt"))
	run("match", nil, capability("match", "printf 'ok\\n'"+pad, 0, "ok\n", "in.txt"))
	run("exitonly", nil, capability("exitonly", "printf 'ok\\n'; exit 4"+pad, 0, "ok\n", "in.txt"))
	run("mixed", nil, capability("fine", "printf 'ok\\n'"+pad, 0, "ok\n", "in.txt"), capability("broken", "printf 'bad\\n'; exit 5"+pad, 0, "good\n", "in.txt"))
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("LEADS_ACTUAL_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;
const PREFIX='probes run under a restricted environment';
const LONG='abcdéfghi\n'.repeat(40);
// Cases: what each probe prints and exits with, in the order of the declarations.
const cases={
 boom:[{id:'boom',exit:2,output:'boom: cannot open file\n'}],
 long:[{id:'long',exit:2,output:LONG}],
 silent:[{id:'silent',exit:3,output:''}],
 match:[],
 exitonly:[{id:'exitonly',exit:4,output:'ok\n'}],
 mixed:[{id:'broken',exit:5,output:'bad\n'}],
};
function mismatchLines(report,name){
 const r=report[name];
 assert.ok(r,`case ${name} missing from the TestLeadsActualDriver report`);
 const want=cases[name];
 if(want.length===0){
  assert.equal(r.error,'',`${name}: Execute returned an error although the check matches`);
  assert.deepEqual(r.lines,[],`${name}: lines although the check matches`);
  return [];
 }
 assert.equal(r.error,'declared feasibility evidence failed',`${name}: error detail`);
 return r.lines.filter(l=>!l.startsWith(PREFIX));
}
function lineOf(report,name){
 const lines=mismatchLines(report,name);
 assert.equal(lines.length,1,`${name}: mismatch lines ${JSON.stringify(lines)}`);
 return lines[0];
}
function declaredOf(report,name){return report[name].declared.find(d=>d.id===cases[name][0].id);}
function beginsWith(report,name,summary){
 const line=lineOf(report,name);
 assert.ok(line.startsWith(summary+' '),`${name}: line does not begin with ${JSON.stringify(summary)}: ${line.slice(0,200)}`);
 assert.ok(line.indexOf(summary)>=0&&line.indexOf(summary)<300,`${name}: summary starts after position 300`);
 assert.ok(!summary.includes('\n'),`${name}: summary spans lines`);
 assert.equal(line.split('actual exit ').length-1,1,`${name}: not exactly one summary in the line`);
}
function carries(report,name){
 const line=lineOf(report,name),c=cases[name][0],d=declaredOf(report,name);
 assert.ok(d.command.length>200,`${name}: probe command is not over 200 characters`);
 const m=/^actual exit \d+: .*? \(expected exit \d+\) /.exec(line);
 assert.ok(m,`${name}: no summary at the start of the line`);
 const rest=line.slice(m[0].length),head=`${c.id}/support: expected `;
 assert.ok(rest.startsWith(head),`${name}: the existing text does not follow the summary: ${rest.slice(0,80)}`);
 const at=rest.indexOf('; actual ');
 assert.ok(at>0,`${name}: no "; actual " in the line`);
 assert.deepEqual(JSON.parse(rest.slice(head.length,at)),{name:'support',command:d.command,exit:d.exit,output:d.output},`${name}: expected object`);
 const actual=JSON.parse(rest.slice(at+'; actual '.length));
 assert.equal(actual.exit,c.exit,`${name}: actual exit`);
 assert.equal(actual.output,c.output,`${name}: actual output`);
}
function firstChars(report,name,n){
 const line=lineOf(report,name),c=cases[name][0];
 const flat=[...c.output.replace(/\n+$/,'').replace(/\n/g,' ')];
 assert.ok(flat.length>n,`${name}: fixture output is not longer than ${n} characters`);
 const summary=`actual exit ${c.exit}: ${flat.slice(0,n).join('')}[cut] (expected exit 0)`;
 assert.ok(line.startsWith(summary+' '),`${name}: line does not begin with ${JSON.stringify(summary)}: ${JSON.stringify(line.slice(0,260))}`);
}
function count(report,name,n){
 const lines=mismatchLines(report,name);
 assert.equal(lines.length,n,`${name}: expected ${n} mismatch line(s), got ${JSON.stringify(lines.map(l=>l.slice(0,60)))}`);
 if(name==='mixed')assert.ok(!lines.some(l=>/fine\/support|expected exit 0\) fine\//.test(l)),`${name}: a line names the matching check`);
}
function goodReport(){
 const rep={};
 const mk=(name,summary,decl)=>{
  const c=cases[name][0];
  const d=decl;
  const exp=JSON.stringify({command:d.command,exit:d.exit,name:'support',output:d.output});
  return `${summary} ${c.id}/support: expected ${exp}; actual ${JSON.stringify({command:d.command,exit:c.exit,output:c.output,timed_out:false})}`;
 };
 const pad=' # '+'padding '.repeat(30),wide='x'.repeat(300);
 const decl=(id,cmd,out)=>({id,command:cmd+pad,exit:0,output:out});
 const dBoom=decl('boom',"printf 'boom: cannot open file\\n'; exit 2",wide),dLong=decl('long','cat long.txt; exit 2',wide),dSilent=decl('silent','exit 3',wide);
 const dFine=decl('fine',"printf 'ok\\n'",'ok\n'),dBroken=decl('broken',"printf 'bad\\n'; exit 5",'good\n');
 const flat=[...LONG.replace(/\n+$/,'').replace(/\n/g,' ')].slice(0,120).join('');
 const restricted=PREFIX+'; caller variables omitted: ';
 rep.boom={error:'declared feasibility evidence failed',lines:[restricted,mk('boom','actual exit 2: boom: cannot open file (expected exit 0)',dBoom)],declared:[dBoom]};
 rep.long={error:'declared feasibility evidence failed',lines:[restricted,mk('long',`actual exit 2: ${flat}[cut] (expected exit 0)`,dLong)],declared:[dLong]};
 rep.silent={error:'declared feasibility evidence failed',lines:[restricted,mk('silent','actual exit 3: (no output) (expected exit 0)',dSilent)],declared:[dSilent]};
 rep.match={error:'',lines:[],declared:[decl('match',"printf 'ok\\n'",'ok\n')]};
 const dEx=decl('exitonly',"printf 'ok\\n'; exit 4",'ok\n');
 rep.exitonly={error:'declared feasibility evidence failed',lines:[mk('exitonly','actual exit 4: ok (expected exit 0)',dEx)],declared:[dEx]};
 rep.mixed={error:'declared feasibility evidence failed',lines:[restricted,mk('mixed','actual exit 5: bad (expected exit 0)',dBroken)],declared:[dFine,dBroken]};
 return rep;
}
function checkAll(rep){
 beginsWith(rep,'boom','actual exit 2: boom: cannot open file (expected exit 0)');carries(rep,'boom');
 firstChars(rep,'long',120);
 beginsWith(rep,'silent','actual exit 3: (no output) (expected exit 0)');
 count(rep,'match',0);
 beginsWith(rep,'exitonly','actual exit 4: ok (expected exit 0)');count(rep,'exitonly',1);
 beginsWith(rep,'mixed','actual exit 5: bad (expected exit 0)');count(rep,'mixed',1);
}
function controls(bad){
 const good=goodReport();
 checkAll(good);
 if(!bad)return;
 const clone=()=>structuredClone(good);
 const text=l=>l[l.length-1];
 const mutations=[
  x=>{const l=x.boom.lines;const s='actual exit 2: boom: cannot open file (expected exit 0) ';l[1]=l[1].slice(s.length)+' '+s.trim();},
  x=>{x.boom.lines[1]='actual exit 2: boom: cannot open file (expected exit 0)';},
  x=>{x.long.lines.splice(1,1,...text(x.long.lines).replace('abcdéfghi abcdéfghi','abcdéfghi\nabcdéfghi').split('\n'));},
  x=>{x.long.lines[1]=x.long.lines[1].replace(/^actual exit 2: .{120}/u,m=>m.slice(0,m.length-20));},
  x=>{x.silent.lines[1]=x.silent.lines[1].replace('(no output)','');},
  x=>{x.mixed.lines.push('actual exit 0: ok (expected exit 0) fine/support: expected {}; actual {}');},
  x=>{x.exitonly.lines.push(x.exitonly.lines[0]);},
 ];
 mutations.forEach((m,i)=>{const x=clone();m(x);assert.throws(()=>checkAll(x),undefined,`mutation ${i} was accepted`);});
}
if(require.main===module){
 const bad=process.argv[2]==='bad';
 try{controls(bad);console.log(bad?'bad controls rejected':'good controls accepted');process.exitCode=bad?1:0;}catch(e){console.error(e);process.exitCode=2;}
}else{
 const {When,Then,AfterAll}=require('@cucumber/cucumber');
 let scratch,pending;
 function runDriver(){
  if(!pending)pending=(async()=>{
   scratch=fs.mkdtempSync(path.join(os.tmpdir(),'leads-actual-acceptance-'));
   for(const e of fs.readdirSync(process.cwd()))if(!['.git','node_modules'].includes(e))fs.cpSync(path.join(process.cwd(),e),path.join(scratch,e),{recursive:true,filter:src=>path.basename(src)!=='node_modules'});
   fs.writeFileSync(path.join(scratch,'verify/leads_actual_driver_test.go'),driver);
   const report=path.join(scratch,'leads-actual-report.json');
   const command='go test ./verify -run ^TestLeadsActualDriver$ -count=1 -v -timeout=100s';
   const r=await new Promise(resolve=>{
    const child=cp.spawn('go',['test','./verify','-run','^TestLeadsActualDriver$','-count=1','-v','-timeout=100s'],{cwd:scratch,env:{...process.env,LEADS_ACTUAL_REPORT:report}});
    let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});
    child.on('error',e=>resolve({status:null,out:out+String(e)}));child.on('close',status=>resolve({status,out}));
   });
   assert.equal(r.status,0,`TestLeadsActualDriver via ${command}: exit ${r.status}\n${r.out}`);
   assert.match(r.out,/--- PASS: TestLeadsActualDriver /,`TestLeadsActualDriver via ${command} was absent, skipped or ran zero times (exit ${r.status})\n${r.out}`);
   assert.ok(fs.existsSync(report),`TestLeadsActualDriver via ${command} passed but wrote no report`);
   return JSON.parse(fs.readFileSync(report,'utf8'));
  })();
  return pending;
 }
 const P='verify-feasibility-line-leads-actual: ';
 When(P+'the feasibility checks with disagreeing probes have run',{timeout:115000},async function(){this.leadsReport=await runDriver();});
 Then(P+'the {string} mismatch line begins with {string}',function(name,summary){beginsWith(this.leadsReport,name,summary);});
 Then(P+'the {string} mismatch line then carries the expected and actual text in full',function(name){carries(this.leadsReport,name);});
 Then(P+'the {string} mismatch line begins with the first {int} characters of the output as one line followed by [cut]',function(name,n){firstChars(this.leadsReport,name,n);});
 Then(P+'the {string} check gives {int} mismatch lines',function(name,n){count(this.leadsReport,name,n);});
 AfterAll(()=>{if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
}
