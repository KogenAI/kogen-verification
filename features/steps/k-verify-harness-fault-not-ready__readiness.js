'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');

function observe(turns, expected) {
  assert.equal(turns.length, expected.length, 'exact readiness turn count');
  for (let i = 0; i < expected.length; i++) {
    const t = turns[i], e = expected[i];
    assert.equal(t.class, e.class, `turn ${i + 1} classification`);
    assert.equal(t.reason, e.reason, `turn ${i + 1} reason`);
    assert.equal(t.recorded, e.recorded, `turn ${i + 1} evidence publication`);
    assert.equal(t.cached, e.recorded, `turn ${i + 1} reusable evidence`);
    assert.deepEqual(t.names, e.names, `turn ${i + 1} scenario identities`);
    assert.deepEqual(t.statuses, e.statuses, `turn ${i + 1} scenario outcomes`);
    for (const text of e.contains) {
      let diagnostic = t.detail + '\n' + t.lines.join('\n');
      if (text === 'shared fixture') diagnostic = diagnostic.replaceAll('broken shared fixture', '');
      assert.ok(diagnostic.includes(text), `turn ${i + 1} diagnostic lacks ${JSON.stringify(text)}`);
    }
  }
}

function execute(mode) {
  const root = process.cwd();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kogen-harness-contract-'));
  try {
    const source = fs.readFileSync(__filename, 'utf8');
    const driver = source.slice(source.indexOf('\n/* DRIVER\n') + 11, source.lastIndexOf('\nDRIVER */'));
    const actual = path.join(tmp, 'driver_test.go');
    fs.writeFileSync(actual, driver);
    const overlay = path.join(tmp, 'overlay.json');
    fs.writeFileSync(overlay, JSON.stringify({Replace: {[path.join(root, 'verify', 'kogen_harness_contract_test.go')]: actual}}));
    const result = path.join(tmp, 'result.json');
    const args = ['test', '-count=1', '-overlay', overlay, './verify', '-run', '^TestKogenHarnessObservation$'];
    const run = cp.spawnSync('go', args, {cwd: root, env: {...process.env, KOGEN_HARNESS_CASE: mode, KOGEN_HARNESS_RESULT: result}, encoding: 'utf8'});
    assert.equal(run.status, 0, `go ${args.join(' ')}: ${run.error || ''}\n${run.stdout}\n${run.stderr}`);
    assert.ok(fs.existsSync(result), 'TestKogenHarnessObservation did not produce its observation file');
    return JSON.parse(fs.readFileSync(result, 'utf8'));
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
}

function controls(bad) {
  const expected = [
    {class: 'intent', reason: 'not_ready', recorded: false, names: [], statuses: [], contains: ['First', 'Later', 'shared fixture', 'broken shared fixture']},
    {class: '', reason: '', recorded: true, names: ['First', 'Later'], statuses: ['failed', 'failed'], contains: []},
    {class: 'environment', reason: 'step_timeout', recorded: false, names: [], statuses: [], contains: ['fixture service absent']}
  ];
  const good = expected.map(e => ({...e, cached: e.recorded, detail: '', lines: e.contains}));
  observe(good, expected);
  if (!bad) return;
  const mutations = [
    x => x.pop(),
    x => {x[0].class = '';}, x => {x[0].reason = '';},
    x => {x[0].recorded = true;}, x => {x[0].cached = true;},
    x => {x[0].lines = ['First', 'shared fixture', 'broken shared fixture'];},
    x => {x[0].lines = ['First', 'Later', 'broken shared fixture'];},
    x => {x[0].lines = ['First', 'Later', 'shared fixture'];},
    x => {x[1].recorded = false;}, x => {x[1].cached = false;},
    x => {x[1].names.reverse();}, x => {x[1].statuses = ['passed', 'passed'];},
    x => {x[2].class = 'intent';}, x => {x[2].reason = 'not_ready';},
    x => {x[2].lines = [];}
  ];
  for (const mutate of mutations) {
    const altered = JSON.parse(JSON.stringify(good));
    mutate(altered);
    assert.throws(() => observe(altered, expected), 'observer accepted a corrupted outcome');
  }
  throw new Error('known-bad outcomes rejected');
}

if (require.main === module) {
  try { controls(process.argv[2] === 'bad'); console.log('accepted'); }
  catch (error) { if (error.message === 'known-bad outcomes rejected') console.log('rejected'); else console.error(error); process.exitCode = 1; }
} else {
  const {When, Then} = require('@cucumber/cucumber');
  When('k-verify-harness-fault-not-ready: I check the {string} synthetic candidate', {timeout: 180000}, function(mode) { this.harnessTurns = execute(mode); });
  Then('k-verify-harness-fault-not-ready: the readiness turns are', function(table) {
    const expected = table.hashes().map(row => ({class: row.class === '-' ? '' : row.class, reason: row.reason === '-' ? '' : row.reason, recorded: row.recorded === 'yes', names: row.names === '-' ? [] : row.names.split(','), statuses: row.statuses === '-' ? [] : row.statuses.split(','), contains: row.contains === '-' ? [] : row.contains.split(';')}));
    observe(this.harnessTurns, expected);
  });
}

/* DRIVER
package verify

import (
 "context"
 "encoding/json"
 "os"
 "path/filepath"
 "testing"
 "time"
 "github.com/KogenAI/kogen-loop/sys"
)

type harnessTurn struct {
 Class string `json:"class"`
 Reason string `json:"reason"`
 Detail string `json:"detail"`
 Lines []string `json:"lines"`
 Names []string `json:"names"`
 Statuses []string `json:"statuses"`
 Recorded bool `json:"recorded"`
 Cached bool `json:"cached"`
}

func TestKogenHarnessObservation(t *testing.T) {
 mode := os.Getenv("KOGEN_HARNESS_CASE")
 if mode == "" { t.Fatal("KOGEN_HARNESS_CASE is required") }
 p, tools := realProject(t, "")
 p.write("product.cjs", "module.exports = {};\n")
 const prefix = `const {Before, Given, Then, setDefaultTimeout} = require('@cucumber/cucumber');
const product = require('../../product.cjs');
`
 const missing = `Then('the candidate succeeds', () => product.answer());
`
 hook := `Before({name: 'shared fixture'}, () => { throw new TypeError('broken shared fixture'); });
`
 helper := `function prepareFixture() { throw new TypeError('broken setup helper'); }
Given('a fixture', () => prepareFixture());
`
 steps := prefix + missing
 switch mode {
 case "hook", "repair", "standin": steps = prefix + hook + missing
 case "helper":
  p.write(".kogen/intents/fixture/acceptance.feature", "Feature: Fixture\n  Scenario: First\n    Given a fixture\n    Then the candidate succeeds\n  Scenario: Later\n    Given a fixture\n    Then the candidate succeeds\n")
  steps = prefix + helper + missing
 case "missing":
 case "assert-error", "assert-typeerror":
  errorType := "Error"
  if mode == "assert-typeerror" { errorType = "TypeError" }
  p.write("product.cjs", "module.exports = {answer: () => 0};\n")
  p.write("features/steps/assertion.cjs", "exports.assertAnswer = x => { if (x !== 42) throw new "+errorType+"('wrong answer'); };\n")
  steps = prefix + "const {assertAnswer} = require('./assertion.cjs');\nThen('the candidate succeeds', () => assertAnswer(product.answer()));\n"
 case "timeout":
  p.write(".kogen/intents/fixture/acceptance.feature", "Feature: Fixture\n  Scenario: First\n    Given a fixture\n    Then the candidate succeeds\n  Scenario: Later\n    Given a fixture\n    Then the candidate succeeds\n")
  steps = prefix + "setDefaultTimeout(60000);\nGiven('a fixture', async () => { console.log('fixture service absent'); await new Promise(() => {}); });\n" + missing
 default: t.Fatalf("unknown case %q", mode)
 }
 p.write("features/steps/fixture_steps.js", steps)
 p.commit("synthetic candidate")
 r := p.readiness()
 r.Tools = tools
 if mode == "timeout" {
  r.Attempt = NewAttempt(p.Root, fixtureSlug, nil)
  r.Attempt.timeout = 2*time.Second
 }
 var turns []harnessTurn
 check := func() {
  s, _ := p.session()
  ready, err := r.Check(context.Background(), s, fixtureSlug)
  turn := harnessTurn{Names: []string{}, Statuses: []string{}, Lines: []string{}}
  if err != nil {
   e, ok := sys.AsError(err)
   if !ok { t.Fatalf("readiness returned non-contract error: %v", err) }
   turn.Class, turn.Reason, turn.Detail, turn.Lines = e.Class, e.Reason, e.Error(), e.Lines
  }
  if ready != nil {
   for _, sc := range ready.Scenarios { turn.Names = append(turn.Names, sc.Name); turn.Statuses = append(turn.Statuses, sc.Status) }
  }
  _, turn.Recorded = p.readinessRecord()
  turn.Cached = r.Cached(s, fixtureSlug) != nil
  turns = append(turns, turn)
 }
 check()
 if mode == "repair" {
  p.write("shaper-feedback.json", mustHarnessJSON(t, turns[0]))
  p.write("features/steps/fixture_steps.js", prefix + "Before({name: 'shared fixture'}, () => {});\n" + missing)
  check()
 }
 if mode == "standin" {
  p.write("product.cjs", "module.exports = {answer: () => 42};\n")
  check()
 }
 result := os.Getenv("KOGEN_HARNESS_RESULT")
 if result == "" || !filepath.IsAbs(result) { t.Fatal("absolute KOGEN_HARNESS_RESULT is required") }
 if err := os.WriteFile(result, []byte(mustHarnessJSON(t, turns)), 0600); err != nil { t.Fatal(err) }
}

func mustHarnessJSON(t *testing.T, value any) string {
 t.Helper()
 b, err := json.Marshal(value)
 if err != nil { t.Fatal(err) }
 return string(b)
}
DRIVER */
