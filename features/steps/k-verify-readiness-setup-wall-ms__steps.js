'use strict';

// Steps of k-verify-readiness-setup-wall-ms. Nothing runs when this file is loaded. The first
// driver step builds the verify test binary once per run, with the Go driver at the end of this
// file added as verify/setupwall_acceptance_test.go through `go test -c -overlay`; each scenario
// then runs that binary's TestReadinessSetupWallDriver for one case. The driver runs the real
// Readiness.Setup, Readiness.Check and Run on the stub project of the verify tests with an
// in-memory event log and writes one JSON report: per run, every logged event and the outcome,
// progress text and recorded bytes (stamp, readiness record, Pass JSON) of every call. The
// observer below judges that report. Child processes run asynchronously, so Cucumber's own report
// keeps each step's times.
//
// Run directly (`node <this file> good|bad`), the file checks its observer instead: `good` must
// accept the known-good reports, `bad` must reject every known-bad one.

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = 'k-verify-readiness-setup-wall-ms: ';
const TEST = 'TestReadinessSetupWallDriver';

// run returns report.runs[n-1] (n counts from 1).
function nth(report, n) {
  assert.ok(Number.isInteger(n) && n >= 1 && n <= report.runs.length, `the ${report.case} case has ${report.runs.length} runs, not a run ${n}`);
  return report.runs[n - 1];
}

// masked removes every *_ms key, the volatile ms of the existing step_sweep events, and the random
// suffix of Kogen's scratch directories.
function masked(value, sweep) {
  if (Array.isArray(value)) return value.map((v) => masked(v, false));
  if (value && typeof value === 'object') {
    const isSweep = value.event === 'step_sweep';
    return Object.fromEntries(Object.entries(value)
      .filter(([k]) => !k.endsWith('_ms') && !(isSweep && k === 'ms'))
      .map(([k, v]) => [k, masked(v, false)]));
  }
  if (typeof value === 'string') return value.replace(/(kogen-[a-z]+(?:-[a-z]+)*)-[0-9a-f]{8,}/g, '$1-<scratch>');
  return value;
}

// withHead replaces the stub project's HEAD (its commit time varies) with <head> in every string.
function withHead(value, head) {
  return JSON.parse(JSON.stringify(value).split(head).join('<head>'));
}

const observe = {
  // results requires the setup-* command_result events of every run to be exactly these rows,
  // in order, each with an integer wall_ms in [min_ms, max_ms).
  results(report, rows) {
    const actual = [];
    report.runs.forEach((r, i) => {
      for (const e of r.events) {
        if (e.event === 'command_result' && /^setup-\d+$/.test(e.name)) actual.push({ run: i + 1, e });
      }
    });
    const shown = actual.map(({ run, e }) => `run ${run}: ${JSON.stringify(e)}`).join('\n');
    assert.equal(actual.length, rows.length, `the ${report.case} case logged ${actual.length} setup command_result events, not ${rows.length}:\n${shown}`);
    rows.forEach((row, i) => {
      const { run, e } = actual[i];
      const where = `setup command_result ${i + 1} of the ${report.case} case (run ${run}): ${JSON.stringify(e)}`;
      assert.equal(run, Number(row.run), `${where}: run`);
      assert.equal(e.name, row.name, `${where}: name`);
      if (row.status !== '-') assert.equal(e.status, Number(row.status), `${where}: status`);
      assert.ok(Object.hasOwn(e, 'wall_ms'), `${where}: no wall_ms`);
      assert.ok(Number.isInteger(e.wall_ms), `${where}: wall_ms is not an integer`);
      assert.ok(e.wall_ms >= Number(row.min_ms) && e.wall_ms < Number(row.max_ms), `${where}: wall_ms ${e.wall_ms} is outside [${row.min_ms}, ${row.max_ms})`);
    });
  },
  // kinds requires run n to log exactly these events, in order.
  kinds(report, n, kinds) {
    const r = nth(report, n);
    assert.deepEqual(r.events.map((e) => e.event), kinds, `the events of run ${n} of the ${report.case} case:\n${r.events.map((e) => JSON.stringify(e)).join('\n')}`);
  },
  // skipped requires the setup_skipped events of run n to be exactly these.
  skipped(report, n, events) {
    const r = nth(report, n);
    assert.deepEqual(r.events.filter((e) => e.event === 'setup_skipped'), events, `the setup_skipped events of run ${n} of the ${report.case} case`);
  },
  // calls requires the calls of run n to have exactly these outcomes, progress text and recorded
  // bytes, with the stub project's HEAD written as <head>.
  calls(report, n, calls) {
    assert.deepEqual(withHead(nth(report, n).calls, report.head), calls, `the calls of run ${n} of the ${report.case} case`);
  },
  every(report, calls) {
    assert.ok(report.runs.length > 0, `the ${report.case} case has no runs`);
    report.runs.forEach((_, i) => observe.calls(report, i + 1, calls));
  },
  // same requires the two runs to log the same events once every *_ms key is removed.
  same(report) {
    assert.equal(report.runs.length, 2, `the ${report.case} case has ${report.runs.length} runs, not 2`);
    assert.deepEqual(masked(report.runs[1].events), masked(report.runs[0].events), `the masked logs of the two runs of the ${report.case} case differ`);
  },
};

// ---- observer controls ----

const STAMP = (setup) => JSON.stringify({ changes: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', head: 'H', setup });
const sweep = (name, ms) => ({ event: 'step_sweep', ms, name, stopped: 0 });
const command = (name, cmd, extra = {}) => ({ command: cmd, event: 'command', name, ...extra });
const result = (name, status, ms, extra = {}) => ({ event: 'command_result', name, output: '', status, ...extra, wall_ms: ms });

function goodReports() {
  const failing = {
    case: 'failing', head: 'H',
    runs: [{
      calls: [{ call: 'check', error: { class: 'environment', detail: 'Setup setup-2 failed (status=4).', exit: 3, lines: [''], reason: 'setup_failed' }, progress: 'kogen: running setup-1: sleep 1\nkogen: running setup-2: exit 4\n', record: null }],
      events: [command('setup-1', 'sleep 1'), sweep('setup-1', 6), result('setup-1', 0, 1004), command('setup-2', 'exit 4'), sweep('setup-2', 3), result('setup-2', 4, 3)],
    }],
  };
  const cancel = {
    case: 'cancel', head: 'H',
    runs: [{
      calls: [{ call: 'setup', error: { text: 'context deadline exceeded' }, progress: 'kogen: running setup-1: sleep 30\n', reuse: false, stamp: null }],
      events: [command('setup-1', 'sleep 30'), sweep('setup-1', 13), result('setup-1', 0, 1104)],
    }],
  };
  const reuse = {
    case: 'reuse', head: 'H',
    runs: [
      { calls: [{ call: 'setup', error: null, progress: 'kogen: running setup-1: true\n', reuse: true, stamp: STAMP(['true']) }],
        events: [command('setup-1', 'true'), sweep('setup-1', 3), result('setup-1', 0, 4)] },
      { calls: [{ call: 'setup', error: null, progress: 'kogen: setup already ran for this checkout state\n', reuse: true, stamp: STAMP(['true']) }],
        events: [{ event: 'setup_skipped', reason: 'already_ran', count: 1 }] },
    ],
  };
  const record = '{"acceptance_exit":0,"head":"H","outcome":"ready"}\n';
  const pass = '{"n":1,"clean":true,"green":true,"setup":[{"name":"setup-1","command":"true","status":0,"output":""}]}';
  const identicalRun = (ms, scratch) => ({
    calls: [
      { call: 'setup', error: null, progress: 'kogen: running setup-1: true\n', reuse: false, stamp: STAMP(['true']) },
      { call: 'check', error: null, progress: 'kogen: running setup-1: true\n', record },
      { call: 'pass', error: null, pass, progress: 'kogen: verifying (pass 1)\nkogen: running setup-1: true\nkogen: pass 1: all checks passed\n' },
    ],
    events: [
      command('setup-1', 'true'), sweep('setup-1', ms), result('setup-1', 0, ms),
      command('setup-1', 'true'), sweep('setup-1', ms + 1), result('setup-1', 0, ms + 2),
      { event: 'check_identity', host: { os: 'linux' } },
      command('setup-1', 'true', { cwd: `/tmp/x/kogen-verify-${scratch}`, identity_sha256: 'a6de' }), sweep('setup-1', ms), result('setup-1', 0, ms),
      command('acceptance', './accept.sh', { identity_sha256: 'cfef' }), sweep('acceptance', 2), result('acceptance', 0, ms + 7),
      { event: 'pass', failing: [], files_changed_while_checks_ran: [], green: true, not_run: [], pass: 1, checks_wall_ms: ms + 20 },
    ],
  });
  const identical = { case: 'identical', head: 'H', runs: [identicalRun(3, '4e3067e4ed6e367e'), identicalRun(9, '66aee41a91b2f793')] };
  const empty = {
    case: 'empty', head: 'H',
    runs: [{
      calls: [
        { call: 'check', error: null, progress: '', record },
        { call: 'setup', error: null, progress: '', reuse: true, stamp: STAMP([]) },
        { call: 'setup', error: null, progress: 'kogen: setup already ran for this checkout state\n', reuse: true, stamp: STAMP([]) },
      ],
      events: [],
    }],
  };
  return { failing, cancel, reuse, identical, empty };
}

function judge(x) {
  const g = goodReports();
  observe.results(x.failing, [{ run: '1', name: 'setup-1', status: '0', min_ms: '1000', max_ms: '3000' }, { run: '1', name: 'setup-2', status: '4', min_ms: '0', max_ms: '1000' }]);
  observe.kinds(x.failing, 1, ['command', 'step_sweep', 'command_result', 'command', 'step_sweep', 'command_result']);
  observe.calls(x.failing, 1, withHead(g.failing.runs[0].calls, 'H'));
  observe.results(x.cancel, [{ run: '1', name: 'setup-1', status: '-', min_ms: '500', max_ms: '3000' }]);
  observe.kinds(x.cancel, 1, ['command', 'step_sweep', 'command_result']);
  observe.calls(x.cancel, 1, withHead(g.cancel.runs[0].calls, 'H'));
  observe.results(x.reuse, [{ run: '1', name: 'setup-1', status: '0', min_ms: '0', max_ms: '1000' }]);
  observe.kinds(x.reuse, 1, ['command', 'step_sweep', 'command_result']);
  observe.kinds(x.reuse, 2, ['setup_skipped']);
  observe.skipped(x.reuse, 1, []);
  observe.skipped(x.reuse, 2, [{ event: 'setup_skipped', reason: 'already_ran', count: 1 }]);
  observe.calls(x.reuse, 1, withHead(g.reuse.runs[0].calls, 'H'));
  observe.calls(x.reuse, 2, withHead(g.reuse.runs[1].calls, 'H'));
  const rows = [];
  for (const run of ['1', '2']) for (let i = 0; i < 3; i++) rows.push({ run, name: 'setup-1', status: '0', min_ms: '0', max_ms: '1000' });
  observe.results(x.identical, rows);
  observe.same(x.identical);
  observe.every(x.identical, withHead(g.identical.runs[0].calls, 'H'));
  observe.kinds(x.empty, 1, []);
  observe.calls(x.empty, 1, withHead(g.empty.runs[0].calls, 'H'));
}

function controls(bad) {
  judge(goodReports());
  if (!bad) return;
  const mutations = [
    (x) => { delete x.failing.runs[0].events[2].wall_ms; },
    (x) => { delete x.failing.runs[0].events[5].wall_ms; },
    (x) => { x.failing.runs[0].events[2].wall_ms = '1004'; },
    (x) => { x.failing.runs[0].events[2].wall_ms = 1004.5; },
    (x) => { x.failing.runs[0].events[2].wall_ms = 999; },
    (x) => { x.failing.runs[0].events[2].wall_ms = 3000; },
    (x) => { x.failing.runs[0].events[5].wall_ms = 1007; },
    (x) => { x.failing.runs[0].events[5].status = 0; },
    (x) => { x.failing.runs[0].events.splice(3, 3); },
    (x) => { x.failing.runs[0].events.push({ event: 'setup_skipped', reason: 'already_ran', count: 2 }); },
    (x) => { x.failing.runs[0].calls[0].error.exit = 1; },
    (x) => { x.failing.runs[0].calls[0].progress = 'kogen: running setup-1: sleep 1\n'; },
    (x) => { x.cancel.runs[0].events.splice(2, 1); },
    (x) => { x.cancel.runs[0].events[2].wall_ms = 30000; },
    (x) => { x.cancel.runs[0].events[2].wall_ms = 0; },
    (x) => { x.cancel.runs[0].calls[0].error = null; },
    (x) => { x.reuse.runs[1].events = []; },
    (x) => { x.reuse.runs[1].events[0].count = 0; },
    (x) => { x.reuse.runs[1].events[0].reason = 'stamp_matches'; },
    (x) => { x.reuse.runs[1].events[0].commands = 1; },
    (x) => { x.reuse.runs[1].events.push(x.reuse.runs[1].events[0]); },
    (x) => { x.reuse.runs[1].events.unshift(command('setup-1', 'true')); },
    (x) => { x.reuse.runs[0].events.push({ event: 'setup_skipped', reason: 'already_ran', count: 1 }); },
    (x) => { x.reuse.runs[1].calls[0].progress = 'kogen: setup skipped\n'; },
    (x) => { x.reuse.runs[1].calls[0].stamp = STAMP(['true']).replace('}', ',"wall_ms":4}'); },
    (x) => { delete x.identical.runs[1].events[2].wall_ms; },
    (x) => { delete x.identical.runs[0].events[5].wall_ms; },
    (x) => { x.identical.runs[1].events[2].output = 'other'; },
    (x) => { x.identical.runs[1].events.splice(6, 1); },
    (x) => { x.identical.runs[1].events[0].command = 'false'; },
    (x) => { x.identical.runs.pop(); },
    (x) => { x.identical.runs[1].calls[2].pass = x.identical.runs[1].calls[2].pass.replace('"output":""', '"output":"","wall_ms":1'); },
    (x) => { x.identical.runs[0].calls[1].record = x.identical.runs[0].calls[1].record.replace('\n', ''); },
    (x) => { x.identical.runs[0].calls[0].stamp = STAMP(['false']); },
    (x) => { x.empty.runs[0].events.push({ event: 'setup_skipped', reason: 'already_ran', count: 0 }); },
    (x) => { x.empty.runs[0].calls[2].progress = ''; },
  ];
  const accepted = [];
  for (const mutate of mutations) {
    const altered = goodReports();
    mutate(altered);
    try {
      judge(altered);
      accepted.push(String(mutate));
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error;
    }
  }
  if (accepted.length > 0) throw new Error(`the observer accepted known-bad reports:\n${accepted.join('\n')}`);
  throw new Error('known-bad reports rejected');
}

if (require.main === module) {
  const bad = process.argv[2] === 'bad';
  try {
    controls(bad);
    console.log('good controls accepted');
  } catch (error) {
    if (bad && error.message === 'known-bad reports rejected') {
      console.log('bad controls rejected');
      process.exitCode = 1;
    } else {
      console.error(error);
      process.exitCode = 2;
    }
  }
} else {
  const { AfterAll, When, Then } = require('@cucumber/cucumber');

  let tmp;
  let prebuilt;

  const scratch = () => {
    if (!tmp) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'setupwall-'));
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
        fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(root, 'verify', 'setupwall_acceptance_test.go')]: driver } }));
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

  When(P + 'the setup driver runs the {string} case', { timeout: 115 * 1000 }, async function (name) {
    const bin = await testBinary();
    const result = path.join(scratch(), `report-${process.hrtime.bigint()}.json`);
    const args = ['-test.run', `^${TEST}$`, '-test.count=1', '-test.v', '-test.timeout=25s'];
    const shown = `${bin} ${args.join(' ')} (the verify test binary built with ${TEST} from ${__filename}, run in verify, case ${name})`;
    const r = await run(bin, args, { cwd: path.join(process.cwd(), 'verify'), env: { ...process.env, SETUPWALL_CASE: name, SETUPWALL_REPORT: result }, timeout: 28 * 1000 });
    assert.ok(r.code === 0 && fs.existsSync(result),
      `${shown}: ${TEST} wrote no report (absent, skipped, ran zero times or failed; exit ${r.code}): ${r.error ? r.error.message : ''}\n${r.stdout}${r.stderr}`);
    this.setupWall = JSON.parse(fs.readFileSync(result, 'utf8'));
    fs.rmSync(result, { force: true });
  });

  Then(P + 'the setup command results are:', function (table) {
    observe.results(this.setupWall, table.hashes());
  });

  Then(P + 'run {int} logs these events in order:', function (n, text) {
    observe.kinds(this.setupWall, n, JSON.parse(text));
  });

  Then(P + 'run {int} logs these setup_skipped events:', function (n, text) {
    observe.skipped(this.setupWall, n, JSON.parse(text));
  });

  Then(P + 'run {int} makes these calls:', function (n, text) {
    observe.calls(this.setupWall, n, JSON.parse(text));
  });

  Then(P + 'every run makes these calls:', function (text) {
    observe.every(this.setupWall, JSON.parse(text));
  });

  Then(P + 'the two runs log the same events once every *_ms key is removed', function () {
    observe.same(this.setupWall);
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

// TestReadinessSetupWallDriver runs the case SETUPWALL_CASE on the stub project with an in-memory
// event log and writes, per run, every logged event and the outcome, progress text and recorded
// bytes of every call, with the project's HEAD, to SETUPWALL_REPORT.
func TestReadinessSetupWallDriver(t *testing.T) {
	report := os.Getenv("SETUPWALL_REPORT")
	if report == "" || !filepath.IsAbs(report) {
		t.Fatal("an absolute SETUPWALL_REPORT is required")
	}
	isolateTmp(t)
	p := newProj(t)
	stamp := func() any {
		b, err := os.ReadFile(filepath.Join(p.Root, ".kogen/local/setup.json"))
		if err != nil {
			return nil
		}
		return string(b)
	}
	outcome := func(err error) any {
		if err == nil {
			return nil
		}
		if e, ok := sys.AsError(err); ok {
			return map[string]any{"class": e.Class, "reason": e.Reason, "detail": e.Detail, "exit": e.Exit, "lines": e.Lines}
		}
		return map[string]any{"text": err.Error()}
	}
	setup := func(ctx context.Context, log *memLog, reuse bool) map[string]any {
		r := p.readiness()
		r.Log = log
		s, stderr := p.session()
		err := r.Setup(ctx, s, p.Root, reuse)
		return map[string]any{"call": "setup", "reuse": reuse, "progress": stderr.String(), "error": outcome(err), "stamp": stamp()}
	}
	check := func(log *memLog) map[string]any {
		r := p.readiness()
		r.Log = log
		s, stderr := p.session()
		_, err := r.Check(context.Background(), s, fixtureSlug)
		var record any
		if b, err := os.ReadFile(readinessPath(p.Root, fixtureSlug)); err == nil {
			record = string(b)
		}
		return map[string]any{"call": "check", "progress": stderr.String(), "error": outcome(err), "record": record}
	}
	pass := func(log *memLog) map[string]any {
		in := p.input(1)
		in.Log = log
		s, stderr := p.session()
		got, err := Run(context.Background(), s, in)
		b, merr := json.Marshal(got)
		if merr != nil {
			t.Fatal(merr)
		}
		return map[string]any{"call": "pass", "progress": stderr.String(), "error": outcome(err), "pass": string(b)}
	}
	runs := []any{}
	add := func(log *memLog, calls ...map[string]any) {
		events := log.events
		if events == nil {
			events = []map[string]any{}
		}
		runs = append(runs, map[string]any{"calls": calls, "events": events})
	}
	switch c := os.Getenv("SETUPWALL_CASE"); c {
	case "failing":
		p.Config.Setup = []string{"sleep 1", "exit 4"}
		log := &memLog{}
		add(log, check(log))
	case "cancel":
		p.Config.Setup = []string{"sleep 30"}
		log := &memLog{}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		add(log, setup(ctx, log, false))
		cancel()
	case "reuse", "reuse-two":
		p.Config.Setup = []string{"true"}
		if c == "reuse-two" {
			p.Config.Setup = []string{"true", "true"}
		}
		for i := 0; i < 2; i++ {
			log := &memLog{}
			add(log, setup(context.Background(), log, true))
		}
	case "identical":
		p.Config.Setup = []string{"true"}
		for i := 0; i < 2; i++ {
			log := &memLog{}
			add(log, setup(context.Background(), log, false), check(log), pass(log))
		}
	case "empty":
		p.Config.Setup = nil
		log := &memLog{}
		add(log, check(log), setup(context.Background(), log, true), setup(context.Background(), log, true))
	default:
		t.Fatalf("unknown SETUPWALL_CASE %q", c)
	}
	b, err := json.Marshal(map[string]any{"case": os.Getenv("SETUPWALL_CASE"), "head": p.head(), "runs": runs})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(report, b, 0o600); err != nil {
		t.Fatal(err)
	}
}
DRIVER */
