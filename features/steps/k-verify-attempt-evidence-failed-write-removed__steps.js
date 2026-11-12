'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
// The Go driver uses only symbols that exist today (NewAttempt, run, Refuse). The write failure is
// injected with a file-size resource limit (RLIMIT_FSIZE) so that writing the record fails with EFBIG.
const driver=String.raw`package verify

import (
	"context"
	"encoding/json"
	"io/fs"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/KogenAI/kogen-loop/sys"
)

func driverRefuse(t *testing.T, root string, fsize uint64) string {
	t.Helper()
	s := sys.NewWith(os.Environ(), root)
	a := NewAttempt(root, "demo", nil)
	a.timeout = 300 * time.Millisecond
	ctx := a.Into(context.Background())
	_, err := run(withStep(ctx, "setup-1", "setup"), s, Tools{}, "echo blocked >&2; sleep 30 & wait", root, nil)
	var old syscall.Rlimit
	if fsize > 0 {
		signal.Ignore(syscall.SIGXFSZ)
		if err := syscall.Getrlimit(syscall.RLIMIT_FSIZE, &old); err != nil {
			t.Fatal(err)
		}
		if err := syscall.Setrlimit(syscall.RLIMIT_FSIZE, &syscall.Rlimit{Cur: fsize, Max: old.Max}); err != nil {
			t.Fatal(err)
		}
	}
	ref := a.Refuse(err)
	if fsize > 0 {
		if err := syscall.Setrlimit(syscall.RLIMIT_FSIZE, &old); err != nil {
			t.Fatal(err)
		}
	}
	e, ok := sys.AsError(ref)
	if !ok {
		t.Fatalf("not a refusal: %v", ref)
	}
	return e.Render()
}

func driverList(base, earlier string, withMode bool) []string {
	out := []string{}
	filepath.WalkDir(base, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, _ := filepath.Rel(filepath.Dir(base), p)
		parts := strings.Split(rel, "/")
		if len(parts) > 1 && strings.HasPrefix(parts[1], "demo-") {
			if parts[1] == earlier {
				parts[1] = "EARLIER"
			} else {
				parts[1] = "NEW"
			}
			rel = strings.Join(parts, "/")
		}
		kind := "file"
		if d.IsDir() {
			kind = "dir"
		}
		line := rel + " " + kind
		if withMode {
			info, _ := d.Info()
			v := uint32(info.Mode().Perm())
			line += " " + string([]byte{'0' + byte((v>>6)&7), '0' + byte((v>>3)&7), '0' + byte(v&7)})
		}
		out = append(out, line)
		return nil
	})
	sort.Strings(out)
	return out
}

func TestAttemptEvidenceDriver(t *testing.T) {
	out := map[string]any{}
	attempts := func(root string) string { return filepath.Join(root, ".kogen/local/readiness/attempts") }
	for _, c := range []struct {
		name  string
		fsize uint64
	}{{"write-failure", 64}, {"success", 0}} {
		root := t.TempDir()
		driverRefuse(t, root, 0)
		dirs, _ := os.ReadDir(attempts(root))
		earlier := dirs[0].Name()
		before, _ := os.ReadFile(filepath.Join(attempts(root), earlier, "attempt.json"))
		text := driverRefuse(t, root, c.fsize)
		after, _ := os.ReadFile(filepath.Join(attempts(root), earlier, "attempt.json"))
		valid, found := true, false
		filepath.WalkDir(attempts(root), func(p string, d fs.DirEntry, err error) error {
			if err == nil && !d.IsDir() && !strings.Contains(p, earlier) {
				found = true
				b, _ := os.ReadFile(p)
				var v any
				valid = valid && json.Unmarshal(b, &v) == nil
			}
			return nil
		})
		out[c.name] = map[string]any{
			"entries":           driverList(attempts(root), earlier, true),
			"earlier_ok":        string(before) == string(after),
			"retained_lines":    strings.Count(text, "Evidence not retained"),
			"text":              text,
			"new_record_parses": found && valid,
		}
	}
	// A failure to create the attempt folder: a regular file stands where the attempts area would be.
	root := t.TempDir()
	readiness := filepath.Join(root, ".kogen/local/readiness")
	if err := os.MkdirAll(readiness, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(readiness, "attempts"), []byte("blocker"), 0o600); err != nil {
		t.Fatal(err)
	}
	text := driverRefuse(t, root, 0)
	out["folder-failure"] = map[string]any{
		"entries":        driverList(readiness, "", false),
		"retained_lines": strings.Count(text, "Evidence not retained"),
		"text":           text,
	}
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("ATTEMPT_EVIDENCE_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;
function entries(report,name,want){
 const r=report[name];
 assert.ok(r,'case '+name+' missing from the TestAttemptEvidenceDriver report');
 assert.deepEqual(r.entries,want,name+': entries left in the attempts area');
}
function notRetained(report,name,cause){
 const r=report[name];
 assert.ok(r,'case '+name+' missing');
 assert.equal(r.retained_lines,1,name+': "Evidence not retained" lines');
 const line=r.text.split('\n').find(l=>l.includes('Evidence not retained'));
 assert.ok(line.includes(cause),name+': line '+JSON.stringify(line)+' does not name '+cause);
 assert.ok(!r.text.includes('Evidence: '),name+': refusal names retained evidence');
}
function earlier(report,name){assert.equal(report[name].earlier_ok,true,name+': earlier attempt record changed');}
function parses(report,name){assert.equal(report[name].new_record_parses,true,name+': the new record does not parse as JSON');}
if(require.main===module){
 const bad=process.argv[2]==='bad';
 try{
  const want=['attempts dir 700','attempts/EARLIER dir 700','attempts/EARLIER/attempt.json file 600'];
  const good={'write-failure':{entries:[...want],retained_lines:1,text:'Evidence not retained: write x: file too large',earlier_ok:true}};
  entries(good,'write-failure',want);notRetained(good,'write-failure','file too large');earlier(good,'write-failure');
  if(bad){
   const x=structuredClone(good);x['write-failure'].entries.push('attempts/NEW dir 700');
   assert.throws(()=>entries(x,'write-failure',want));
   const y=structuredClone(good);y['write-failure'].retained_lines=2;assert.throws(()=>notRetained(y,'write-failure','file too large'));
   const z=structuredClone(good);z['write-failure'].text='Evidence not retained: boom';assert.throws(()=>notRetained(z,'write-failure','file too large'));
   const w=structuredClone(good);w['write-failure'].earlier_ok=false;assert.throws(()=>earlier(w,'write-failure'));
  }
  console.log(bad?'bad controls rejected':'good controls accepted');process.exitCode=bad?1:0;
 }catch(e){console.error(e);process.exitCode=2;}
}else{
 const {When,Then,AfterAll}=require('@cucumber/cucumber');
 const P='k-verify-attempt-evidence-failed-write-removed: ';
 let scratch,pending;
 function runDriver(){
  if(!pending)pending=(async()=>{
   scratch=fs.mkdtempSync(path.join(os.tmpdir(),'attempt-evidence-acceptance-'));
   for(const e of fs.readdirSync(process.cwd()))if(!['.git','node_modules'].includes(e))fs.cpSync(path.join(process.cwd(),e),path.join(scratch,e),{recursive:true,filter:src=>path.basename(src)!=='node_modules'});
   fs.writeFileSync(path.join(scratch,'verify/attempt_evidence_driver_test.go'),driver);
   const report=path.join(scratch,'attempt-evidence-report.json');
   const command='go test ./verify -run ^TestAttemptEvidenceDriver$ -count=1 -v -timeout=100s';
   const r=await new Promise(resolve=>{
    const child=cp.spawn('go',['test','./verify','-run','^TestAttemptEvidenceDriver$','-count=1','-v','-timeout=100s'],{cwd:scratch,env:{...process.env,ATTEMPT_EVIDENCE_REPORT:report}});
    let out='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{out+=d;});
    child.on('error',e=>resolve({status:null,out:out+String(e)}));child.on('close',status=>resolve({status,out}));
   });
   assert.equal(r.status,0,'TestAttemptEvidenceDriver via '+command+': exit '+r.status+'\n'+r.out);
   assert.match(r.out,/--- PASS: TestAttemptEvidenceDriver /,'TestAttemptEvidenceDriver via '+command+' was absent, skipped or ran zero times\n'+r.out);
   return JSON.parse(fs.readFileSync(report,'utf8'));
  })();
  return pending;
 }
 When(P+'the evidence of refused attempts has been retained with injected failures',{timeout:115000},async function(){this.rep=await runDriver();});
 Then(P+'the {string} case leaves exactly these entries:',function(name,text){entries(this.rep,name,JSON.parse(text));});
 Then(P+'the {string} refusal has one "Evidence not retained" line naming {string}',function(name,cause){notRetained(this.rep,name,cause);});
 Then(P+'the {string} case leaves the earlier attempt untouched',function(name){earlier(this.rep,name);});
 Then(P+'the {string} case record parses as JSON',function(name){parses(this.rep,name);});
 AfterAll(()=>{if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
}
