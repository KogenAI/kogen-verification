const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function command(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, NODE_PATH: process.env.KOGEN_CUCUMBER }, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')}: ${r.error || ''}\n${r.stdout}${r.stderr}`);
  return r.stdout;
}
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-gaps-'));
  try {
    const bin = path.join(root, 'gaps');
    command('go', ['build', '-o', bin, './features/steps/gaps'], process.cwd());
    return fn(root, bin);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function account(kind) {
  return fixture((root, bin) => {
    fs.writeFileSync(path.join(root, 'acceptance.feature'), 'Feature: Proof\n  Scenario: reject invalid operation\n    Given fixture exists\n    Then the invalid operation is rejected\n');
    fs.writeFileSync(path.join(root, 'steps.cjs'), "const {Given,Then}=require('@cucumber/cucumber'); Given('fixture exists',()=>{}); Then('the invalid operation is rejected',()=>{});\n");
    const report = path.join(root, 'report.ndjson');
    const cucumber = path.join(process.env.KOGEN_CUCUMBER, '@cucumber/cucumber/bin/cucumber.js');
    command(process.env.KOGEN_NODE, [cucumber, '--require', 'steps.cjs', '--format', `message:${report}`, 'acceptance.feature'], root);
    let events = fs.readFileSync(report, 'utf8').trim().split('\n').map(JSON.parse);
    const tc = events.find(e => e.testCase).testCase;
    const pickle = events.find(e => e.pickle).pickle;
    const last = tc.testSteps.find(s => s.pickleStepId === pickle.steps[1].id);
    assert.ok(last, 'real Cucumber must declare the Then test step');
    if (kind === 'omit-test-step' || kind === 'omit-pickle-step' || kind === 'omit-source-step') {
      tc.testSteps = tc.testSteps.filter(s => s.id !== last.id);
      events = events.filter(e => !e.testStepFinished || e.testStepFinished.testStepId !== last.id);
      if (kind !== 'omit-test-step') pickle.steps.pop();
      if (kind === 'omit-source-step') {
        events.find(e => e.gherkinDocument).gherkinDocument.feature.children[0].scenario.steps.pop();
      }
    } else if (kind === 'duplicate-result') {
      events.push(events.find(e => e.testStepFinished && e.testStepFinished.testStepId === last.id));
    } else { assert.equal(kind, 'complete'); }
    fs.writeFileSync(report, events.map(e => JSON.stringify(e)).join('\n') + '\n');
    return JSON.parse(command(bin, ['account', root, report], root));
  });
}
function model(name, assertion) {
  return fixture((root, bin) => {
    fs.writeFileSync(path.join(root, 'model.qnt'), `module model {\n var n: int\n action init = n' = 0\n action step = n' = n\n val Safe = n == 0\n run ${name} = init.expect(n == ${assertion})\n}\n`);
    return JSON.parse(command(bin, ['model', root, 'model.qnt'], root));
  });
}
function expectAccount(result, status) {
  assert.equal(result.Scenarios.length, 1, 'Account must account for the protected scenario');
  assert.equal(result.Scenarios[0].status, status, JSON.stringify(result));
  assert.equal(result.Problems.length === 0, status === 'passed', JSON.stringify(result));
  assert.equal(result.Passed, status === 'passed' ? 1 : 0, JSON.stringify(result));
}
function expectModel(result, state) {
  assert.equal(result.State, state, JSON.stringify(result));
  assert.equal(result.Problems.length === 0, state === 'ok', JSON.stringify(result));
}
if (require.main === module) {
  const [area, polarity] = process.argv.slice(2);
  try {
    if (area === 'account') expectAccount(account('complete'), polarity === 'good' ? 'passed' : 'report_invalid');
    else if (area === 'model') expectModel(model('PassTest', 0), polarity === 'good' ? 'ok' : 'failed');
    else throw new Error('unknown control');
    console.log('control accepted');
  } catch (e) { console.log('control rejected'); process.exitCode = 1; }
} else {
  const { When, Then } = require('@cucumber/cucumber');
  When('verification accounts for a real passing report altered by {string}', function (kind) { this.gapAccount = account(kind); });
  Then('the proof scenario is {string}', function (status) { expectAccount(this.gapAccount, status); });
  When('verification checks the model run {string} asserting n equals {int}', function (name, value) { this.gapModel = model(name, value); });
  Then('the model proof is {string}', function (state) { expectModel(this.gapModel, state); });
}
