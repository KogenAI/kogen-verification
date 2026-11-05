'use strict';

// Steps of k-verify-acceptance-reaper-continuous-reap. Nothing runs when this file is loaded. The
// steps run scripts under the Linux acceptance helper of package verify through the Go program
// HARNESS below, which the first step that needs it builds once per run (as the virtual package
// ./features/steps/testdata/acceptancereaper through `go build -overlay`, so no file is written
// into the checkout) and later steps reuse. Child processes run asynchronously, so Cucumber's own
// report keeps each step's times.
//
// Run directly (`node <this file> good|bad`), the file checks its observers instead, on the
// scripts of the feature file: `good` runs them under a control subreaper that reaps every child
// while the shell runs and must be accepted; `bad` runs them under a control subreaper that waits
// only for the shell (the reported behavior) and, with synthetic results, must be rejected.

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SLUG = 'k-verify-acceptance-reaper-continuous-reap';
const P = SLUG + ': ';
const FLAG = '--kogen-verification-acceptance-reaper';
const FEATURE = path.join('.kogen', 'intents', SLUG, 'acceptance.feature');

// HARNESS links package verify, whose init makes it the acceptance helper when it is started as
// `<harness> --kogen-verification-acceptance-reaper <script>`.
const HARNESS = `// Command acceptancereaper is the acceptance harness of k-verify-acceptance-reaper-continuous-reap.
// It links package verify, whose init turns it into the acceptance helper when it is started as
// "acceptancereaper --kogen-verification-acceptance-reaper <script>". Its own modes:
//
//	acceptancereaper launch <file>          start /bin/sleep 300 in a new session with an empty
//	                                        environment and no inherited descriptors, write its
//	                                        pid to <file> and exit without waiting for it
//	acceptancereaper control-good <script>  control subreaper: runs /bin/sh -c <script> and reaps
//	                                        every child while the shell runs, then reaps and kills
//	                                        the rest
//	acceptancereaper control-bad <script>   control subreaper: waits only for the shell, then reaps
//	                                        and kills the rest
//
// The controls return the shell's status (128+n for a signal n). Misuse exits 2.
package main

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	_ "github.com/KogenAI/kogen-verification/verify"
)

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: acceptancereaper launch <file> | control-good <script> | control-bad <script>")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "launch":
		cmd := exec.Command("/bin/sleep", "300")
		cmd.Env = []string{}
		cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
		if err := cmd.Start(); err != nil {
			fmt.Fprintln(os.Stderr, "acceptancereaper:", err)
			os.Exit(2)
		}
		if err := os.WriteFile(os.Args[2], []byte(strconv.Itoa(cmd.Process.Pid)), 0o644); err != nil {
			fmt.Fprintln(os.Stderr, "acceptancereaper:", err)
			os.Exit(2)
		}
	case "control-good", "control-bad":
		os.Exit(control(os.Args[1] == "control-good", os.Args[2]))
	default:
		fmt.Fprintln(os.Stderr, "acceptancereaper: unknown mode", os.Args[1])
		os.Exit(2)
	}
}

func control(reapAll bool, script string) int {
	if _, _, errno := syscall.Syscall(syscall.SYS_PRCTL, 36, 1, 0); errno != 0 {
		fmt.Fprintln(os.Stderr, "acceptancereaper: prctl:", errno)
		return 2
	}
	attr := &os.ProcAttr{Files: []*os.File{os.Stdin, os.Stdout, os.Stderr}, Env: os.Environ()}
	proc, err := os.StartProcess("/bin/sh", []string{"/bin/sh", "-c", script}, attr)
	if err != nil {
		return 127
	}
	wanted := proc.Pid
	if reapAll {
		wanted = -1
	}
	var ws syscall.WaitStatus
	for {
		pid, err := syscall.Wait4(wanted, &ws, 0, nil)
		if err == syscall.EINTR {
			continue
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "acceptancereaper: wait4:", err)
			return 2
		}
		if pid == proc.Pid {
			break
		}
	}
	stopChildren()
	if ws.Signaled() {
		return 128 + int(ws.Signal())
	}
	return ws.ExitStatus()
}

// stopChildren reaps the exited children and kills the live ones until none is left.
func stopChildren() {
	self := strconv.Itoa(os.Getpid())
	for {
		for {
			pid, err := syscall.Wait4(-1, nil, syscall.WNOHANG, nil)
			if err == syscall.EINTR || pid > 0 {
				continue
			}
			break
		}
		dirs, _ := os.ReadDir("/proc")
		left := false
		for _, d := range dirs {
			stat, err := os.ReadFile("/proc/" + d.Name() + "/stat")
			if err != nil {
				continue
			}
			fields := strings.Fields(string(stat[strings.LastIndexByte(string(stat), ')')+1:]))
			if len(fields) < 2 || fields[1] != self {
				continue
			}
			left = true
			if pid, err := strconv.Atoi(d.Name()); err == nil && fields[0] != "Z" {
				syscall.Kill(pid, syscall.SIGKILL)
			}
		}
		if !left {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
}
`;

// GROUP_TEST is the fixture Go test: it starts /bin/sh with a background /bin/sleep 300 as one new
// process group, kills that group, waits for the shell, and then waits at most 5 seconds for the
// sleep (an orphan by then) to be gone.
const GROUP_TEST = `package groupgone

import (
	"bufio"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestGroupGone(t *testing.T) {
	cmd := exec.Command("/bin/sh", "-c", "/bin/sleep 300 & echo $!; wait")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(out).ReadString('\\n')
	if err != nil {
		t.Fatal(err)
	}
	member, err := strconv.Atoi(strings.TrimSpace(line))
	if err != nil {
		t.Fatal(err)
	}
	if err := syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	cmd.Wait()
	deadline := time.Now().Add(5 * time.Second)
	for syscall.Kill(member, 0) == nil {
		if time.Now().After(deadline) {
			stat, _ := os.ReadFile("/proc/" + strconv.Itoa(member) + "/stat")
			t.Fatalf("member %d of the killed group is still present after 5s: %s", member, stat)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
`;

const dirs = [];
let harness;

// tmp makes a fresh temporary directory, removed after the run.
function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function cleanup() {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
  harness = undefined;
}

function sq(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// run starts file without blocking the event loop and resolves with its exit status (null when
// it did not exit normally), standard output, standard error and error.
function run(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      const status = !error ? 0 : (typeof error.code === 'number' ? error.code : null);
      resolve({ status, stdout, stderr, error });
    });
  });
}

// ensureHarness builds HARNESS the first time a step needs it and reuses it for the rest of the run.
function ensureHarness() {
  if (!harness) {
    harness = (async () => {
      assert.equal(process.platform, 'linux', 'the acceptance helper with a subreaper exists on Linux only');
      const dir = tmp('acceptancereaper-harness-');
      const bin = path.join(dir, 'acceptancereaper');
      const src = path.join(dir, 'main.go');
      fs.writeFileSync(src, HARNESS);
      const overlay = path.join(dir, 'overlay.json');
      fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(process.cwd(), 'features/steps/testdata/acceptancereaper/main.go')]: src } }));
      const args = ['build', '-overlay', overlay, '-o', bin, './features/steps/testdata/acceptancereaper'];
      const r = await run('go', args, { timeout: 100 * 1000 });
      assert.equal(r.status, 0, `go ${args.join(' ')} failed (exit ${r.status}): ${r.stdout}${r.stderr}${r.status === null ? r.error.message : ''}`);
      return bin;
    })();
    harness.catch(() => { harness = undefined; });
  }
  return harness;
}

// runScript runs script in dir as `/bin/sh -c "exec <harness> <mode> '<script>'"`, where mode is
// the helper's flag or a control mode, and returns its status and output.
async function runScript(mode, script, dir) {
  const bin = await ensureHarness();
  const command = `exec ${sq(bin)} ${mode} ${sq(script)}`;
  const env = {
    ...process.env, FIXTURE_NODE: process.execPath, FIXTURE_HARNESS: bin,
    GOFLAGS: '', GOWORK: 'off', GOTOOLCHAIN: 'local', GOPROXY: 'off',
  };
  const r = await run('/bin/sh', ['-c', command], { cwd: dir, env, timeout: 90 * 1000 });
  return { where: `${mode} running ${JSON.stringify(script)} in ${dir}`, dir, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// groupModule writes the fixture Go module with TestGroupGone into a fresh directory.
function groupModule() {
  const dir = tmp('acceptancereaper-module-');
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module groupgone\n\ngo 1.22\n');
  fs.writeFileSync(path.join(dir, 'group_test.go'), GROUP_TEST);
  return dir;
}

function judgeOutput(r, status, output) {
  assert.deepEqual({ status: r.status, output: r.stdout }, { status, output },
    `${r.where}: exit ${r.status}, output ${JSON.stringify(r.stdout)}, standard error ${JSON.stringify(r.stderr)}; want exit ${status}, output ${JSON.stringify(output)}`);
}

function judgeMillis(dir, name, max) {
  const file = path.join(dir, name);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '(absent)';
  assert.ok(/^\d+\n$/.test(text) && Number(text) <= max, `${file} holds ${JSON.stringify(text)}; want a number of milliseconds of at most ${max}`);
}

// judgeGoTestPassed requires the go test run to exit 0, to have run TestGroupGone and passed it.
function judgeGoTestPassed(r) {
  assert.ok(r.status === 0 && /^--- PASS: TestGroupGone \(/m.test(r.stdout) && /^ok\s/m.test(r.stdout),
    `${r.where}: want exit 0 with the lines "--- PASS: TestGroupGone (...)" and "ok ..."; got exit ${r.status}, output ${JSON.stringify(r.stdout)}, standard error ${JSON.stringify(r.stderr)}`);
}

// procState is the state letter of pid, or undefined when pid does not exist.
function procState(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
  } catch {
    return undefined;
  }
}

// judgeStopped requires every process whose pid one of the named files holds to be gone (or a
// zombie); it kills survivors after naming them.
function judgeStopped(dir, names) {
  const problems = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : '';
    if (!/^\d+$/.test(text)) { problems.push(`${file} holds no pid: ${JSON.stringify(text)}`); continue; }
    const state = procState(Number(text));
    if (state !== undefined && state !== 'Z' && state !== 'X') {
      problems.push(`${name}: process ${text} is still running (state ${state}) after the helper returned`);
      try { process.kill(Number(text), 'SIGKILL'); } catch { /* gone */ }
    }
  }
  assert.ok(problems.length === 0, problems.join('\n'));
}

// featureScript returns the script of the scenario titled title in the feature file.
function featureScript(title) {
  const lines = fs.readFileSync(FEATURE, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === `Scenario: ${title}`);
  assert.ok(start >= 0, `no scenario ${JSON.stringify(title)} in ${FEATURE}`);
  const open = lines.findIndex((l, i) => i > start && l.trim() === '"""');
  const close = lines.findIndex((l, i) => i > open && l.trim() === '"""');
  const indent = lines[open].indexOf('"""');
  return lines.slice(open + 1, close).map((l) => l.slice(indent)).join('\n');
}

const GROUP_SCENARIO = 'A process-group member adopted by the helper and killed while the shell runs is gone at once';
const GROUP_OUTPUT = 'member adopted by the helper\ngone\n';
const GO_SCENARIO = 'A Go test that kills a process group and waits for it to be gone passes as the check under the helper';

// controls runs the observers of the two scenarios that are red before the change on their real
// fixtures under a control subreaper; mode bad adds synthetic known-bad results.
async function controls(mode) {
  const reaper = mode === 'good' ? 'control-good' : 'control-bad';
  const cases = [];
  const group = await runScript(reaper, featureScript(GROUP_SCENARIO), tmp('acceptancereaper-run-'));
  cases.push(() => judgeOutput(group, 0, GROUP_OUTPUT));
  cases.push(() => judgeMillis(group.dir, 'elapsed-ms', 500));
  const goTest = await runScript(reaper, featureScript(GO_SCENARIO), groupModule());
  cases.push(() => judgeGoTestPassed(goTest));
  if (mode !== 'good') {
    const slow = tmp('acceptancereaper-slow-');
    fs.writeFileSync(path.join(slow, 'elapsed-ms'), '4000\n');
    cases.push(() => judgeMillis(slow, 'elapsed-ms', 500));
    cases.push(() => judgeOutput({ where: 'not adopted', status: 0, stdout: 'gone\n', stderr: '' }, 0, GROUP_OUTPUT));
    cases.push(() => judgeGoTestPassed({ where: 'go test failed', status: 1, stdout: '=== RUN   TestGroupGone\n--- PASS: TestGroupGone (0.01s)\nFAIL\n', stderr: '' }));
    cases.push(() => judgeGoTestPassed({ where: 'no test ran', status: 0, stdout: 'testing: warning: no tests to run\nPASS\nok  \tgroupgone\t0.002s [no tests to run]\n', stderr: '' }));
  }
  const failures = [];
  for (const [i, c] of cases.entries()) {
    try { await c(); } catch (e) { failures.push(`case ${i + 1}: ${e.message}`); }
  }
  return { cases: cases.length, failures };
}

if (require.main === module) {
  (async () => {
    const mode = process.argv[2];
    let result;
    try {
      result = await controls(mode);
    } catch (e) {
      console.log(`control setup failed: ${e.message}`);
      process.exitCode = 2;
      return;
    } finally {
      cleanup();
    }
    if (mode === 'good') {
      if (result.failures.length === 0) console.log('controls accepted');
      else { console.log(result.failures.join('\n')); process.exitCode = 1; }
    } else {
      const accepted = result.cases - result.failures.length;
      if (accepted === 0) { console.log('controls rejected'); process.exitCode = 1; }
      else { console.log(`${accepted} known-bad controls accepted`); process.exitCode = 2; }
    }
  })();
} else {
  const { Given, When, Then, AfterAll } = require('@cucumber/cucumber');
  const RUN = { timeout: 110 * 1000 };

  AfterAll(cleanup);

  Given(P + 'a Go module whose test TestGroupGone kills a process group and waits at most 5 seconds for its member to be gone', function () {
    this.acr = { dir: groupModule() };
  });

  When(P + 'the helper runs the script:', RUN, async function (script) {
    const dir = (this.acr && this.acr.dir) || tmp('acceptancereaper-run-');
    this.acr = { dir, result: await runScript(FLAG, script, dir) };
  });

  When(P + 'the helper runs each of these scripts:', RUN, async function (table) {
    this.acr = { rows: [] };
    for (const row of table.hashes()) {
      this.acr.rows.push({ row, result: await runScript(FLAG, row.script, tmp('acceptancereaper-run-')) });
    }
  });

  Then(P + 'the helper exits {int} with the output:', function (status, text) {
    judgeOutput(this.acr.result, status, `${text}\n`);
  });

  Then(P + 'each script exits and prints exactly as listed', function () {
    const problems = [];
    for (const { row, result } of this.acr.rows) {
      try { judgeOutput(result, Number(row.exit), row.output === '' ? '' : `${row.output}\n`); } catch (e) { problems.push(e.message); }
    }
    assert.ok(problems.length === 0, problems.join('\n'));
  });

  Then(P + 'the file {string} holds a number of milliseconds of at most {int}', function (name, max) {
    judgeMillis(this.acr.dir, name, max);
  });

  Then(P + 'none of the processes whose pids the files {string} hold is running', function (names) {
    judgeStopped(this.acr.dir, names.split(' '));
  });

  Then(P + 'the Go test run passes TestGroupGone', function () {
    judgeGoTestPassed(this.acr.result);
  });
}
