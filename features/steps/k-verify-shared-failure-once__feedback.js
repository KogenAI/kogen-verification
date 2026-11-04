const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
function check(r, mode) {
  assert.equal(r.before, r.after, 'feedback must not mutate the pass record');
  if (mode === 'shared' || mode === 'normalized') {
    assert.equal(r.feedback.split('no such file: out.txt').length - 1, 1);
    assert.ok(r.feedback.includes('12 scenarios'));
    for (let i = 1; i <= 5; i++) assert.ok(r.feedback.includes(`case-${i}:`));
    assert.ok(!r.feedback.includes('case-6:'));
    assert.ok(r.feedback.includes('different message'));
    assert.ok(r.feedback.indexOf('no such file: out.txt') < r.feedback.indexOf('different message'));
  } else if (mode === 'bounded') {
    assert.ok(Buffer.byteLength(r.feedback) <= 16384);
    assert.match(r.feedback, /left out [1-9][0-9]* items.*[0-9]+ bytes[^\n]*$/);
    const prefix = r.feedback.slice(0, r.feedback.lastIndexOf('\n'));
    assert.ok(r.control.startsWith(prefix + '\n'), 'only complete original lines may precede omission notice');
  } else assert.equal(r.feedback, r.control);
}
if (process.argv[2] === '--control') {
  const good = {before:'record', after:'record', feedback:'shared no such file: out.txt; 12 scenarios: case-1:, case-2:, case-3:, case-4:, case-5:\ndifferent message', control:''};
  if (process.argv[3] === 'bad') good.after = 'changed';
  try { for (const mode of ['shared','normalized']) check(good, mode); check({before:'x',after:'x',feedback:'same',control:'same'}, 'single'); check({before:'x',after:'x',feedback:'header\nleft out 400 items, 80000 bytes',control:'header\nmore\n'}, 'bounded'); console.log('accepted'); }
  catch (_) { console.log('rejected'); process.exitCode = 1; }
} else {
  const { Then } = require('@cucumber/cucumber');
  Then('k-verify-shared-failure-once: feedback satisfies {string}', function(mode) {
    const dir = fs.mkdtempSync(path.join(process.cwd(), '.feedback-driver-'));
    try {
      fs.writeFileSync(path.join(dir, 'main.go'), source);
      const out = cp.spawnSync('go', ['run', './'+path.basename(dir), mode], {encoding:'utf8', timeout:120000});
      assert.equal(out.status, 0, out.stderr + out.stdout);
      check(JSON.parse(out.stdout), mode);
    } finally { fs.rmSync(dir, {recursive:true,force:true}); }
  });
}
const source = `package main
import("encoding/json";"fmt";"os";"strings"; v "github.com/KogenAI/kogen-verification/verify")
func main(){
 mode:=os.Args[1]; n:=13; if mode=="single" {n=1}; if mode=="bounded" {n=400}
 a:=&v.Acceptance{Status:1}; parts:=[]string{"Verification pass 1 is not green. Fix the implementation (the approved acceptance files cannot change), then call finish again.","acceptance (stub): failed, exit status 1"}
 for i:=1;i<=n;i++ {name:=fmt.Sprintf("case-%d:",i); detail:="no such file: out.txt"; if mode=="distinct" {detail=fmt.Sprintf("distinct %d",i)}; if mode=="bounded" {detail=fmt.Sprintf("%04d",i)+strings.Repeat("x",196)}; if (mode=="shared" || mode=="normalized") && i==13 {detail="different message"}; if mode=="normalized" && i<13 {detail=fmt.Sprintf("  no such file: out.txt\\n%s (line %d)  ",name,100+i)}
 a.Scenarios=append(a.Scenarios,v.ScenarioResult{Name:name,Line:i,Status:"failed",Detail:&detail}); problem:=fmt.Sprintf("failed: %s (line %d): %s",name,i,detail); a.Problems=append(a.Problems,problem); a.Failed++; parts=append(parts,"  "+strings.ReplaceAll(problem,"\\n","\\n  ")) }
 p:=v.Pass{N:1,Clean:true,Green:false,Acceptance:a}; before,_:=json.Marshal(p); feedback:=p.Feedback("stub",""); after,_:=json.Marshal(p)
 json.NewEncoder(os.Stdout).Encode(map[string]string{"before":string(before),"after":string(after),"feedback":feedback,"control":strings.Join(parts,"\\n")})
}
`;
