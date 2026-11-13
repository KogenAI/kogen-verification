'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
// The Go driver uses only symbols that exist today (NewAttempt, Observe, Refuse, retainPass, started).
// Attempt start times are set explicitly so that "oldest" and "newest" are deterministic.
const driver=String.raw`package verify

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
)

type driverRun struct {
	root    string
	base    time.Time
	ids     []string
	records map[string]string
	texts   []string
}

func (d *driverRun) dir() string { return filepath.Join(d.root, ".kogen/local/readiness/attempts") }

func (d *driverRun) names() map[string]bool {
	out := map[string]bool{}
	es, _ := os.ReadDir(d.dir())
	for _, e := range es {
		out[e.Name()] = true
	}
	return out
}

// attempt retains the i-th attempt, refused or passed, and returns the refusal text ("" for a pass).
func (d *driverRun) attempt(t *testing.T, i int, refused bool) string {
	t.Helper()
	before := d.names()
	a := NewAttempt(d.root, "demo", nil)
	a.started = d.base.Add(time.Duration(i) * time.Minute)
	text := ""
	if refused {
		boom := sys.Fail("environment", "boom", "boom", 1)
		_ = a.Observe("setup-1", "setup", func() error { return boom })
		e, ok := sys.AsError(a.Refuse(boom))
		if !ok {
			t.Fatalf("attempt %d: not a refusal", i)
		}
		text = e.Render()
	} else {
		_ = a.Observe("setup-1", "setup", func() error { return nil })
		a.retainPass()
	}
	id := ""
	for n := range d.names() {
		if !before[n] {
			id = n
		}
	}
	if id == "" {
		t.Fatalf("attempt %d retained no new folder", i)
	}
	d.ids = append(d.ids, id)
	b, _ := os.ReadFile(filepath.Join(d.dir(), id, "attempt.json"))
	d.records[id] = string(b)
	d.texts = append(d.texts, text)
	return text
}

func (d *driverRun) report(t *testing.T) map[string]any {
	index := map[string]int{}
	for i, id := range d.ids {
		index[id] = i
	}
	remaining := []int{}
	identical, modesOK := true, true
	es, _ := os.ReadDir(d.dir())
	strays := []string{}
	for _, e := range es {
		i, ok := index[e.Name()]
		if !ok {
			strays = append(strays, e.Name())
			continue
		}
		remaining = append(remaining, i)
		fi, _ := os.Stat(filepath.Join(d.dir(), e.Name()))
		ri, err := os.Stat(filepath.Join(d.dir(), e.Name(), "attempt.json"))
		if err != nil || fi.Mode().Perm() != 0o700 || ri.Mode().Perm() != 0o600 {
			modesOK = false
		}
		b, _ := os.ReadFile(filepath.Join(d.dir(), e.Name(), "attempt.json"))
		if string(b) != d.records[e.Name()] {
			identical = false
		}
	}
	sort.Ints(remaining)
	sort.Strings(strays)
	return map[string]any{"remaining": remaining, "identical": identical, "modes_ok": modesOK, "strays": strays, "ids": d.ids}
}

func newRun(t *testing.T) *driverRun {
	return &driverRun{root: t.TempDir(), base: time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC), records: map[string]string{}}
}

func TestAttemptPruneDriver(t *testing.T) {
	out := map[string]any{}
	mixed := func(i int) bool { return i >= 5 && (i%3 == 0 || i == 24) }

	d := newRun(t)
	for i := 0; i < 25; i++ {
		d.attempt(t, i, mixed(i))
	}
	r := d.report(t)
	r["newest_refusal_present"] = strings.Contains(d.records[d.ids[24]], "\"outcome\": \"refused\"") || strings.Contains(d.records[d.ids[24]], "\"outcome\":\"refused\"")
	out["mixed"] = r

	d = newRun(t)
	for i := 0; i < 10; i++ {
		d.attempt(t, i, mixed(i+5))
	}
	out["ten"] = d.report(t)

	d = newRun(t)
	if err := os.MkdirAll(d.dir(), 0o700); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(d.dir(), "stray-file"), []byte("x"), 0o600)
	os.MkdirAll(filepath.Join(d.dir(), "stray-folder"), 0o700)
	os.WriteFile(filepath.Join(d.dir(), "stray-folder", "other.json"), []byte("x"), 0o600)
	for i := 0; i < 25; i++ {
		d.attempt(t, i, mixed(i))
	}
	out["strays"] = d.report(t)

	d = newRun(t)
	for i := 0; i < 25; i++ {
		d.attempt(t, i, i == 0)
	}
	out["passed-first"] = d.report(t)

	d = newRun(t)
	for i := 0; i < 20; i++ {
		d.attempt(t, i, i%4 == 1)
	}
	locked := filepath.Join(d.dir(), d.ids[0])
	if err := os.Chmod(locked, 0o500); err != nil {
		t.Fatal(err)
	}
	text := d.attempt(t, 20, true)
	os.Chmod(locked, 0o700)
	r = d.report(t)
	notes := []string{}
	for _, l := range strings.Split(text, "\n") {
		if strings.Contains(l, "Old evidence not removed:") {
			notes = append(notes, l)
		}
	}
	r["notes"] = notes
	r["locked"] = d.ids[0]
	r["text"] = text
	r["evidence_line"] = strings.Contains(text, "Evidence: ") && !strings.Contains(text, "Evidence not retained")
	out["undeletable"] = r

	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("ATTEMPT_PRUNE_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
	_ = fmt.Sprint
}
`;
function range(a,b){const o=[];for(let i=a;i<=b;i++)o.push(i);return o;}
function get(rep,name){assert.ok(rep[name],'case '+name+' missing from the TestAttemptPruneDriver report');return rep[name];}
function remaining(rep,name,want){assert.deepEqual(get(rep,name).remaining,want,name+': attempt indexes (0 = oldest) of the folders that remain');}
function identical(rep,name){assert.equal(get(rep,name).identical,true,name+': a remaining record differs from the bytes written when it was retained');}
function newestRefusal(rep,name){assert.equal(get(rep,name).newest_refusal_present,true,name+': the newest refusal record is missing');}
function strays(rep,name){assert.deepEqual(get(rep,name).strays,['stray-file','stray-folder'],name+': stray entries in the attempts area');}
function modes(rep,name){assert.equal(get(rep,name).modes_ok,true,name+': a folder is not 0700 or a record is not 0600');}
function undeletable(rep,name){
 const r=get(rep,name);
 assert.equal(r.notes.length,1,name+': one-line notes naming a folder: '+JSON.stringify(r.notes)+'\n'+r.text);
 assert.ok(r.notes[0].includes(r.locked),name+': note '+JSON.stringify(r.notes[0])+' does not name '+r.locked);
 assert.equal(r.evidence_line,true,name+': refusal lost its Evidence line or reports Evidence not retained\n'+r.text);
}
if(require.main===module){
 const bad=process.argv[2]==='bad';
 try{
  const good={m:{remaining:range(5,24),identical:true,newest_refusal_present:true,strays:['stray-file','stray-folder'],modes_ok:true,notes:['Old evidence not removed: X: denied'],locked:'X',text:'',evidence_line:true}};
  remaining(good,'m',range(5,24));identical(good,'m');newestRefusal(good,'m');strays(good,'m');modes(good,'m');undeletable(good,'m');
  if(bad){
   const f=(fn,mut)=>{const x=structuredClone(good);mut(x.m);assert.throws(()=>fn(x,'m'));};
   f((x,n)=>remaining(x,n,range(5,24)),m=>{m.remaining=range(0,24);});
   f(identical,m=>{m.identical=false;});
   f(newestRefusal,m=>{m.newest_refusal_present=false;});
   f(strays,m=>{m.strays=['stray-file'];});
   f(modes,m=>{m.modes_ok=false;});
   f(undeletable,m=>{m.notes=[];});
   f(undeletable,m=>{m.notes=['Old evidence not removed: Y: denied'];});
   f(undeletable,m=>{m.evidence_line=false;});
  }
  console.log(bad?'bad controls rejected':'good controls accepted');process.exitCode=bad?1:0;
 }catch(e){console.error(e);process.exitCode=2;}
}else{
 const {When,Then,AfterAll}=require('@cucumber/cucumber');
 const P='k-verify-attempt-evidence-pruned: ';
 let scratch,pending;
 function runDriver(){
  if(!pending)pending=(async()=>{
   scratch=fs.mkdtempSync(path.join(os.tmpdir(),'attempt-prune-acceptance-'));
   for(const e of fs.readdirSync(process.cwd()))if(!['.git','node_modules'].includes(e))fs.cpSync(path.join(process.cwd(),e),path.join(scratch,e),{recursive:true,filter:src=>path.basename(src)!=='node_modules'});
   fs.writeFileSync(path.join(scratch,'verify/attempt_prune_driver_test.go'),driver);
   const report=path.join(scratch,'attempt-prune-report.json');
   const command='go test ./verify -run ^TestAttemptPruneDriver$ -count=1 -v -timeout=100s';
   const r=await new Promise(resolve=>{
    const child=cp.spawn('go',['test','./verify','-run','^TestAttemptPruneDriver$','-count=1','-v','-timeout=100s'],{cwd:scratch,env:{...process.env,ATTEMPT_PRUNE_REPORT:report}});
    let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});
    child.on('error',e=>resolve({status:null,out:out+String(e)}));child.on('close',status=>resolve({status,out}));
   });
   assert.equal(r.status,0,'TestAttemptPruneDriver via '+command+': exit '+r.status+'\n'+r.out);
   assert.match(r.out,/--- PASS: TestAttemptPruneDriver /,'TestAttemptPruneDriver via '+command+' was absent, skipped or ran zero times\n'+r.out);
   return JSON.parse(fs.readFileSync(report,'utf8'));
  })();
  return pending;
 }
 When(P+'attempts have been retained in temporary checkouts',{timeout:115000},async function(){this.rep=await runDriver();});
 Then(P+'the {string} case keeps exactly the attempts numbered {int} to {int}, 0 being the oldest',function(n,a,b){remaining(this.rep,n,range(a,b));});
 Then(P+'the {string} case keeps exactly these attempts, 0 being the oldest: {string}',function(n,l){remaining(this.rep,n,JSON.parse('['+l+']'));});
 Then(P+'the {string} case keeps every record byte-identical to when it was retained',function(n){identical(this.rep,n);});
 Then(P+'the {string} case keeps the newest refusal record',function(n){newestRefusal(this.rep,n);});
 Then(P+'the {string} case keeps the stray file and the stray folder',function(n){strays(this.rep,n);});
 Then(P+'the {string} case keeps folders at 0700 and records at 0600',function(n){modes(this.rep,n);});
 Then(P+'the {string} case still refuses with its evidence and one note naming the undeletable folder',function(n){undeletable(this.rep,n);});
 Then(P+'the {string} case keeps all 21 folders',function(n){remaining(this.rep,n,range(0,20));});
 AfterAll(()=>{if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
}
