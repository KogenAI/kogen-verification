'use strict';

// Steps of v-setup-failed-output-tail. Nothing runs when this file is loaded. The first readiness
// step builds the verify test binary once per run, with the Go driver at the end of this file
// added as verify/v_setup_failed_output_tail_acceptance_test.go through `go test -c -overlay`;
// each scenario then runs that binary's TestVSetupFailedOutputTailDriver, which runs the real
// Readiness.Check over the fixture project with the scenario's setup commands and writes the
// environment/setup_failed outcome as JSON for the observer below. Child processes run
// asynchronously, so Cucumber's own report keeps each step's times.
//
// Run directly (`node <this file> good|bad`), the file checks its observer instead: `good` must
// accept the known-good outcomes, `bad` must reject every known-bad one.

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = 'v-setup-failed-output-tail: ';
const TEST = 'TestVSetupFailedOutputTailDriver';

const shownLines = (report) => JSON.stringify(report.lines);

const observe = {
  outcome(report, message) {
    assert.equal(report.message, message, `the readiness outcome; its lines: ${shownLines(report)}`);
    assert.equal(report.exit, 3, `the exit code of ${JSON.stringify(report.message)}`);
  },
  exactly(report, lines) {
    assert.deepEqual(report.lines, lines, `the lines of ${JSON.stringify(report.message)}`);
  },
  startsWith(report, lines) {
    assert.deepEqual(report.lines.slice(0, lines.length), lines, `the first ${lines.length} lines of ${JSON.stringify(report.message)}; all of them: ${shownLines(report)}`);
  },
  contains(report, text) {
    assert.ok(report.lines.some((line) => line.includes(text)), `no line of ${JSON.stringify(report.message)} contains ${JSON.stringify(text)}; its lines: ${shownLines(report)}`);
  },
};

// ---- observer controls ----

const FAILED = 'environment/setup_failed: Setup setup-2 failed (status=134).';
const TAIL = Array.from({ length: 20 }, (_, i) => String(i + 11));
const NEXT = 'next: fix commands.setup in .kogen/project.yaml (commit the change) or install what the command needs, then rerun the command that was refused';
const added = (command) => ['commands.setup[1]: ' + command, NEXT];

// goodReports are the outcomes the driver wrote for these setups on the unchanged tree.
function goodReports() {
  return {
    plain: { message: FAILED, exit: 3, lines: ['boom', ...added("sh -c 'echo boom >&2; kill -ABRT $$'")] },
    attempt: {
      message: FAILED,
      exit: 3,
      lines: [
        'boom',
        ...added("sh -c 'echo boom >&2; kill -ABRT $$'"),
        'Steps that ran, with wall time (each step has its own 120s limit):',
        '  snapshot: passed in 0.0s',
        '  materialize: passed in 0.1s',
        '  setup-1: passed in 0.0s',
        '  setup-2: failed with exit 134 after 0.0s',
        'Time in these steps: 0.1s',
        'Not run: acceptance',
        'Evidence: /Users/kogen-runner/work.noindex/scratch/delivery/t1105/go/TestVSetupFailedOutputTailDriver3919551303/002/.kogen/local/readiness/attempts/fixture-20261105T135801Z-7d4fcbb2/attempt.json',
      ],
    },
    both: { message: FAILED, exit: 3, lines: ['out', 'err', ...added('echo out; echo err >&2; kill -ABRT $$')] },
    tail: { message: FAILED, exit: 3, lines: [...TAIL, ...added('seq 1 30 >&2; kill -ABRT $$')] },
  };
}

function judge(x) {
  observe.outcome(x.plain, FAILED);
  observe.exactly(x.plain, ['boom', ...added("sh -c 'echo boom >&2; kill -ABRT $$'")]);
  observe.contains(x.plain, 'boom');
  observe.outcome(x.attempt, FAILED);
  observe.startsWith(x.attempt, ['boom']);
  observe.contains(x.attempt, 'boom');
  observe.outcome(x.both, FAILED);
  observe.exactly(x.both, ['out', 'err', ...added('echo out; echo err >&2; kill -ABRT $$')]);
  observe.outcome(x.tail, FAILED);
  observe.exactly(x.tail, [...TAIL, ...added('seq 1 30 >&2; kill -ABRT $$')]);
}

function controls(bad) {
  judge(goodReports());
  if (!bad) return;
  const mutations = [
    (x) => { x.plain.lines = ['']; },
    (x) => { x.plain.lines = []; },
    (x) => { x.plain.lines = ['boom', '']; },
    (x) => { x.plain.message = 'environment/setup_failed: Setup setup-2 failed (status=-1).'; },
    (x) => { x.plain.message = 'environment/setup_failed: Setup setup-1 failed (status=134).'; },
    (x) => { x.plain.exit = 1; },
    (x) => { x.attempt.lines = ['']; },
    (x) => { x.attempt.lines = ['Steps that ran, with wall time (each step has its own 120s limit):', 'boom']; },
    (x) => { x.attempt.lines = ['bo', 'om']; },
    (x) => { x.both.lines = ['err', 'out']; },
    (x) => { x.both.lines = ['out']; },
    (x) => { x.tail.lines = TAIL.slice(1); },
    (x) => { x.tail.lines = ['10', ...TAIL]; },
    (x) => { x.tail.lines = TAIL.slice().reverse(); },
  ];
  for (const mutate of mutations) {
    const altered = goodReports();
    mutate(altered);
    assert.throws(() => judge(altered), `the observer accepted a known-bad outcome: ${mutate}`);
  }
  throw new Error('known-bad outcomes rejected');
}

if (require.main === module) {
  try {
    controls(process.argv[2] === 'bad');
    console.log('accepted');
  } catch (error) {
    if (error.message === 'known-bad outcomes rejected') console.log('rejected');
    else console.error(error);
    process.exitCode = 1;
  }
} else {
  const { AfterAll, Given, When, Then } = require('@cucumber/cucumber');

  let tmp;
  let prebuilt;

  const scratch = () => {
    if (!tmp) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v-setup-failed-output-tail-'));
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
        fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(root, 'verify', 'v_setup_failed_output_tail_acceptance_test.go')]: driver } }));
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

  // drive runs the driver once with these setup commands and returns the outcome it wrote.
  const drive = async (setup, attempt) => {
    const bin = await testBinary();
    const result = path.join(scratch(), `result-${process.hrtime.bigint()}.json`);
    const args = ['-test.run', `^${TEST}$`, '-test.count=1', '-test.v', '-test.timeout=25s'];
    const shown = `${bin} ${args.join(' ')} (the verify test binary built with ${TEST} from ${__filename}, run in verify)`;
    const env = { ...process.env, VSFOT_SETUP: JSON.stringify(setup), VSFOT_ATTEMPT: attempt ? '1' : '', VSFOT_RESULT: result };
    const r = await run(bin, args, { cwd: path.join(process.cwd(), 'verify'), env, timeout: 28 * 1000 });
    assert.ok(r.code === 0 && fs.existsSync(result),
      `${shown}: ${TEST} wrote no outcome (absent, skipped, ran zero times or failed; exit ${r.code}): ${r.error ? r.error.message : ''}\n${r.stdout}${r.stderr}`);
    const report = JSON.parse(fs.readFileSync(result, 'utf8'));
    fs.rmSync(result, { force: true });
    return report;
  };

  const column = (table) => table.hashes().map((row) => row.line);

  Given(P + 'the setup commands:', function (table) {
    this.vsfotSetup = table.hashes().map((row) => row.command);
  });

  When(P + 'readiness checks the fixture Intent without a diagnostic attempt', { timeout: 115 * 1000 }, async function () {
    this.vsfot = await drive(this.vsfotSetup || [], false);
  });

  When(P + 'readiness checks the fixture Intent with a diagnostic attempt', { timeout: 115 * 1000 }, async function () {
    this.vsfot = await drive(this.vsfotSetup || [], true);
  });

  Then(P + 'the outcome is {string} with exit 3', function (message) {
    observe.outcome(this.vsfot, message);
  });

  Then(P + 'the outcome lines are exactly:', function (table) {
    observe.exactly(this.vsfot, column(table));
  });

  Then(P + 'the outcome lines start with:', function (table) {
    observe.startsWith(this.vsfot, column(table));
  });

  Then(P + 'an outcome line contains {string}', function (text) {
    observe.contains(this.vsfot, text);
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

// TestVSetupFailedOutputTailDriver runs Readiness.Check once over the fixture project with the
// setup commands of VSFOT_SETUP (a JSON array), with a diagnostic Attempt when VSFOT_ATTEMPT is
// 1, and writes the outcome's message, exit code and lines to VSFOT_RESULT.
func TestVSetupFailedOutputTailDriver(t *testing.T) {
	result := os.Getenv("VSFOT_RESULT")
	if result == "" || !filepath.IsAbs(result) {
		t.Fatal("an absolute VSFOT_RESULT is required")
	}
	var setup []string
	if err := json.Unmarshal([]byte(os.Getenv("VSFOT_SETUP")), &setup); err != nil {
		t.Fatalf("VSFOT_SETUP: %v", err)
	}
	isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = setup
	r := p.readiness()
	if os.Getenv("VSFOT_ATTEMPT") == "1" {
		r.Attempt = NewAttempt(p.Root, fixtureSlug, nil)
	}
	s, _ := p.session()
	_, err := r.Check(context.Background(), s, fixtureSlug)
	if err == nil {
		t.Fatal("readiness passed; the scenario's setup must fail")
	}
	e, ok := sys.AsError(err)
	if !ok {
		t.Fatalf("readiness returned a non-contract error: %v", err)
	}
	lines := e.Lines
	if lines == nil {
		lines = []string{}
	}
	b, err := json.Marshal(map[string]any{"message": e.Error(), "exit": e.Exit, "lines": lines})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(result, b, 0o600); err != nil {
		t.Fatal(err)
	}
}
DRIVER */
