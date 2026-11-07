'use strict';
const { Given, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
let binary;
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    let output = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    child.on('error', reject);
    child.on('close', code => resolve({code, output}));
  });
}
async function build() {
  if (!binary) binary = (async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kogen-install-contract-'));
    const source = path.join(tmp, 'install_test.go');
    await fs.writeFile(source, String.raw`package verify
import (
 "context"
 "os"
 "path/filepath"
 "strings"
 "testing"
)
func TestBrokenInstallContract(t *testing.T) {
 c := os.Getenv("INSTALL_CONTRACT_CASE")
 cause := os.Getenv("INSTALL_CONTRACT_CAUSE")
 root := t.TempDir()
 node := filepath.Join(root,"node")
 np := filepath.Join(root,"node-path")
 write := func(p,s string, mode os.FileMode) { t.Helper(); if err:=os.MkdirAll(filepath.Dir(p),0755); err!=nil {t.Fatal(err)}; if err:=os.WriteFile(p,[]byte(s),mode); err!=nil {t.Fatal(err)} }
 write(node,"#!/bin/sh\nexit 0\n",0755)
 write(np," \n"+node+"\n ",0644)
 write(filepath.Join(root,"lib/quint/node_modules/@informalsystems/quint/dist/src/cli.js"),"// stub",0644)
 pkg := filepath.Join(root,"lib/cucumber/node_modules/@cucumber/cucumber")
 if err:=os.MkdirAll(pkg,0755); err!=nil {t.Fatal(err)}
 write(filepath.Join(pkg,"package.json"),"{\"name\":\"@cucumber/cucumber\"}",0644)
 switch c {
 case "absent","both-absent": os.Remove(np)
 case "unreadable": os.Chmod(np,0000); defer os.Chmod(np,0644)
 case "empty": os.WriteFile(np,[]byte(" \n\t"),0644)
 case "missing-target": os.Remove(node)
 case "non-executable": os.Chmod(node,0644)
 case "directory": os.Remove(node); os.Mkdir(node,0755)
 }
 if c=="cucumber-absent" || c=="both-absent" {os.RemoveAll(filepath.Join(root,"lib/cucumber"))}
 if c=="cucumber-empty" {os.RemoveAll(pkg)}
 tools:=ToolsFromInstall(root)
 p:=newProj(t)
 trace:=p.trace("acceptance-started")
 p.Config.Acceptance.Run=appendTo(trace,"started")+"; "+p.Config.Acceptance.Run
 r:=p.readiness(); r.Tools=tools
 s,_:=p.session()
 ready,err:=r.Check(context.Background(),s,fixtureSlug)
 if cause=="ready" {
   if err!=nil {t.Fatal(err)}
   if tools.Node!=node {t.Fatalf("KOGEN_NODE = %q, want trimmed %q",tools.Node,node)}
   if ready.AcceptanceExit!=0 || len(ready.Scenarios)!=2 || ready.Failures() {t.Fatalf("changed readiness result: %+v",ready)}
   if !fileExists(trace) {t.Fatal("acceptance never started")}
   return
 }
 e:=failWith(t,err,"environment","tool_missing")
 if e.Exit!=3 || !strings.Contains(e.Detail,"reinstall Kogen") {t.Fatalf("refusal: %+v",e)}
 if fileExists(trace) {t.Fatal("acceptance started with broken install")}
 if cause=="cucumber" {
   if !strings.Contains(strings.ToLower(e.Detail),"cucumber") || !strings.Contains(e.Detail,tools.Cucumber) {t.Fatalf("Cucumber path missing: %s",e.Detail)}
 } else {
   if !strings.Contains(e.Detail,np) {t.Fatalf("node-path missing: %s",e.Detail)}
   tokens:=strings.Fields(strings.TrimPrefix(cause,"node-path is "))
   if strings.HasPrefix(cause,"node target is ") {tokens=strings.Fields(strings.TrimPrefix(cause,"node target is ")); if !strings.Contains(e.Detail,node) {t.Fatalf("target missing: %s",e.Detail)}}
   for _,token:=range tokens {if !strings.Contains(strings.ToLower(e.Detail),token) {t.Fatalf("cause %q missing in %q",cause,e.Detail)}}
   if tools.Node==np {t.Fatal("node-path used as executable")}
 }
}
`);
    const virtual = path.resolve('verify/zz_broken_install_contract_test.go');
    const overlay = path.join(tmp, 'overlay.json');
    await fs.writeFile(overlay, JSON.stringify({Replace:{[virtual]:source}}));
    const exe = path.join(tmp, 'contract.test');
    const result = await run('go', ['test','-overlay',overlay,'-c','-o',exe,'./verify']);
    assert.equal(result.code,0,'compile install contract: '+result.output);
    return exe;
  })();
  return binary;
}
Given('broken-kogen-install-blamed-on-intent: a synthetic installation case {string}', function(value) { this.installCase=value; });
Then('broken-kogen-install-blamed-on-intent: readiness reports {string} before acceptance', async function(cause) {
  const exe = await build();
  const result = await run(exe,['-test.run=^TestBrokenInstallContract$','-test.v'],{env:{...process.env,INSTALL_CONTRACT_CASE:this.installCase,INSTALL_CONTRACT_CAUSE:cause}});
  assert.equal(result.code,0,'TestBrokenInstallContract via '+exe+': '+result.output);
  assert.match(result.output,/--- PASS: TestBrokenInstallContract /,'TestBrokenInstallContract did not pass via '+exe+': '+result.output);
});
