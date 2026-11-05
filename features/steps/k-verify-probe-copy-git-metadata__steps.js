'use strict';

// Steps of k-verify-probe-copy-git-metadata. Nothing runs when this file is loaded. The steps
// build small synthetic git projects in temporary directories and run commands in them as verify
// probes through the Go harness DRIVER below, which the first probe step builds once per run (as
// the virtual package ./features/steps/testdata/probecopygit through `go build -overlay`, so no
// file is written into the checkout) and later steps reuse. Child processes run asynchronously,
// so Cucumber's own report keeps each step's times.
//
// Run directly (`node <this file> good|bad`), the file checks its observer instead: `good` must
// accept the known-good fixtures and results, `bad` must reject every known-bad one.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = 'k-verify-probe-copy-git-metadata: ';
const BASELINE = { 'README.md': '# Fixture\n', 'src/main.txt': 'Usage: main [file]\n' };

// OBSERVER is the fixture observer the scenarios write, uncommitted, into a project: it judges
// the committed baseline of the file named by its argument with `git show HEAD:<file>`,
// `git rev-parse HEAD` and `git grep -n -w -F -e Usage HEAD`. A failing git command ends it with
// git's status and git's message.
const OBSERVER = String.raw`'use strict';
// Fixture observer: judges the committed baseline of the file named by its argument.
const { spawnSync } = require('node:child_process');
const file = process.argv[2];
function git(args, ok) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.error || !ok.includes(r.status)) {
    process.stdout.write('git ' + args.join(' ') + ' failed: ' + (r.error ? r.error.message + '\n' : r.stderr));
    process.exit(typeof r.status === 'number' && r.status !== 0 ? r.status : 2);
  }
  return r.stdout;
}
const baseline = git(['show', 'HEAD:' + file], [0]);
const head = git(['rev-parse', 'HEAD'], [0]).trim();
const hits = git(['grep', '-n', '-w', '-F', '-e', 'Usage', 'HEAD'], [0, 1]).split('\n').filter((l) => l.startsWith('HEAD:' + file + ':'));
if (/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(head) && /\bUsage\b/.test(baseline) && hits.length > 0) {
  console.log('observer good');
} else {
  console.log('observer bad rejected');
  process.exitCode = 1;
}
`;

// DRIVER is the Go harness the probe steps build.
const DRIVER = `// Command probecopygit is the acceptance harness of k-verify-probe-copy-git-metadata: it runs a
// command as a verify probe of a project, or executes one declared observer for it, with this
// process's environment as the caller's and $KOGEN_NODE, when set, as the probe's Node.
//
//	probecopygit probe <root> <command>
//	probecopygit execute <root> <observer> <good-command> <good-output> <bad-command> <bad-exit> <bad-output>
//
// probe prints the probe's result as one JSON object {"status","timed_out","output"}.
// execute declares the observer "fixture-observer" over the repository-relative file <observer>,
// whose good check runs <good-command> expecting exit 0 and <good-output> and whose bad check runs
// <bad-command> expecting <bad-exit> and <bad-output>; it prints "met" or the refusal as rendered.
// Misuse and unexpected errors exit 2.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
	"github.com/KogenAI/kogen-verification/verify"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "probecopygit:", err)
		os.Exit(2)
	}
}

func run(args []string) error {
	tools := verify.Tools{Node: os.Getenv("KOGEN_NODE")}
	switch {
	case len(args) == 3 && args[0] == "probe":
		r, err := verify.Probe{Root: args[1], Command: args[2], Tools: tools}.Run(context.Background(), sys.New())
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"status": r.Status, "timed_out": r.TimedOut, "output": r.Output})
	case len(args) == 8 && args[0] == "execute":
		badExit, err := strconv.Atoi(args[6])
		if err != nil {
			return fmt.Errorf("bad exit %q: %v", args[6], err)
		}
		return execute(tools, args[1], args[2], args[3], args[4], args[5], badExit, args[7])
	}
	return fmt.Errorf("usage: probecopygit probe <root> <command> | probecopygit execute <root> <observer> <good-command> <good-output> <bad-command> <bad-exit> <bad-output>")
}

func execute(tools verify.Tools, root, observer, goodCommand, goodOutput, badCommand string, badExit int, badOutput string) error {
	decl, err := json.Marshal(map[string]any{"id": "fixture-observer", "kind": "observer", "inputs": []string{}, "observers": []string{observer},
		"checks": []map[string]any{
			{"name": "good", "command": goodCommand, "exit": 0, "output": goodOutput},
			{"name": "bad", "command": badCommand, "exit": badExit, "output": badOutput},
		}})
	if err != nil {
		return err
	}
	evidence, err := os.MkdirTemp("", "probecopygit-evidence-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(evidence)
	intent := &project.Intent{Root: root, Slug: "fixture", Acceptance: []string{project.FeaturePath("fixture"), observer},
		Feasibility: []string{"- evidence: " + string(decl)}}
	_, err = verify.Execute(context.Background(), sys.New(), tools, root, intent, evidence, nil)
	if e, ok := sys.AsError(err); ok {
		fmt.Print(e.Render())
		return nil
	}
	if err != nil {
		return err
	}
	fmt.Println("met")
	return nil
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

// cleanEnv is this process's environment without GIT_* variables, with home as HOME and git's
// system and global configuration off, so the fixtures do not depend on the machine's git setup.
function cleanEnv(home, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return { ...env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...extra };
}

async function git(dir, env, ...args) {
  const r = await run('git', args, { cwd: dir, env });
  assert.equal(r.status, 0, `git ${args.join(' ')} in ${dir} failed (exit ${r.status}): ${r.stdout}${r.stderr}${r.status === null ? r.error.message : ''}`);
  return r.stdout;
}

function write(root, rel, content, mode) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode === undefined ? undefined : { mode });
}

// newProject makes <base>/project holding the baseline files: with `commit`, a git repository on
// branch main whose local config has an identity, a remote and probe.sentinel=original and whose
// one commit "baseline" holds them; with `init` only, a repository with no commit; else no git.
async function newProject(base, kind) {
  const root = path.join(base, 'project');
  const home = path.join(base, 'home');
  fs.mkdirSync(root);
  fs.mkdirSync(home);
  const env = cleanEnv(home);
  for (const [rel, content] of Object.entries(BASELINE)) write(root, rel, content);
  const p = { base, root, probeRoot: root, env, watch: [root], commits: {} };
  if (kind === 'none') return p;
  await git(root, env, 'init', '-q', '-b', 'main');
  await git(root, env, 'config', 'user.name', 'Source Person');
  await git(root, env, 'config', 'user.email', 'source@example.invalid');
  await git(root, env, 'config', 'remote.origin.url', 'https://example.invalid/source.git');
  await git(root, env, 'config', 'probe.sentinel', 'original');
  if (kind === 'init') return p;
  await git(root, env, 'add', 'README.md', 'src/main.txt');
  await git(root, env, 'commit', '-q', '-m', 'baseline');
  p.commits.first = p.commits.head = (await git(root, env, 'rev-parse', 'HEAD')).trim();
  return p;
}

// postCommitHook installs a post-commit hook in the project's repository that writes <root>/<name>.
function postCommitHook(p, name) {
  write(p.root, '.git/hooks/post-commit', `#!/bin/sh\nprintf 'hook ran\\n' > '${path.join(p.root, name)}'\n`, 0o755);
}

// snapshot is the observable state of every watched directory: its git status, local config,
// HEAD and object count, read without taking optional locks, and every file below it, .git
// included, as its type, mode and content hash.
async function snapshot(p) {
  const out = {};
  for (const root of p.watch) {
    const env = { ...p.env, GIT_OPTIONAL_LOCKS: '0' };
    const state = {
      status: await git(root, env, '--no-optional-locks', 'status', '--porcelain'),
      config: await git(root, env, 'config', '--list', '--local'),
      head: await git(root, env, 'rev-parse', 'HEAD'),
      objects: await git(root, env, 'count-objects', '-v'),
      files: {},
    };
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, name);
        const rel = path.relative(root, full);
        const st = fs.lstatSync(full);
        const mode = (st.mode & 0o7777).toString(8);
        if (st.isSymbolicLink()) state.files[rel] = `link ${fs.readlinkSync(full)}`;
        else if (st.isDirectory()) { state.files[rel] = `dir ${mode}`; walk(full); }
        else state.files[rel] = `file ${mode} ${crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`;
      }
    };
    walk(root);
    out[root] = state;
  }
  return out;
}

// judgeUnchanged requires after to equal before, naming what differs.
function judgeUnchanged(before, after) {
  const problems = [];
  for (const root of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[root] || {}, a = after[root] || {};
    for (const key of ['status', 'config', 'head', 'objects']) {
      if (a[key] !== b[key]) problems.push(`${root}: ${key} was ${JSON.stringify(b[key])}, is ${JSON.stringify(a[key])}`);
    }
    const bf = b.files || {}, af = a.files || {};
    for (const rel of [...new Set([...Object.keys(bf), ...Object.keys(af)])].sort()) {
      if (bf[rel] !== af[rel]) problems.push(`${root}/${rel}: was ${bf[rel] || 'absent'}, is ${af[rel] || 'absent'}`);
    }
  }
  assert.ok(problems.length === 0, `the source checkout changed:\n${problems.join('\n')}`);
}

// judgeResult requires the result's exit status and complete output to be exactly these.
function judgeResult(r, status, output) {
  assert.deepEqual({ status: r.status, output: r.output }, { status, output },
    `${r.where}: exit ${r.status}, output ${JSON.stringify(r.output)}; want exit ${status}, output ${JSON.stringify(output)}`);
}

// judgeExplained requires the exit status, output containing text and ending with the line.
function judgeExplained(r, status, text, line) {
  assert.ok(r.status === status && r.output.includes(text) && r.output.endsWith(`\n${line}\n`),
    `${r.where}: exit ${r.status}, output ${JSON.stringify(r.output)}; want exit ${status}, output containing ${JSON.stringify(text)} and ending with the line ${JSON.stringify(line)}`);
}

function judgeAbsent(root, name) {
  assert.ok(!fs.existsSync(path.join(root, name)), `${path.join(root, name)} must not exist`);
}

// ensureHarness builds the probe harness DRIVER the first time a step needs it and reuses it for the
// rest of the run.
function ensureHarness() {
  if (!harness) {
    harness = (async () => {
      const dir = tmp('probecopygit-harness-');
      const bin = path.join(dir, 'probecopygit');
      const src = path.join(dir, 'main.go');
      fs.writeFileSync(src, DRIVER);
      const overlay = path.join(dir, 'overlay.json');
      fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(process.cwd(), 'features/steps/testdata/probecopygit/main.go')]: src } }));
      const args = ['build', '-overlay', overlay, '-o', bin, './features/steps/testdata/probecopygit'];
      const r = await run('go', args, { timeout: 100 * 1000 });
      assert.equal(r.status, 0, `go ${args.join(' ')} failed (exit ${r.status}): ${r.stdout}${r.stderr}${r.status === null ? r.error.message : ''}`);
      return bin;
    })();
    harness.catch(() => { harness = undefined; });
  }
  return harness;
}

// harnessEnv is the caller environment of a probe: the fixture environment with a private
// temporary directory and this Node as the probe's KOGEN_NODE.
function harnessEnv(p) {
  return { ...p.env, TMPDIR: tmp('probecopygit-tmp-'), KOGEN_NODE: process.execPath };
}

// probe runs command as a verify probe of root and returns its status and output.
async function probe(p, root, command) {
  const bin = await ensureHarness();
  const r = await run(bin, ['probe', root, command], { env: harnessEnv(p), timeout: 100 * 1000 });
  assert.equal(r.status, 0, `probecopygit probe ${root} ${JSON.stringify(command)} failed (exit ${r.status}): ${r.stdout}${r.stderr}`);
  const got = JSON.parse(r.stdout);
  assert.equal(got.timed_out, false, `the probe of ${JSON.stringify(command)} in ${root} timed out: ${r.stdout}`);
  return { where: `probe of ${JSON.stringify(command)} in ${root}`, status: got.status, output: got.output };
}

// placed replaces {first} and {head} with the project's first and latest commit.
function placed(p, text) {
  return text.replace(/\{(first|head)\}/g, (m, name) => {
    assert.ok(p.commits[name], `the project has no ${name} commit for ${m}`);
    return p.commits[name];
  });
}

// controls checks the observer: good fixtures and results accepted, bad ones rejected.
async function controls(mode) {
  const base = tmp('probecopygit-controls-');
  const p = await newProject(base, 'commit');
  write(p.root, 'observer.cjs', OBSERVER);
  postCommitHook(p, 'hook-marker');
  const node = (dir, ...args) => run(process.execPath, ['observer.cjs', ...args], { cwd: dir, env: { ...p.env, GIT_CEILING_DIRECTORIES: base } })
    .then((r) => ({ where: `node observer.cjs ${args.join(' ')} in ${dir}`, status: r.status, output: r.stdout + r.stderr }));
  const plain = path.join(base, 'plain');
  for (const rel of [...Object.keys(BASELINE), 'observer.cjs']) write(plain, rel, fs.readFileSync(path.join(p.root, rel)));
  const good = await node(p.root, 'src/main.txt');
  const bad = await node(p.root, 'README.md');
  const noGit = await node(plain, 'src/main.txt');
  const explanation = 'probe copy has no git metadata: scratch-copy isolation, not evidence that the source project lacks a repository';
  const cases = [];
  if (mode === 'good') {
    const before = await snapshot(p);
    cases.push(async () => judgeUnchanged(before, await snapshot(p)));
    cases.push(() => judgeResult(good, 0, 'observer good\n'));
    cases.push(() => judgeResult(bad, 1, 'observer bad rejected\n'));
    cases.push(() => assert.ok(noGit.status === 128 && noGit.output.includes('fatal: not a git repository'), `${noGit.where}: ${noGit.status} ${noGit.output}`));
    cases.push(() => judgeExplained({ where: 'explained', status: 128, output: `fatal: not a git repository (or any of the parent directories): .git\n${explanation}\n` }, 128, 'fatal: not a git repository', explanation));
    cases.push(() => judgeAbsent(p.root, 'scratch-only'));
    // The hook fixture is live: a commit in the source itself writes the marker.
    cases.push(async () => {
      await git(p.root, p.env, 'commit', '-q', '--allow-empty', '-m', 'hook check');
      assert.ok(fs.existsSync(path.join(p.root, 'hook-marker')), 'the post-commit hook did not write hook-marker');
    });
  } else {
    // Each mutation of the source must be seen by judgeUnchanged.
    const mutations = [
      () => git(p.root, p.env, 'config', 'probe.sentinel', 'changed'),
      () => write(p.root, 'scratch-only', ''),
      () => write(p.root, 'hook-marker', 'hook ran\n'),
      () => git(p.root, p.env, 'commit', '-q', '--allow-empty', '-m', 'x'),
      () => git(p.root, p.env, 'branch', 'probe-only'),
      async () => { write(base, 'loose.txt', 'loose\n'); await git(p.root, p.env, 'hash-object', '-w', path.join(base, 'loose.txt')); },
      () => write(p.root, '.git/hooks/pre-commit', '#!/bin/sh\n', 0o755),
      () => write(p.root, 'shaped.txt', 'shaped\n'),
    ];
    for (const mutate of mutations) {
      cases.push(async () => {
        const before = await snapshot(p);
        await mutate();
        judgeUnchanged(before, await snapshot(p));
      });
    }
    cases.push(() => judgeResult(noGit, 0, 'observer good\n'));
    cases.push(() => judgeResult(noGit, 1, 'observer bad rejected\n'));
    cases.push(() => judgeResult(bad, 0, 'observer good\n'));
    cases.push(() => judgeResult(good, 1, 'observer bad rejected\n'));
    cases.push(() => judgeResult({ ...good, output: 'observer good' }, 0, 'observer good\n'));
    cases.push(() => judgeExplained({ where: 'unexplained', status: 128, output: 'fatal: not a git repository (or any of the parent directories): .git\n' }, 128, 'fatal: not a git repository', explanation));
    cases.push(() => judgeExplained({ where: 'other status', status: 0, output: `fatal: not a git repository\n${explanation}\n` }, 128, 'fatal: not a git repository', explanation));
    cases.push(() => judgeAbsent(p.root, 'scratch-only'));
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
  const SETUP = { timeout: 30 * 1000 };
  const PROBE = { timeout: 110 * 1000 };

  AfterAll(cleanup);

  Given(P + 'a git project with one baseline commit containing README.md and src\\/main.txt', SETUP, async function () {
    this.pcg = await newProject(tmp('probecopygit-'), 'commit');
  });

  Given(P + 'a git project whose repository has no commit', SETUP, async function () {
    this.pcg = await newProject(tmp('probecopygit-'), 'init');
  });

  Given(P + 'a directory that is not a git checkout containing README.md and src\\/main.txt', SETUP, async function () {
    this.pcg = await newProject(tmp('probecopygit-'), 'none');
  });

  Given(P + 'the uncommitted fixture observer {string} in the project', function (rel) {
    write(this.pcg.root, rel, OBSERVER);
  });

  Given(P + 'the uncommitted file {string} containing {string} in the project', function (rel, line) {
    write(this.pcg.root, rel, `${line}\n`);
  });

  Given(P + 'the tracked file {string} is changed without committing', function (rel) {
    fs.appendFileSync(path.join(this.pcg.root, rel), 'changed\n');
  });

  Given(P + 'the new file {string} is staged but not committed', SETUP, async function (rel) {
    write(this.pcg.root, rel, 'staged\n');
    await git(this.pcg.root, this.pcg.env, 'add', rel);
  });

  Given(P + 'a second commit {string} that changes src\\/main.txt to the line {string}', SETUP, async function (subject, line) {
    const p = this.pcg;
    write(p.root, 'src/main.txt', `${line}\n`);
    await git(p.root, p.env, 'commit', '-q', '-a', '-m', subject);
    p.commits.head = (await git(p.root, p.env, 'rev-parse', 'HEAD')).trim();
  });

  Given(P + 'a post-commit hook in the source that writes the file {string} in the source', function (name) {
    postCommitHook(this.pcg, name);
  });

  Given(P + 'the project\'s branch names a commit that does not exist', function () {
    write(this.pcg.root, '.git/refs/heads/main', '0123456789abcdef0123456789abcdef01234567\n');
  });

  Given(P + 'a linked worktree of the project on the new branch {string} is the probed source', SETUP, async function (branch) {
    const p = this.pcg;
    const worktree = path.join(p.base, 'worktree');
    await git(p.root, p.env, 'worktree', 'add', '-q', '-b', branch, worktree);
    p.probeRoot = worktree;
    p.watch.push(worktree);
  });

  When(P + 'the source repository state is recorded', SETUP, async function () {
    this.pcg.before = await snapshot(this.pcg);
  });

  When(P + 'the probe runs {string}', PROBE, async function (command) {
    this.pcg.result = await probe(this.pcg, this.pcg.probeRoot, placed(this.pcg, command));
  });

  When(P + 'the declared observer {string} with the good check {string} expecting exit {int} and the output line {string} and the bad check {string} expecting exit {int} and the output line {string} is executed for the project',
    PROBE, async function (observer, good, goodExit, goodLine, bad, badExit, badLine) {
      assert.equal(goodExit, 0, 'an observer good check expects exit 0');
      const bin = await ensureHarness();
      const p = this.pcg;
      const args = ['execute', p.root, observer, good, `${goodLine}\n`, bad, String(badExit), `${badLine}\n`];
      const r = await run(bin, args, { env: harnessEnv(p), timeout: 100 * 1000 });
      assert.equal(r.status, 0, `probecopygit ${args.join(' ')} failed (exit ${r.status}): ${r.stdout}${r.stderr}`);
      p.refusal = r.stdout;
    });

  When(P + 'each of these commands runs as a probe of the project and of a copy of the project without git metadata:', PROBE, async function (table) {
    const p = this.pcg;
    const plain = path.join(tmp('probecopygit-plain-'), 'project');
    fs.cpSync(p.root, plain, { recursive: true, filter: (src) => path.basename(src) !== '.git' });
    p.rows = [];
    for (const row of table.hashes()) {
      p.rows.push({
        row,
        runs: [await probe(p, p.root, row.command), await probe(p, plain, row.command)],
      });
    }
  });

  Then(P + 'the probe exits {int} with the output line {string}', function (status, line) {
    judgeResult(this.pcg.result, status, `${placed(this.pcg, line)}\n`);
  });

  Then(P + 'the probe exits {int} with the output:', function (status, text) {
    judgeResult(this.pcg.result, status, `${placed(this.pcg, text)}\n`);
  });

  Then(P + 'the probe exits {int} with output containing {string} and ending with the line {string}', function (status, text, line) {
    judgeExplained(this.pcg.result, status, text, line);
  });

  Then(P + 'the declared evidence is met', function () {
    assert.equal(this.pcg.refusal, 'met\n', `want the declared evidence met; got: ${this.pcg.refusal}`);
  });

  Then(P + 'the source repository state is unchanged', SETUP, async function () {
    judgeUnchanged(this.pcg.before, await snapshot(this.pcg));
  });

  Then(P + 'the source has no file {string}', function (name) {
    judgeAbsent(this.pcg.root, name);
  });

  Then(P + 'every command exits and prints exactly as listed, in both runs', function () {
    const problems = [];
    for (const { row, runs } of this.pcg.rows) {
      for (const r of runs) {
        try { judgeResult(r, Number(row.exit), row.output); } catch (e) { problems.push(e.message); }
      }
    }
    assert.ok(problems.length === 0, problems.join('\n'));
  });
}
