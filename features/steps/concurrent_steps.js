'use strict';
const {When,Then,AfterAll} = require('@cucumber/cucumber');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const {observe} = require('./concurrent_observer.cjs');
let scratch;
function prepare() {
 if (scratch) return scratch;
 scratch=fs.mkdtempSync(path.join(os.tmpdir(),'concurrent-acceptance-'));
 // Never modify the candidate: overlay the submitted driver at an absent test
 // path in an independent copy, preserving the project's existing test helpers.
 for (const entry of fs.readdirSync(process.cwd())) {
  if (entry === '.git' || entry === 'node_modules') continue;
  fs.cpSync(path.join(process.cwd(),entry),path.join(scratch,entry),{recursive:true});
 }
 fs.copyFileSync(path.join(process.cwd(),'features/steps/testdata/concurrent/driver.go'),path.join(scratch,'verify/concurrent_intent_driver_test.go'));
 return scratch;
}
When('a synthetic verification pass exercises concurrent checks in mode {string}', {timeout:120000}, function(mode) {
 const root=prepare();
 const report=path.join(root,'concurrent-report.json');
 fs.rmSync(report,{force:true});
 const r=cp.spawnSync('go',['test','./verify','-run','^TestConcurrentIntentDriver$','-count=1','-timeout=45s'],{cwd:root,env:{...process.env,CONCURRENT_CASE:mode,CONCURRENT_REPORT:report},encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
 assert.equal(r.status,0,`TestConcurrentIntentDriver via go test ./verify: outcome ${r.status}, ${r.error || ''}\n${r.stdout}\n${r.stderr}`);
 assert.ok(fs.existsSync(report),'TestConcurrentIntentDriver via go test ./verify must emit its report (not an absent, skipped or zero-run test)');
 this.concurrentReport=JSON.parse(fs.readFileSync(report,'utf8'));
});
Then('the concurrent pass has these exact observations:',function(text){observe(this.concurrentReport,JSON.parse(text));});
AfterAll(function(){if(scratch)fs.rmSync(scratch,{recursive:true,force:true});});
