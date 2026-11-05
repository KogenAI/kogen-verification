'use strict';

// Steps of k-verify-pass-end-event-on-error. Nothing runs when this file is loaded. The first
// driver step builds the verify test binary once per run, with the Go driver at the end of this
// file added as verify/passaborted_acceptance_test.go through `go test -c -overlay`; each scenario
// then runs that binary's TestPassAbortedDriver for one case. The driver runs the real Verify on
// the stub project of the verify tests (its acceptance item, then the checks `first: sleep 1`
// and `second: true`) with an in-memory event log and writes one JSON report:
// every logged event, the returned error and Pass JSON, the progress text, the kogen-* entries
// left in the temporary folder and whether each scratch directory named by a command event still
// exists. The observer below judges that report. Child processes run asynchronously, so
// Cucumber's own report keeps each step's times.
//
// Run directly (`node <this file> good|bad`), the file checks its observer instead: `good` must
// accept the known-good reports, `bad` must reject every known-bad one.

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = 'k-verify-pass-end-event-on-error: ';
const TEST = 'TestPassAbortedDriver';

// masked removes what differs between identical runs or hosts: every *_ms key, the ms of the
// step_sweep events, the host-specific content of check_identity and identity_sha256, the random
// suffix of Kogen's scratch names and the numbering of the test's temporary folders.
function masked(value) {
  if (Array.isArray(value)) return value.map(masked);
  if (value && typeof value === 'object') {
    if (value.event === 'check_identity') return { event: 'check_identity' };
    const isSweep = value.event === 'step_sweep';
    return Object.fromEntries(Object.entries(value)
      .filter(([k]) => !k.endsWith('_ms') && k !== 'identity_sha256' && !(isSweep && k === 'ms'))
      .map(([k, v]) => [k, masked(v)]));
  }
  if (typeof value === 'string') {
    return value
      .replace(/(kogen-[a-z]+(?:-[a-z]+)*)-[0-9a-f]{8,}/g, '$1-<scratch>')
      .replace(/<tmp>\/[0-9]+/g, '<tmp>/<n>');
  }
  return value;
}

const show = (events) => events.map((e) => JSON.stringify(e)).join('\n');

const observe = {
  // events requires the whole masked log of the pass to be exactly these events, in order.
  events(report, expected) {
    assert.deepEqual(masked(report.events), expected, `the masked events of the ${report.case} case:\n${show(report.events)}`);
  },
  // wall requires the last event to carry an integer checks_wall_ms in [min, max).
  wall(report, min, max) {
    const last = report.events[report.events.length - 1];
    const where = `the last event of the ${report.case} case: ${JSON.stringify(last)}`;
    assert.ok(last && Object.hasOwn(last, 'checks_wall_ms'), `${where}: no checks_wall_ms`);
    assert.ok(Number.isInteger(last.checks_wall_ms), `${where}: checks_wall_ms is not an integer`);
    assert.ok(last.checks_wall_ms >= min && last.checks_wall_ms < max, `${where}: checks_wall_ms ${last.checks_wall_ms} is outside [${min}, ${max})`);
  },
  // outcome requires the returned error, the Pass JSON and the progress text, masked.
  outcome(report, expected) {
    const actual = { error: report.error, pass: report.pass, progress: report.progress };
    assert.deepEqual(masked(actual), expected, `the outcome of the ${report.case} case`);
  },
  // clean requires no kogen-* entry left in the temporary folder and no scratch directory named
  // by a command event to exist after the pass returned.
  clean(report) {
    assert.deepEqual(report.leftovers, [], `the ${report.case} case left these in the temporary folder`);
    const kept = report.scratch.filter((s) => s.exists).map((s) => s.cwd);
    assert.deepEqual(kept, [], `the ${report.case} case left these scratch directories`);
  },
};

// ---- observer controls ----

const IDENTITY = { event: 'check_identity', host: { os: 'linux' }, tree: '33ed' };
const ACCEPT = 'if grep -qx red app.txt; then cp \'<tmp>/004/red.ndjson\' "$KOGEN_ACCEPTANCE_REPORT"; echo actual-case-red; exit 1; fi; cp \'<tmp>/004/green.ndjson\' "$KOGEN_ACCEPTANCE_REPORT"';
const SCRATCH = '<tmp>/001/kogen-verify-025a2643379f3267';
const command = (name, cmd, cwd) => ({ command: cmd, ...(cwd ? { cwd } : {}), event: 'command', identity_sha256: 'a286', name });
const sweep = (name) => ({ event: 'step_sweep', ms: 3, name, stopped: 0 });
const result = (name, status, output, ms) => ({ event: 'command_result', name, output, status, wall_ms: ms });
const acceptance = (status = 0, output = '') => [command('acceptance', ACCEPT), sweep('acceptance'), result('acceptance', status, output, 10)];
const ran = (name, cmd, status, ms) => [command(name, cmd, SCRATCH), sweep(name), result(name, status, '', ms)];
const aborted = (cause, item, completed, ms) => ({ event: 'pass_aborted', pass: 1, cause, item, completed, checks_wall_ms: ms });
const EMPTY = '{"n":0,"clean":false,"green":false,"tree":"","setup":[],"acceptance":"not_run","model":"not_run","checks":[],"not_run":[],"moved":[],"failing":[]}';
const GREEN = '{"n":1,"clean":true,"green":true,"tree":"33ed361d54ee28bcdf0285a1bf2aefb1db155ed1","setup":[],"acceptance":{"status":0,"output":"","scenarios":[{"name":"First","line":2,"tags":[],"steps":[{"keyword":"Then ","text":"the candidate succeeds","line":3}],"unexercised_steps":[],"status":"passed","detail":null},{"name":"Later","line":4,"tags":[],"steps":[{"keyword":"Then ","text":"the candidate succeeds","line":5}],"unexercised_steps":[],"status":"passed","detail":null}],"problems":[],"binding_problems":[],"passed":2,"failed":0},"model":"none","checks":[{"name":"first","command":"sleep 1","status":0,"output":""},{"name":"second","command":"true","status":0,"output":""}],"not_run":[],"moved":[],"failing":[]}';
const RED = "{\"n\":1,\"clean\":true,\"green\":false,\"tree\":\"5029e8e261ce64760462abffe6154aebf18a30ff\",\"setup\":[],\"acceptance\":{\"status\":1,\"output\":\"actual-case-red\\n\",\"scenarios\":[{\"name\":\"First\",\"line\":2,\"tags\":[],\"steps\":[{\"keyword\":\"Then \",\"text\":\"the candidate succeeds\",\"line\":3}],\"unexercised_steps\":[],\"status\":\"failed\",\"detail\":\"acceptance.feature line 3: Then the candidate succeeds\",\"phase\":\"assertion\"},{\"name\":\"Later\",\"line\":4,\"tags\":[],\"steps\":[{\"keyword\":\"Then \",\"text\":\"the candidate succeeds\",\"line\":5}],\"unexercised_steps\":[],\"status\":\"failed\",\"detail\":\"acceptance.feature line 5: Then the candidate succeeds\",\"phase\":\"assertion\"}],\"problems\":[\"failed: First (line 2)\\nacceptance.feature line 3: Then the candidate succeeds\",\"failed: Later (line 4)\\nacceptance.feature line 5: Then the candidate succeeds\"],\"binding_problems\":[],\"passed\":0,\"failed\":2},\"model\":\"none\",\"checks\":[],\"not_run\":[\"first\",\"second\"],\"moved\":[],\"failing\":[\"acceptance\"]}";
const STARTED = 'kogen: verifying (pass 1)\n';

function goodReports() {
  const base = (name, events, error, pass = EMPTY, progress = STARTED) => ({
    case: name, events, error, pass, progress, leftovers: [],
    scratch: events.filter((e) => e.event === 'command' && e.cwd).map((e) => ({ cwd: e.cwd, exists: false })),
  });
  return {
    runner: base('runner', [IDENTITY, ...acceptance(), ...ran('first', 'sleep 1', 0, 1011), command('second', 'true', SCRATCH), aborted('runner_error', 'second', ['acceptance', 'first'], 1040)],
      { text: 'open <tmp>/001/missing/kogen-acceptance-marker-2bef8d8b12a5771a: no such file or directory', type: '*fs.PathError' }),
    cancel: base('cancel', [IDENTITY, ...acceptance(), ...ran('first', 'sleep 1', 0, 401), aborted('cancelled', 'first', ['acceptance'], 430)],
      { text: 'context canceled', type: '*errors.errorString' }),
    timeout: base('timeout', [IDENTITY, ...acceptance(), ...ran('first', 'sleep 1', 143, 601), aborted('timeout', 'first', ['acceptance'], 630)],
      { text: 'step command timed out', type: '*verify.stepTimeout' }),
    baseline: base('baseline', [IDENTITY, ...acceptance(), ...ran('first', 'sleep 1', 0, 1011), ...ran('second', 'true', 0, 9), aborted('baseline_changed', '', ['acceptance', 'first', 'second'], 1050)],
      { class: 'candidate', detail: 'the Build changed acceptance files: features/steps/fixture_steps.js', exit: 1, reason: 'baseline_changed', same_as_guard_refusal: true, text: 'candidate/baseline_changed: the Build changed acceptance files: features/steps/fixture_steps.js', type: '*sys.Error' }),
    tree: base('tree', [aborted('tree_error', '', [], 0)],
      { text: 'git read-tree 0000000000000000000000000000000000000000 failed (status 128): fatal: failed to unpack tree object 0000000000000000000000000000000000000000', type: '*git.CommandError' }),
    green: base('green', [IDENTITY, ...acceptance(), ...ran('first', 'sleep 1', 0, 1011), ...ran('second', 'true', 0, 8),
      { checks_wall_ms: 1043, event: 'pass', failing: [], files_changed_while_checks_ran: [], green: true, not_run: [], pass: 1 }],
    null, GREEN, 'kogen: verifying (pass 1)\nkogen: pass 1: all checks passed\n'),
    red: base('red', [IDENTITY, ...acceptance(1, 'actual-case-red\n'),
      { checks_wall_ms: 14, event: 'pass', failing: ['acceptance'], files_changed_while_checks_ran: [], green: false, not_run: ['first', 'second'], pass: 1 }],
    null, RED, 'kogen: verifying (pass 1)\nkogen: pass 1: acceptance failed; not run because an earlier item failed: first, second\n'),
  };
}

// WALLS are the checks_wall_ms bounds of the scenarios, per case.
const WALLS = { runner: [1000, 3000], cancel: [300, 3000], timeout: [500, 3000], baseline: [1000, 3000], tree: [0, 1], green: [1000, 3000], red: [0, 1000] };

function judge(x) {
  const g = goodReports();
  for (const name of Object.keys(g)) {
    observe.events(x[name], masked(g[name].events));
    observe.wall(x[name], ...WALLS[name]);
    observe.outcome(x[name], masked({ error: g[name].error, pass: g[name].pass, progress: g[name].progress }));
    observe.clean(x[name]);
  }
}

function controls(bad) {
  judge(goodReports());
  if (!bad) return;
  const last = (r) => r.events[r.events.length - 1];
  const mutations = [
    (x) => { x.runner.events.pop(); },
    (x) => { x.runner.events.splice(-2, 0, x.runner.events.pop()); },
    (x) => { x.runner.events.push({ ...last(x.green) }); },
    (x) => { x.runner.events.push({ ...last(x.runner) }); },
    (x) => { last(x.runner).cause = 'other'; },
    (x) => { last(x.runner).item = ''; },
    (x) => { last(x.runner).item = 'first'; },
    (x) => { last(x.runner).completed = ['first']; },
    (x) => { last(x.runner).completed = ['acceptance', 'first', 'second']; },
    (x) => { delete last(x.runner).completed; },
    (x) => { last(x.runner).pass = '1'; },
    (x) => { last(x.runner).event = 'pass'; },
    (x) => { last(x.runner).error = 'open'; },
    (x) => { delete last(x.runner).checks_wall_ms; },
    (x) => { last(x.runner).checks_wall_ms = 0; },
    (x) => { last(x.runner).checks_wall_ms = '1040'; },
    (x) => { last(x.runner).checks_wall_ms = 1040.5; },
    (x) => { x.runner.error.text = 'pass 1: ' + x.runner.error.text; },
    (x) => { x.runner.error.type = '*fmt.wrapError'; },
    (x) => { x.runner.error = null; },
    (x) => { x.runner.pass = GREEN; },
    (x) => { x.runner.progress += 'kogen: pass 1: aborted\n'; },
    (x) => { x.runner.leftovers = ['kogen-verify-0123456789abcdef']; },
    (x) => { x.runner.scratch[0].exists = true; },
    (x) => { x.cancel.events.pop(); },
    (x) => { last(x.cancel).cause = 'timeout'; },
    (x) => { last(x.cancel).item = ''; },
    (x) => { last(x.cancel).completed = []; },
    (x) => { last(x.cancel).checks_wall_ms = 1000 * 3; },
    (x) => { last(x.cancel).checks_wall_ms = 0; },
    (x) => { x.cancel.error.text = 'interrupted by SIGINT'; },
    (x) => { x.timeout.events.pop(); },
    (x) => { last(x.timeout).cause = 'cancelled'; },
    (x) => { last(x.timeout).cause = 'runner_error'; },
    (x) => { x.timeout.scratch[0].exists = true; },
    (x) => { x.baseline.events.pop(); },
    (x) => { last(x.baseline).cause = 'other'; },
    (x) => { last(x.baseline).item = 'second'; },
    (x) => { last(x.baseline).completed = ['acceptance', 'first']; },
    (x) => { last(x.baseline).checks_wall_ms = 999; },
    (x) => { x.baseline.error.same_as_guard_refusal = false; },
    (x) => { x.baseline.error.exit = 3; },
    (x) => { x.baseline.events.splice(-1, 0, { ...last(x.green) }); },
    (x) => { x.tree.events = []; },
    (x) => { last(x.tree).cause = 'other'; },
    (x) => { last(x.tree).completed = null; },
    (x) => { last(x.tree).checks_wall_ms = 1; },
    (x) => { x.tree.leftovers = ['kogen-index-0123456789abcdef']; },
    (x) => { x.green.events.push(aborted('other', '', ['acceptance', 'first', 'second'], 1043)); },
    (x) => { x.green.events.pop(); },
    (x) => { last(x.green).green = false; },
    (x) => { last(x.green).aborted = false; },
    (x) => { delete last(x.green).checks_wall_ms; },
    (x) => { last(x.green).checks_wall_ms = 999; },
    (x) => { x.green.pass = x.green.pass.replace('"n":1', '"n":2'); },
    (x) => { x.green.progress = STARTED; },
    (x) => { x.red.events.push(aborted('other', '', ['acceptance'], 14)); },
    (x) => { last(x.red).not_run = []; },
    (x) => { last(x.red).checks_wall_ms = 1000; },
    (x) => { x.red.error = { text: 'acceptance failed', type: '*errors.errorString' }; },
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
    if (!tmp) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'passaborted-'));
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
        fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(root, 'verify', 'passaborted_acceptance_test.go')]: driver } }));
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

  When(P + 'the pass driver runs the {string} case', { timeout: 115 * 1000 }, async function (name) {
    const bin = await testBinary();
    const result = path.join(scratch(), `report-${process.hrtime.bigint()}.json`);
    const args = ['-test.run', `^${TEST}$`, '-test.count=1', '-test.v', '-test.timeout=25s'];
    const shown = `${bin} ${args.join(' ')} (the verify test binary built with ${TEST} from ${__filename}, run in verify, case ${name})`;
    const r = await run(bin, args, { cwd: path.join(process.cwd(), 'verify'), env: { ...process.env, PASSABORTED_CASE: name, PASSABORTED_REPORT: result }, timeout: 28 * 1000 });
    assert.ok(r.code === 0 && fs.existsSync(result),
      `${shown}: ${TEST} wrote no report (absent, skipped, ran zero times or failed; exit ${r.code}): ${r.error ? r.error.message : ''}\n${r.stdout}${r.stderr}`);
    this.passAborted = JSON.parse(fs.readFileSync(result, 'utf8'));
    fs.rmSync(result, { force: true });
  });

  Then(P + 'the pass logs exactly these events once masked:', function (text) {
    observe.events(this.passAborted, JSON.parse(text));
  });

  Then(P + 'the last event has an integer checks_wall_ms from {int} to below {int}', function (min, max) {
    observe.wall(this.passAborted, min, max);
  });

  Then(P + 'the pass returns exactly this outcome once masked:', function (text) {
    observe.outcome(this.passAborted, JSON.parse(text));
  });

  Then(P + 'no scratch directory of the pass remains', function () {
    observe.clean(this.passAborted);
  });
}

/* DRIVER
package verify

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

// passAbortedLog keeps the events and calls onEvent with each one after keeping it.
type passAbortedLog struct {
	mu      sync.Mutex
	events  []map[string]any
	onEvent func(map[string]any)
}

func (l *passAbortedLog) Log(event map[string]any) {
	l.mu.Lock()
	l.events = append(l.events, event)
	hook := l.onEvent
	l.mu.Unlock()
	if hook != nil {
		hook(event)
	}
}

// TestPassAbortedDriver runs one verification pass of case PASSABORTED_CASE on the stub project
// with checks first (sleep 1) and second (true) and an in-memory event log, and writes every
// logged event, the returned error and Pass JSON, the progress text, the kogen-* entries left in
// the temporary folder and whether each scratch directory still exists to PASSABORTED_REPORT,
// with the test's temporary root written <tmp> and the project's HEAD <head>. Faults: runner
// points TMPDIR at a missing folder when the second check's command event is logged, so its
// runner cannot create the step's marker file; cancel cancels the context 300 ms after the first
// check's command event; timeout runs under an approval Attempt whose step bound is 500 ms;
// baseline has a guard that refuses after the checks; tree starts from a missing commit.
func TestPassAbortedDriver(t *testing.T) {
	report := os.Getenv("PASSABORTED_REPORT")
	if report == "" || !filepath.IsAbs(report) {
		t.Fatal("an absolute PASSABORTED_REPORT is required")
	}
	tmp := isolateTmp(t)
	base := filepath.Dir(tmp)
	p := newProj(t)
	p.Config.Checks = []project.Check{{Name: "first", Run: "sleep 1"}, {Name: "second", Run: "true"}}
	s, stderr := p.session()
	log := &passAbortedLog{}
	in := p.input(1)
	in.Log = log
	ctx := context.Background()
	var refusal error
	restore := func() {}
	switch c := os.Getenv("PASSABORTED_CASE"); c {
	case "runner":
		log.onEvent = func(e map[string]any) {
			if e["event"] == "command" && e["name"] == "second" {
				os.Setenv("TMPDIR", filepath.Join(tmp, "missing"))
			}
		}
		restore = func() { os.Setenv("TMPDIR", tmp) }
	case "cancel":
		cctx, cancel := context.WithCancel(ctx)
		defer cancel()
		ctx = cctx
		log.onEvent = func(e map[string]any) {
			if e["event"] == "command" && e["name"] == "first" {
				time.AfterFunc(300*time.Millisecond, cancel)
			}
		}
	case "timeout":
		a := NewAttempt(p.Root, fixtureSlug, nil)
		a.timeout = 500 * time.Millisecond
		ctx = a.Into(ctx)
	case "baseline":
		refusal = sys.Fail("candidate", "baseline_changed", "the Build changed acceptance files: features/steps/fixture_steps.js", 1)
		in.Intact = func() error { return refusal }
	case "tree":
		in.Start = "0000000000000000000000000000000000000000"
	case "green":
	case "red":
		p.write("app.txt", "red\n")
	default:
		t.Fatalf("unknown PASSABORTED_CASE %q", c)
	}
	got, err := Verify(ctx, s, in)
	restore()
	b, merr := json.Marshal(got)
	if merr != nil {
		t.Fatal(merr)
	}
	var outcome any
	if err != nil {
		o := map[string]any{"type": fmt.Sprintf("%T", err), "text": err.Error()}
		if e, ok := sys.AsError(err); ok {
			o["class"], o["reason"], o["detail"], o["exit"] = e.Class, e.Reason, e.Detail, e.Exit
		}
		if refusal != nil {
			o["same_as_guard_refusal"] = err == refusal
		}
		outcome = o
	}
	entries, rerr := os.ReadDir(tmp)
	if rerr != nil {
		t.Fatal(rerr)
	}
	leftovers := []string{}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "kogen-") {
			leftovers = append(leftovers, e.Name())
		}
	}
	scratch := []any{}
	for _, e := range log.events {
		if cwd, ok := e["cwd"].(string); ok && e["event"] == "command" {
			_, serr := os.Stat(cwd)
			scratch = append(scratch, map[string]any{"cwd": cwd, "exists": serr == nil})
		}
	}
	events := log.events
	if events == nil {
		events = []map[string]any{}
	}
	out, err := json.Marshal(map[string]any{"case": os.Getenv("PASSABORTED_CASE"), "events": events, "error": outcome, "pass": string(b), "progress": stderr.String(), "leftovers": leftovers, "scratch": scratch})
	if err != nil {
		t.Fatal(err)
	}
	text := strings.ReplaceAll(string(out), base, "<tmp>")
	if head := p.head(); head != "" {
		text = strings.ReplaceAll(text, head, "<head>")
	}
	if err := os.WriteFile(report, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
}
DRIVER */
