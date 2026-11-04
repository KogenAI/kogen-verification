'use strict';

// Steps of k-verify-failed-readiness-setup-visible. Nothing runs when this file is loaded. The
// first readiness step builds the verify test binary once per run, with the Go driver at the end
// of this file added as verify/setupphase_acceptance_test.go through `go test -c -overlay`; each
// scenario then runs that binary's TestSetupPhaseReadinessDriver, which runs the real
// Readiness.Check with the repository's real Cucumber over the fixture files the scenario gave
// and writes one JSON report that the observer below judges. Child processes run
// asynchronously, so Cucumber's own report keeps each step's times.
//
// Run directly (`node <this file> good|bad`), the file checks its observer instead: `good` must
// accept the known-good reports, `bad` must reject every known-bad one.

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = 'k-verify-failed-readiness-setup-visible: ';
const TEST = 'TestSetupPhaseReadinessDriver';

// includesInOrder requires every expected line to be an exact line of actual, in this order.
function includesInOrder(actual, expected, what) {
  let next = 0;
  for (const line of expected) {
    const at = actual.indexOf(line, next);
    assert.ok(at >= 0, `${what} lacks the line ${JSON.stringify(line)} (at or after line ${next + 1}); its actual lines:\n${actual.join('\n')}`);
    next = at + 1;
  }
}

const observe = {
  refused(report, outcome, lines) {
    assert.equal(`${report.class}/${report.reason}`, outcome, `readiness outcome (${report.detail}); refusal lines:\n${report.lines.join('\n')}`);
    includesInOrder(report.lines, lines, 'the refusal');
  },
  lacks(report, lines) {
    for (const line of lines) {
      assert.ok(!report.lines.includes(line), `the refusal includes the line ${JSON.stringify(line)}; its actual lines:\n${report.lines.join('\n')}`);
    }
  },
  unrecorded(report) {
    assert.equal(report.recorded, false, 'a readiness evidence file .kogen/local/readiness/fixture.json was written');
    assert.equal(report.cached, false, 'Readiness.Cached reuses evidence for a refused check');
  },
  ready(report) {
    assert.equal(`${report.class}/${report.reason}`, '/', `readiness refused (${report.detail}); refusal lines:\n${report.lines.join('\n')}`);
    assert.equal(report.recorded, true, 'no readiness evidence file .kogen/local/readiness/fixture.json was written');
    assert.equal(report.cached, true, 'Readiness.Cached does not reuse the recorded evidence');
  },
  evidence(report, rows) {
    assert.ok(Array.isArray(report.evidence), `the readiness evidence has no scenarios list: ${JSON.stringify(report.evidence)}`);
    assert.equal(report.evidence.length, rows.length, `recorded scenarios: ${JSON.stringify(report.evidence)}`);
    rows.forEach((row, i) => {
      const sc = report.evidence[i];
      const shown = `recorded scenario ${i + 1}: ${JSON.stringify(sc)}`;
      assert.equal(sc.name, row.name, `${shown}: name`);
      assert.equal(sc.status, row.status, `${shown}: status`);
      if (row.phase === '-') assert.ok(!Object.hasOwn(sc, 'phase'), `${shown}: a scenario that did not fail has no phase`);
      else assert.equal(sc.phase, row.phase, `${shown}: phase`);
      if (row.step === '-') {
        assert.equal(sc.detail, null, `${shown}: detail`);
        return;
      }
      assert.equal(typeof sc.detail, 'string', `${shown}: detail`);
      const detail = sc.detail.split('\n');
      assert.equal(detail[0], row.step, `${shown}: failing step`);
      assert.ok(detail.includes(row.output), `${shown}: detail lacks the output line ${JSON.stringify(row.output)}`);
    });
  },
  observations(report, lines) {
    includesInOrder(report.observations.split('\n'), lines, 'the readiness observations');
  },
};

// ---- observer controls ----

const REFUSAL = [
  'setup failure: Seeded (line 5)',
  'acceptance.feature line 6: Given a seeded fixture',
  "Error: ENOENT: no such file or directory, open 'fixtures/seed.json'",
  'accepted assertion failure: First (line 2)',
  'accepted assertion failure: Later (line 8)',
];
const ROWS = [
  { name: 'Seeded', status: 'passed', phase: '-', step: '-', output: '-' },
  { name: 'Started', status: 'failed', phase: 'action', step: 'acceptance.feature line 7: When the product starts', output: 'TypeError: product.start is not a function' },
  { name: 'Prepared', status: 'failed', phase: 'setup', step: 'acceptance.feature line 13: Given a prepared product', output: 'TypeError: product.prepare is not a function' },
];
const OBSERVED = ['Scenario: Started (acceptance.feature line 5)', 'Failure phase: action', 'Scenario: Prepared (acceptance.feature line 12)', 'Failure phase: setup'];

function goodReports() {
  const refused = {
    class: 'intent', reason: 'not_ready', detail: 'the Intent is not ready to build', recorded: false, cached: false, evidence: null, observations: '',
    lines: [REFUSAL[0], REFUSAL[1], REFUSAL[2], '    at Object.readFileSync (node:fs:441:20)', REFUSAL[3], REFUSAL[4]],
  };
  const ready = {
    class: '', reason: '', detail: '', lines: [], recorded: true, cached: true,
    evidence: [
      { name: 'Seeded', line: 2, status: 'passed', detail: null, unexercised_steps: [] },
      { name: 'Started', line: 5, status: 'failed', phase: 'action', detail: 'acceptance.feature line 7: When the product starts\nTypeError: product.start is not a function\n    at World.<anonymous>', unexercised_steps: [] },
      { name: 'Prepared', line: 12, status: 'failed', phase: 'setup', detail: 'acceptance.feature line 13: Given a prepared product\nTypeError: product.prepare is not a function', unexercised_steps: [] },
    ],
    observations: 'Readiness observations\nScenario: Started (acceptance.feature line 5)\nFailure phase: action\nacceptance.feature line 7: When the product starts\n\nScenario: Prepared (acceptance.feature line 12)\nFailure phase: setup\nacceptance.feature line 13: Given a prepared product',
  };
  return { refused, ready };
}

function judge({ refused, ready }) {
  observe.refused(refused, 'intent/not_ready', REFUSAL);
  observe.lacks(refused, ['setup failure: First (line 2)', 'setup failure: Later (line 8)']);
  observe.unrecorded(refused);
  observe.ready(ready);
  observe.evidence(ready, ROWS);
  observe.observations(ready, OBSERVED);
}

function controls(bad) {
  judge(goodReports());
  if (!bad) return;
  const mutations = [
    (x) => { x.refused.class = ''; },
    (x) => { x.refused.reason = 'lint'; },
    (x) => { x.refused.lines.splice(0, 1); },
    (x) => { x.refused.lines[0] = 'harness failure: Seeded (line 5)'; },
    (x) => { x.refused.lines.splice(2, 1); },
    (x) => { x.refused.lines.reverse(); },
    (x) => { x.refused.lines.push('setup failure: First (line 2)'); },
    (x) => { x.refused.lines.splice(5, 1); },
    (x) => { x.refused.recorded = true; },
    (x) => { x.refused.cached = true; },
    (x) => { x.ready.class = 'intent'; x.ready.reason = 'not_ready'; },
    (x) => { x.ready.recorded = false; },
    (x) => { x.ready.cached = false; },
    (x) => { x.ready.evidence = null; },
    (x) => { x.ready.evidence.pop(); },
    (x) => { x.ready.evidence.reverse(); },
    (x) => { x.ready.evidence[0].phase = null; },
    (x) => { x.ready.evidence[0].detail = 'acceptance.feature line 3: Given a seeded fixture'; },
    (x) => { x.ready.evidence[1].status = 'passed'; },
    (x) => { delete x.ready.evidence[1].phase; },
    (x) => { x.ready.evidence[1].phase = 'assertion'; },
    (x) => { x.ready.evidence[2].phase = 'assertion'; },
    (x) => { x.ready.evidence[2].detail = 'acceptance.feature line 14: Then the product answers 42\nTypeError: product.prepare is not a function'; },
    (x) => { x.ready.evidence[2].detail = 'acceptance.feature line 13: Given a prepared product'; },
    (x) => { x.ready.evidence[2].detail = null; },
    (x) => { x.ready.observations = x.ready.observations.replace('Failure phase: setup', ''); },
    (x) => { x.ready.observations = x.ready.observations.replace('Failure phase: action', 'Failure phase: assertion'); },
    (x) => { x.ready.observations = ''; },
  ];
  for (const mutate of mutations) {
    const altered = goodReports();
    mutate(altered);
    assert.throws(() => judge(altered), `the observer accepted a known-bad report: ${mutate}`);
  }
  throw new Error('known-bad reports rejected');
}

if (require.main === module) {
  try {
    controls(process.argv[2] === 'bad');
    console.log('accepted');
  } catch (error) {
    if (error.message === 'known-bad reports rejected') console.log('rejected');
    else console.error(error);
    process.exitCode = 1;
  }
} else {
  const { AfterAll, Given, When, Then } = require('@cucumber/cucumber');

  let tmp;
  let prebuilt;

  const scratch = () => {
    if (!tmp) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'setupphase-'));
    return tmp;
  };

  // run starts file without blocking the event loop and resolves with its exit code (null when
  // it did not exit normally), error and output.
  const run = (file, args, options) => new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      const code = !error ? 0 : (typeof error.code === 'number' ? error.code : null);
      resolve({ code, error, stdout, stderr });
    });
  });

  // testBinary builds the verify test binary with the driver once per run; later calls reuse it
  // (and a failed build fails every caller with the same message).
  const testBinary = () => {
    if (!prebuilt) {
      prebuilt = (async () => {
        const root = process.cwd();
        const source = fs.readFileSync(__filename, 'utf8');
        const start = source.indexOf('\n/* DRIVER\n');
        const end = source.lastIndexOf('\nDRIVER */');
        assert.ok(start >= 0 && end > start, `the Go driver block is missing from ${__filename}`);
        const driver = path.join(scratch(), 'driver_test.go');
        fs.writeFileSync(driver, source.slice(start + '\n/* DRIVER\n'.length, end) + '\n');
        const overlay = path.join(scratch(), 'overlay.json');
        fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(root, 'verify', 'setupphase_acceptance_test.go')]: driver } }));
        const bin = path.join(scratch(), 'verify.test');
        const args = ['test', '-c', '-o', bin, '-overlay', overlay, './verify'];
        const r = await run('go', args, { cwd: root, env: { ...process.env, GOFLAGS: '' }, timeout: 85 * 1000 });
        assert.equal(r.code, 0, `go ${args.join(' ')} (in ${root}, with ${TEST} added from ${__filename}) failed: ${r.error ? r.error.message : ''}\n${r.stdout}${r.stderr}`);
        return bin;
      })();
    }
    return prebuilt;
  };

  AfterAll(function () {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  // drive runs the driver once over these fixture files and returns its report.
  const drive = async (files) => {
    const bin = await testBinary();
    const result = path.join(scratch(), `result-${process.hrtime.bigint()}.json`);
    const args = ['-test.run', `^${TEST}$`, '-test.count=1', '-test.v', '-test.timeout=25s'];
    const shown = `${bin} ${args.join(' ')} (the verify test binary built with ${TEST} from ${__filename}, run in verify)`;
    const r = await run(bin, args, { cwd: path.join(process.cwd(), 'verify'), env: { ...process.env, SETUPPHASE_FILES: JSON.stringify(files), SETUPPHASE_RESULT: result }, timeout: 28 * 1000 });
    assert.ok(r.code === 0 && fs.existsSync(result),
      `${shown}: ${TEST} wrote no report (absent, skipped, ran zero times or failed; exit ${r.code}): ${r.error ? r.error.message : ''}\n${r.stdout}${r.stderr}`);
    const report = JSON.parse(fs.readFileSync(result, 'utf8'));
    fs.rmSync(result, { force: true });
    return report;
  };

  const column = (table) => table.hashes().map((row) => row.line);

  Given(P + 'the fixture file {string}:', function (file, text) {
    this.setupPhaseFiles = { ...(this.setupPhaseFiles || {}), [file]: text };
  });

  When(P + 'readiness checks the fixture Intent', { timeout: 115 * 1000 }, async function () {
    this.setupPhase = await drive(this.setupPhaseFiles || {});
  });

  Then(P + 'readiness refuses with {string} and the refusal includes these lines in order:', function (outcome, table) {
    observe.refused(this.setupPhase, outcome, column(table));
  });

  Then(P + 'the refusal includes none of these lines:', function (table) {
    observe.lacks(this.setupPhase, column(table));
  });

  Then(P + 'no readiness evidence is recorded or reusable', function () {
    observe.unrecorded(this.setupPhase);
  });

  Then(P + 'readiness is ready with recorded, reusable evidence', function () {
    observe.ready(this.setupPhase);
  });

  Then(P + 'the readiness evidence records these scenarios:', function (table) {
    observe.evidence(this.setupPhase, table.hashes());
  });

  Then(P + 'the readiness observations include these lines in order:', function (table) {
    observe.observations(this.setupPhase, column(table));
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

	"github.com/KogenAI/kogen-loop/sys"
)

// TestSetupPhaseReadinessDriver writes SETUPPHASE_FILES (a JSON object of repository-relative
// path to content) over the real-Cucumber fixture project, runs Readiness.Check once and writes
// its outcome, the recorded evidence scenarios and the observations to SETUPPHASE_RESULT.
func TestSetupPhaseReadinessDriver(t *testing.T) {
	result := os.Getenv("SETUPPHASE_RESULT")
	if result == "" || !filepath.IsAbs(result) {
		t.Fatal("an absolute SETUPPHASE_RESULT is required")
	}
	var files map[string]string
	if err := json.Unmarshal([]byte(os.Getenv("SETUPPHASE_FILES")), &files); err != nil {
		t.Fatalf("SETUPPHASE_FILES: %v", err)
	}
	p, tools := realProject(t, "")
	for path, text := range files {
		p.write(path, text)
	}
	p.commit("synthetic candidate")
	r := p.readiness()
	r.Tools = tools
	s, _ := p.session()
	s.Env = p.Env
	ready, err := r.Check(context.Background(), s, fixtureSlug)
	out := map[string]any{"class": "", "reason": "", "detail": "", "lines": []string{}, "observations": "", "evidence": nil}
	if err != nil {
		e, ok := sys.AsError(err)
		if !ok {
			t.Fatalf("readiness returned a non-contract error: %v", err)
		}
		out["class"], out["reason"], out["detail"] = e.Class, e.Reason, e.Detail
		if e.Lines != nil {
			out["lines"] = e.Lines
		}
	}
	if ready != nil {
		out["observations"] = Observations(fixtureSlug, ready, "")
	}
	rec, recorded := p.readinessRecord()
	out["recorded"] = recorded
	if recorded {
		out["evidence"] = rec["scenarios"]
	}
	out["cached"] = r.Cached(s, fixtureSlug) != nil
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(result, b, 0o600); err != nil {
		t.Fatal(err)
	}
}
DRIVER */
