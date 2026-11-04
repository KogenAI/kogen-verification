'use strict';

// Steps of fix-k-verify-check-run-identity. Nothing runs when this file is loaded. The first step
// that needs the harness copies this checkout (without .git, node_modules and .kogen) to a
// temporary folder, installs the Go source below there as verify/relpath_intent_driver_test.go
// and builds the verify test binary once with `go test -c`; each scenario then runs that binary's
// TestRelativePathIdentityDriver, which writes one JSON report of two identical Verify passes.
// Child processes run asynchronously, so Cucumber's own report keeps each step's times.
// `node <this file> good|bad` runs the observer controls declared in the Intent's Feasibility.

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = 'fix-k-verify-check-run-identity: ';
const TEST = 'TestRelativePathIdentityDriver';

const driver = String.raw`package verify

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/KogenAI/kogen-coordinator/project"
	"github.com/KogenAI/kogen-loop/sys"
)

type relPathLog struct{ Events []map[string]any }

func (l *relPathLog) Log(e map[string]any) {
	if e["event"] == "check_identity" || e["event"] == "command" {
		l.Events = append(l.Events, e)
	}
}

// TestRelativePathIdentityDriver commits an executable node stub at RELPATH_STUB, runs two
// identical Verify passes whose session PATH is an absolute tool folder (git, grep, cp) followed
// by the entry RELPATH_ENTRY, and writes their check_identity and command events to RELPATH_REPORT.
func TestRelativePathIdentityDriver(t *testing.T) {
	entry, stub := os.Getenv("RELPATH_ENTRY"), os.Getenv("RELPATH_STUB")
	if stub == "" || filepath.IsAbs(entry) {
		t.Fatalf("RELPATH_STUB %q must be set and RELPATH_ENTRY %q relative", stub, entry)
	}
	p := newProj(t)
	bin := t.TempDir()
	for _, n := range []string{"git", "grep", "cp"} {
		v, err := exec.LookPath(n)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(v, filepath.Join(bin, n)); err != nil {
			t.Fatal(err)
		}
	}
	p.write(stub, "#!/bin/sh\nprintf 'stub node v1\\n'\n")
	if err := os.Chmod(filepath.Join(p.Root, stub), 0o755); err != nil {
		t.Fatal(err)
	}
	p.commit("stub node")
	env := []string{}
	for _, kv := range p.Env {
		if !strings.HasPrefix(kv, "PATH=") {
			env = append(env, kv)
		}
	}
	env = append(env, "PATH="+bin+":"+entry)
	p.Config.Checks = []project.Check{{Name: "proof", Run: ":"}}
	var passes []any
	for i := 0; i < 2; i++ {
		l := &relPathLog{}
		in := p.input(1)
		in.Log = l
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		pass, err := Verify(ctx, sys.NewWith(env, p.Root), in)
		cancel()
		if err != nil {
			t.Fatal(err)
		}
		passes = append(passes, map[string]any{"green": pass.Green, "events": l.Events})
	}
	b, err := json.Marshal(map[string]any{"bin": bin, "passes": passes})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("RELPATH_REPORT"), b, 0o600); err != nil {
		t.Fatal(err)
	}
}
`;

// The observer: each function judges a driver report and throws on a violation.
function identities(report) {
  assert.equal(report.passes.length, 2, 'two passes ran');
  return report.passes.map((pass, n) => {
    const ids = pass.events.filter((e) => e.event === 'check_identity');
    assert.equal(ids.length, 1, `pass ${n + 1} logged exactly one check_identity`);
    return ids[0];
  });
}
function tool(id, name, n) {
  const found = id.tools.filter((t) => t.name === name);
  assert.equal(found.length, 1, `pass ${n + 1} records the tool ${name} once`);
  return found[0];
}
const observe = {
  node(report, stub, status, version) {
    identities(report).forEach((id, n) => {
      assert.equal(report.passes[n].green, true, `pass ${n + 1} is green`);
      assert.deepEqual(tool(id, 'node', n), { name: 'node', path: stub, status, version }, `pass ${n + 1} node tool`);
    });
  },
  git(report) {
    identities(report).forEach((id, n) => {
      const git = tool(id, 'git', n);
      assert.equal(git.path, path.join(report.bin, 'git'), `pass ${n + 1} git tool path stays absolute`);
      assert.equal(git.status, 'ok', `pass ${n + 1} git tool status`);
    });
  },
  noScratch(report) {
    identities(report).forEach((id, n) => {
      for (const t of id.tools) assert.ok(t.path === null || !t.path.includes('kogen-verify-'), `pass ${n + 1} tool ${t.name} path ${t.path} names the scratch folder`);
    });
  },
  sameHashes(report, names) {
    identities(report);
    for (const name of names) {
      const hashes = report.passes.map((pass, n) => {
        const commands = pass.events.filter((e) => e.event === 'command' && e.name === name);
        assert.equal(commands.length, 1, `pass ${n + 1} logged the command ${name} once`);
        assert.match(String(commands[0].identity_sha256), /^[0-9a-f]{64}$/, `pass ${n + 1} ${name} identity_sha256`);
        return commands[0].identity_sha256;
      });
      assert.equal(hashes[0], hashes[1], `${name} identity_sha256 differs between two identical passes`);
    }
  },
};

function controls(bad) {
  const bin = '/tmp/go/TestRelativePathIdentityDriver1/004';
  const pass = (scratch, hash) => ({
    green: true,
    events: [
      { event: 'check_identity', tree: 't', tools: [
        { name: 'go', path: null, status: 'absent', version: null },
        { name: 'node', path: scratch ? `/tmp/kogen-verify-${scratch}/tools/node` : 'tools/node', status: 'ok', version: 'stub node v1' },
        { name: 'git', path: `${bin}/git`, status: 'ok', version: 'git version 2.43.0' },
      ], lockfiles: [], environment: { names: ['PATH'], sha256: 'e' }, host: { os: 'linux', arch: 'amd64' } },
      { event: 'command', name: 'acceptance', command: 'a', identity_sha256: hash('a') },
      { event: 'command', name: 'proof', command: ':', identity_sha256: hash('b') },
    ],
  });
  const same = (x) => x.repeat(64);
  const good = { bin, passes: [pass(null, same), pass(null, same)] };
  const judge = (r) => {
    observe.node(r, 'tools/node', 'ok', 'stub node v1');
    observe.git(r);
    observe.noScratch(r);
    observe.sameHashes(r, ['acceptance', 'proof']);
  };
  if (!bad) return judge(good);
  const mutations = [
    // The unfixed behavior: the scratch folder in the path and in both hashes.
    () => ({ bin, passes: [pass('91954de3afe1ce4d', (x) => (x === 'a' ? '9d' : '72').repeat(32)), pass('050e2928ada3a71c', (x) => (x === 'a' ? '8d' : '06').repeat(32))] }),
    () => { const r = structuredClone(good); r.passes[1].events[0].tools[1].path = '/tmp/kogen-verify-1/tools/node'; return r; },
    () => { const r = structuredClone(good); r.passes[0].events[0].tools[2].path = '../go/TestRelativePathIdentityDriver1/004/git'; return r; },
    () => { const r = structuredClone(good); r.passes[1].events[2].identity_sha256 = same('c'); return r; },
    () => { const r = structuredClone(good); r.passes[0].events[0].tools[1].status = 'error'; return r; },
    () => { const r = structuredClone(good); r.passes[1].green = false; return r; },
    () => { const r = structuredClone(good); r.passes[0].events.pop(); return r; },
  ];
  mutations.forEach((mutate, n) => assert.throws(() => judge(mutate()), `bad control ${n + 1} was accepted`));
  throw new Error('every bad control was rejected');
}

if (require.main === module) {
  const bad = process.argv[2] === 'bad';
  try {
    controls(bad);
    console.log('accepted');
  } catch (e) {
    if (bad && e.message !== 'every bad control was rejected') {
      console.log(`accepted bad control: ${e.message}`);
    } else {
      console.log('rejected');
      process.exitCode = 1;
    }
  }
} else {
  const { AfterAll, When, Then } = require('@cucumber/cucumber');

  let tmp;
  let prebuilt;

  // run starts file without blocking the event loop and resolves with its exit code (null when
  // it did not exit normally), error and output.
  const run = (file, args, options) => new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({ code: !error ? 0 : (typeof error.code === 'number' ? error.code : null), error, stdout, stderr });
    });
  });

  // testBinary builds the verify test binary with the driver installed once per run; every later
  // call reuses it (and a failed build fails every caller with the same message).
  const testBinary = () => {
    if (!prebuilt) {
      prebuilt = (async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relpath-identity-'));
        const dir = path.join(tmp, 'repo');
        fs.cpSync(process.cwd(), dir, { recursive: true, filter: (p) => !['.git', 'node_modules', '.kogen'].includes(path.basename(p)) });
        fs.writeFileSync(path.join(dir, 'verify/relpath_intent_driver_test.go'), driver);
        const bin = path.join(tmp, 'verify.test');
        const r = await run('go', ['test', '-c', '-o', bin, './verify'], { cwd: dir, timeout: 90 * 1000 });
        assert.equal(r.code, 0, `go test -c -o ${bin} ./verify (in a copy of the checkout with ${TEST} installed) failed: ${r.error ? r.error.message : ''}\n${r.stdout}${r.stderr}`);
        return { dir, bin };
      })();
    }
    return prebuilt;
  };

  AfterAll(function () {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  When(P + 'two identical passes run with the PATH entry {string} after an absolute tool folder and an executable node stub committed at {string}', { timeout: 115 * 1000 }, async function (entry, stub) {
    const { dir, bin } = await testBinary();
    const report = path.join(tmp, `report-${process.hrtime.bigint()}.json`);
    const args = ['-test.run', `^${TEST}$`, '-test.count=1', '-test.timeout=18s'];
    const r = await run(bin, args, { cwd: path.join(dir, 'verify'), env: { ...process.env, RELPATH_ENTRY: entry, RELPATH_STUB: stub, RELPATH_REPORT: report }, timeout: 20 * 1000 });
    assert.ok(fs.existsSync(report), `${bin} ${args.join(' ')} (RELPATH_ENTRY=${JSON.stringify(entry)} RELPATH_STUB=${JSON.stringify(stub)}): ${TEST} wrote no report (absent, skipped, ran zero times or failed): ${r.error ? r.error.message : 'exit 0'}\n${r.stdout}${r.stderr}`);
    this.relPathReport = JSON.parse(fs.readFileSync(report, 'utf8'));
  });

  Then(P + 'both passes are green and record the node tool path {string} with status {string} and version {string}', function (stub, status, version) {
    observe.node(this.relPathReport, stub, status, version);
  });

  Then(P + 'both passes record the git tool at its absolute path in the absolute tool folder', function () {
    observe.git(this.relPathReport);
  });

  Then(P + 'no recorded tool path names the scratch folder', function () {
    observe.noScratch(this.relPathReport);
  });

  Then(P + 'the {string} and {string} commands have the same identity_sha256 in both passes', function (a, b) {
    observe.sameHashes(this.relPathReport, [a, b]);
  });
}
