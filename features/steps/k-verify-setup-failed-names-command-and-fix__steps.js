'use strict';

// Steps of k-verify-setup-failed-names-command-and-fix. Nothing runs when this file is loaded.
// The first step that runs setup builds the verify test binary once per run, with the Go driver
// at the end of this file added as
// verify/k_verify_setup_failed_names_command_and_fix_acceptance_test.go through
// `go test -c -overlay`; each scenario then runs that binary's
// TestKVerifySetupFailedNamesCommandAndFixDriver. The driver runs the real Readiness.Setup over
// the fixture project with the scenario's setup commands, as shaping runs it (reusing a passed
// setup) or as a Build runs it (always), or the real Readiness.Check, with or without a
// diagnostic Attempt. It writes the outcome (the refusal's message, exit code, detail lines and
// printed form, and the progress written to standard error) as JSON for the observer below.
// Child processes run asynchronously, so Cucumber's own report keeps each step's times.
//
// Run directly (`node <this file> good|bad`), the file checks its observer instead: `good` must
// accept the known-good outcomes, `bad` must reject every known-bad one.

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = 'k-verify-setup-failed-names-command-and-fix: ';
const TEST = 'TestKVerifySetupFailedNamesCommandAndFixDriver';

const shown = (report) => JSON.stringify(report.lines);

const observe = {
  refused(report, message) {
    assert.equal(report.ok, false, `the setup passed; the scenario's setup must fail; progress: ${JSON.stringify(report.progress)}`);
    assert.equal(report.message, message, `the refusal's first line; its detail lines: ${shown(report)}`);
    assert.equal(report.exit, 3, `the exit code of ${JSON.stringify(report.message)}`);
    assert.equal(report.render.split('\n')[0], message, `the first printed line; printed: ${JSON.stringify(report.render)}`);
  },
  passed(report) {
    assert.equal(report.ok, true, `the setup was refused with ${JSON.stringify(report.message)}; its detail lines: ${shown(report)}`);
  },
  count(report, n) {
    assert.equal(report.lines.length, n, `the number of detail lines of ${JSON.stringify(report.message)}; they are: ${shown(report)}`);
  },
  line(report, n, text) {
    assert.equal(report.lines[n - 1], text, `detail line ${n} of ${JSON.stringify(report.message)}; all of them: ${shown(report)}`);
  },
  lineContains(report, n, text) {
    const line = report.lines[n - 1];
    assert.ok(typeof line === 'string' && line.includes(text), `detail line ${n} of ${JSON.stringify(report.message)} does not contain ${JSON.stringify(text)}; all of them: ${shown(report)}`);
  },
  lineStartsWith(report, n, text) {
    const line = report.lines[n - 1];
    assert.ok(typeof line === 'string' && line.startsWith(text), `detail line ${n} of ${JSON.stringify(report.message)} does not start with ${JSON.stringify(text)}; all of them: ${shown(report)}`);
  },
  lastStartsWith(report, text) {
    const line = report.lines[report.lines.length - 1];
    assert.ok(typeof line === 'string' && line.startsWith(text), `the last detail line of ${JSON.stringify(report.message)} does not start with ${JSON.stringify(text)}; all of them: ${shown(report)}`);
  },
  exactly(report, lines) {
    assert.deepEqual(report.lines, lines, `the detail lines of ${JSON.stringify(report.message)}`);
  },
  startsWith(report, lines) {
    assert.deepEqual(report.lines.slice(0, lines.length), lines, `the first ${lines.length} detail lines of ${JSON.stringify(report.message)}; all of them: ${shown(report)}`);
  },
  printed(report, text) {
    assert.ok(report.render.includes(`\n  ${text}\n`), `the printed refusal has no detail line ${JSON.stringify(text)}; printed: ${JSON.stringify(report.render)}`);
  },
  progress(report, lines) {
    assert.equal(report.progress, lines.map((l) => l + '\n').join(''), 'the progress written to standard error');
  },
  nowhere(report, text) {
    for (const [what, value] of [['the progress', report.progress], ['the printed refusal', report.render], ['the detail lines', report.lines.join('\n')]]) {
      assert.ok(!value.includes(text), `${what} contains ${JSON.stringify(text)}: ${JSON.stringify(value)}`);
    }
  },
};

// ---- observer controls ----

const M127 = 'environment/setup_failed: Setup setup-1 failed (status=127).';
const M1 = 'environment/setup_failed: Setup setup-2 failed (status=1).';
const MISSING = 'definitely-not-a-program --x';
const BROKE = 'echo first; echo setup-broke >&2; exit 1';
const NEXT = 'next: fix commands.setup in .kogen/project.yaml (commit the change) or install what the command needs, then rerun the command that was refused';
const NEXT127 = 'next: the program was not found; fix commands.setup in .kogen/project.yaml (commit the change) or install what the command needs, then rerun the command that was refused';

const rendered = (message, lines) => message + '\n' + lines.map((l) => '  ' + l + '\n').join('');
const refusal = (message, lines, progress) => ({ ok: false, message, exit: 3, lines, render: rendered(message, lines), progress });

// goodReports are the outcomes the requested implementation produces for the scenarios' setups;
// their output tails, step summary and progress are what the driver wrote on the unchanged tree.
function goodReports() {
  const missing = ['/bin/sh: 1: definitely-not-a-program: not found', `commands.setup[0]: ${MISSING}`, NEXT127];
  const broke = ['first', 'setup-broke', `commands.setup[1]: ${BROKE}`, NEXT];
  return {
    missing: refusal(M127, missing, `kogen: running setup-1: ${MISSING}\n`),
    broke: refusal(M1, broke, `kogen: running setup-1: true\nkogen: running setup-2: ${BROKE}\n`),
    attempt: refusal(M1, [
      ...broke,
      'Steps that ran, with wall time (each step has its own 120s limit):',
      '  snapshot: passed in 0.0s',
      '  materialize: passed in 0.0s',
      '  setup-1: passed in 0.0s',
      '  setup-2: failed with exit 1 after 0.0s',
      'Time in these steps: 0.0s',
      'Not run: acceptance',
      'Evidence: /tmp/TestKVerifySetupFailedNamesCommandAndFixDriver1/002/.kogen/local/readiness/attempts/fixture-20261107T120000Z-0a1b2c3d/attempt.json',
    ], ''),
    pass: { ok: true, message: '', exit: 0, lines: [], render: '', progress: 'kogen: running setup-1: true\n' },
  };
}

function judge(x) {
  observe.refused(x.missing, M127);
  observe.count(x.missing, 3);
  observe.lineContains(x.missing, 1, 'definitely-not-a-program');
  observe.lineContains(x.missing, 1, 'not found');
  observe.line(x.missing, 2, `commands.setup[0]: ${MISSING}`);
  observe.line(x.missing, 3, NEXT127);
  observe.printed(x.missing, `commands.setup[0]: ${MISSING}`);
  observe.progress(x.missing, [`kogen: running setup-1: ${MISSING}`]);
  observe.refused(x.broke, M1);
  observe.exactly(x.broke, ['first', 'setup-broke', `commands.setup[1]: ${BROKE}`, NEXT]);
  observe.progress(x.broke, ['kogen: running setup-1: true', `kogen: running setup-2: ${BROKE}`]);
  observe.refused(x.attempt, M1);
  observe.startsWith(x.attempt, ['first', 'setup-broke', `commands.setup[1]: ${BROKE}`, NEXT]);
  observe.lineStartsWith(x.attempt, 5, 'Steps that ran, with wall time');
  observe.lastStartsWith(x.attempt, 'Evidence: ');
  observe.passed(x.pass);
  observe.progress(x.pass, ['kogen: running setup-1: true']);
  observe.nowhere(x.pass, 'commands.setup');
  observe.nowhere(x.pass, '.kogen/project.yaml');
  observe.nowhere(x.pass, 'next:');
}

function controls(bad) {
  judge(goodReports());
  if (!bad) return;
  const relines = (r, lines) => { r.lines = lines; r.render = rendered(r.message, lines); };
  const mutations = [
    // The unchanged tree: only the output tail.
    (x) => relines(x.missing, x.missing.lines.slice(0, 1)),
    (x) => relines(x.broke, ['first', 'setup-broke']),
    (x) => relines(x.attempt, [...x.attempt.lines.slice(0, 2), ...x.attempt.lines.slice(4)]),
    // A one-based position, or the step id instead of the position.
    (x) => relines(x.missing, [x.missing.lines[0], `commands.setup[1]: ${MISSING}`, NEXT127]),
    (x) => relines(x.broke, ['first', 'setup-broke', `commands.setup[2]: ${BROKE}`, NEXT]),
    (x) => relines(x.broke, ['first', 'setup-broke', `setup-2: ${BROKE}`, NEXT]),
    // The command not as written.
    (x) => relines(x.missing, [x.missing.lines[0], 'commands.setup[0]: definitely-not-a-program', NEXT127]),
    // The wrong next step for the status.
    (x) => relines(x.missing, [x.missing.lines[0], `commands.setup[0]: ${MISSING}`, NEXT]),
    (x) => relines(x.broke, ['first', 'setup-broke', `commands.setup[1]: ${BROKE}`, NEXT127]),
    (x) => relines(x.broke, ['first', 'setup-broke', `commands.setup[1]: ${BROKE}`, NEXT + '.']),
    // The added lines before the output tail, the tail lost or reordered.
    (x) => relines(x.broke, [`commands.setup[1]: ${BROKE}`, NEXT, 'first', 'setup-broke']),
    (x) => relines(x.broke, [`commands.setup[1]: ${BROKE}`, NEXT]),
    (x) => relines(x.missing, [`commands.setup[0]: ${MISSING}`, NEXT127]),
    (x) => relines(x.broke, ['setup-broke', 'first', `commands.setup[1]: ${BROKE}`, NEXT]),
    // The added lines after the attempt's step summary.
    (x) => relines(x.attempt, [...x.attempt.lines.slice(0, 2), ...x.attempt.lines.slice(4), ...x.attempt.lines.slice(2, 4)]),
    // A changed first line or exit code.
    (x) => { x.missing.message = 'environment/setup_failed: Setup commands.setup[0] failed (status=127).'; x.missing.render = rendered(x.missing.message, x.missing.lines); },
    (x) => { x.broke.message = 'environment/setup_failed: Setup setup-2 failed (status=1): echo first'; x.broke.render = rendered(x.broke.message, x.broke.lines); },
    (x) => { x.missing.exit = 1; },
    (x) => { x.missing.render = 'kogen: ' + x.missing.render; },
    (x) => { x.missing.render = x.missing.render.replace(`\n  commands.setup[0]: ${MISSING}\n`, `\ncommands.setup[0]: ${MISSING}\n`); },
    // Progress lines removed or added to.
    (x) => { x.missing.progress = ''; },
    (x) => { x.broke.progress = `kogen: running setup-2: ${BROKE}\n`; },
    (x) => { x.pass.progress += 'commands.setup[0]: true\n'; },
    (x) => { x.pass.progress += `${NEXT}\n`; },
    (x) => { x.pass.ok = false; },
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
    if (!tmp) tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'k-verify-setup-failed-names-command-and-fix-'));
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
        fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(root, 'verify', 'k_verify_setup_failed_names_command_and_fix_acceptance_test.go')]: driver } }));
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

  // drive runs the driver once with these setup commands through entry and returns the outcome
  // it wrote.
  const drive = async (setup, entry) => {
    const bin = await testBinary();
    const result = path.join(scratch(), `result-${process.hrtime.bigint()}.json`);
    const args = ['-test.run', `^${TEST}$`, '-test.count=1', '-test.v', '-test.timeout=25s'];
    const shownRun = `${bin} ${args.join(' ')} (the verify test binary built with ${TEST} from ${__filename}, run in verify, entry ${entry})`;
    const env = { ...process.env, KVSF_SETUP: JSON.stringify(setup), KVSF_ENTRY: entry, KVSF_RESULT: result };
    const r = await run(bin, args, { cwd: path.join(process.cwd(), 'verify'), env, timeout: 28 * 1000 });
    assert.ok(r.code === 0 && fs.existsSync(result),
      `${shownRun}: ${TEST} wrote no outcome (absent, skipped, ran zero times or failed; exit ${r.code}): ${r.error ? r.error.message : ''}\n${r.stdout}${r.stderr}`);
    const report = JSON.parse(fs.readFileSync(result, 'utf8'));
    fs.rmSync(result, { force: true });
    return report;
  };

  const column = (table) => table.hashes().map((row) => row.line);

  Given(P + 'the setup commands:', function (table) {
    this.kvsfSetup = table.hashes().map((row) => row.command);
  });

  const entries = {
    'shaping runs the setup': 'shaping',
    'a Build runs the setup': 'build',
    'a readiness check runs the setup': 'check',
    'a readiness check with a diagnostic attempt runs the setup': 'check-attempt',
  };
  for (const [sentence, entry] of Object.entries(entries)) {
    When(P + sentence, { timeout: 115 * 1000 }, async function () {
      this.kvsf = await drive(this.kvsfSetup || [], entry);
    });
  }

  Then(P + 'the refusal is {string} with exit 3', function (message) {
    observe.refused(this.kvsf, message);
  });

  Then(P + 'the setup passes', function () {
    observe.passed(this.kvsf);
  });

  Then(P + 'the refusal has {int} detail lines', function (n) {
    observe.count(this.kvsf, n);
  });

  Then(P + 'detail line {int} is {string}', function (n, text) {
    observe.line(this.kvsf, n, text);
  });

  Then(P + 'detail line {int} contains {string}', function (n, text) {
    observe.lineContains(this.kvsf, n, text);
  });

  Then(P + 'detail line {int} starts with {string}', function (n, text) {
    observe.lineStartsWith(this.kvsf, n, text);
  });

  Then(P + 'the last detail line starts with {string}', function (text) {
    observe.lastStartsWith(this.kvsf, text);
  });

  Then(P + 'the detail lines are exactly:', function (table) {
    observe.exactly(this.kvsf, column(table));
  });

  Then(P + 'the detail lines start with:', function (table) {
    observe.startsWith(this.kvsf, column(table));
  });

  Then(P + 'the printed refusal has the detail line {string}', function (text) {
    observe.printed(this.kvsf, text);
  });

  Then(P + 'the progress lines are exactly:', function (table) {
    observe.progress(this.kvsf, column(table));
  });

  Then(P + 'nothing printed contains {string}', function (text) {
    observe.nowhere(this.kvsf, text);
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

// TestKVerifySetupFailedNamesCommandAndFixDriver runs the setup commands of KVSF_SETUP (a JSON
// array) over the fixture project once, through the entry KVSF_ENTRY names: shaping
// (Readiness.Setup reusing a passed setup), build (Readiness.Setup always running it), check
// (Readiness.Check) or check-attempt (Readiness.Check with a diagnostic Attempt). It writes
// whether it passed, the refusal's message, exit code, detail lines and printed form, and the
// progress written to standard error, to KVSF_RESULT.
func TestKVerifySetupFailedNamesCommandAndFixDriver(t *testing.T) {
	result := os.Getenv("KVSF_RESULT")
	if result == "" || !filepath.IsAbs(result) {
		t.Fatal("an absolute KVSF_RESULT is required")
	}
	var setup []string
	if err := json.Unmarshal([]byte(os.Getenv("KVSF_SETUP")), &setup); err != nil {
		t.Fatalf("KVSF_SETUP: %v", err)
	}
	isolateTmp(t)
	p := newProj(t)
	p.Config.Setup = setup
	r := p.readiness()
	s, stderr := p.session()
	ctx := context.Background()
	var err error
	switch entry := os.Getenv("KVSF_ENTRY"); entry {
	case "shaping":
		err = r.Setup(ctx, s, p.Root, true)
	case "build":
		err = r.Setup(ctx, s, p.Root, false)
	case "check":
		_, err = r.Check(ctx, s, fixtureSlug)
	case "check-attempt":
		r.Attempt = NewAttempt(p.Root, fixtureSlug, nil)
		_, err = r.Check(ctx, s, fixtureSlug)
	default:
		t.Fatalf("unknown KVSF_ENTRY %q", entry)
	}
	out := map[string]any{"ok": err == nil, "message": "", "exit": 0, "lines": []string{}, "render": "", "progress": stderr.String()}
	if err != nil {
		e, ok := sys.AsError(err)
		if !ok {
			t.Fatalf("the setup returned a non-contract error: %v", err)
		}
		lines := e.Lines
		if lines == nil {
			lines = []string{}
		}
		out["message"], out["exit"], out["lines"], out["render"] = e.Error(), e.Exit, lines, e.Render()
	}
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(result, b, 0o600); err != nil {
		t.Fatal(err)
	}
}
DRIVER */
