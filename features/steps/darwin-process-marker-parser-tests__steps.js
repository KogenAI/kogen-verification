'use strict';
const { When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const PREFIX = 'darwin-process-marker-parser-tests: ';
const ROOT = process.cwd();
const DRIVER_GO = `//go:build darwin

package verify

import (
	"encoding/hex"
	"fmt"
	"os"
	"testing"
)

func TestKogenDarwinMarkerDriver(t *testing.T) {
	data, err := hex.DecodeString(os.Getenv("KOGEN_DM_HEX"))
	if err != nil {
		t.Fatal(err)
	}
	entry := os.Getenv("KOGEN_DM_ENTRY")
	func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Printf("KOGEN_DM_RESULT=PANIC %v\\n", r)
			}
		}()
		if procargs2Marked(data, entry) {
			fmt.Println("KOGEN_DM_RESULT=MATCH")
		} else {
			fmt.Println("KOGEN_DM_RESULT=NOMATCH")
		}
	}()
}
`;

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 1 << 24, timeout: 100000, ...opts }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

// procargs2 layout: int32 argc (little endian), executable path, NUL padding, argc arguments, environment; each NUL terminated.
function procargs2(argc, execPath, args, env) {
  const parts = [Buffer.from([argc & 255, (argc >> 8) & 255, 0, 0]), Buffer.from(execPath + '\0\0\0\0')];
  for (const a of args) parts.push(Buffer.from(a + '\0'));
  for (const e of env) parts.push(Buffer.from(e + '\0'));
  return Buffer.concat(parts);
}

const MARK = 'KOGEN_MARK=run-1';
const FIXTURES = {
  'environment holds the marker': procargs2(2, '/bin/sleep', ['sleep', '60'], ['PATH=/usr/bin', MARK, 'HOME=/h']),
  'only an argument holds the marker': procargs2(3, '/bin/sh', ['sh', '-c', MARK], ['PATH=/usr/bin', 'HOME=/h']),
  'environment entry extends the marker': procargs2(1, '/bin/sleep', ['sleep'], ['PATH=/usr/bin', 'KOGEN_MARK=run-12']),
  'environment entry has a longer name': procargs2(1, '/bin/sleep', ['sleep'], ['PATH=/usr/bin', 'X_KOGEN_MARK=run-1']),
  'empty data': Buffer.alloc(0),
  'two bytes': Buffer.from([2, 0]),
  'argument count only': Buffer.from([1, 0, 0, 0]),
  'unterminated executable path': Buffer.concat([Buffer.from([1, 0, 0, 0]), Buffer.from('/bin/sleep' + MARK)]),
  'unterminated argument': Buffer.concat([Buffer.from([2, 0, 0, 0]), Buffer.from('/bin/sh\0\0\0\0sh\0' + MARK)]),
  'argument count exceeds the arguments': procargs2(5, '/bin/sh', ['sh'], ['PATH=/usr/bin', MARK]),
};

let state = null; // per scenario: { fixture, entry, result, build }
let driver = null; // shared build promise, started on first use

function buildDriver() {
  if (!driver) {
    driver = (async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-marker-'));
      const goFile = path.join(dir, 'driver_test.go');
      fs.writeFileSync(goFile, DRIVER_GO);
      const overlay = path.join(dir, 'overlay.json');
      fs.writeFileSync(overlay, JSON.stringify({ Replace: { [path.join(ROOT, 'verify', 'zz_kogen_darwin_marker_driver_test.go')]: goFile } }));
      const bin = path.join(dir, 'verify.test');
      const r = await run('go', ['test', '-c', '-overlay', overlay, '-o', bin, './verify'], { cwd: ROOT, env: { ...process.env, PWD: ROOT } });
      return { bin, build: r.error ? 'go test -c ./verify failed: ' + r.stderr + r.stdout : '' };
    })();
  }
  return driver;
}

When(PREFIX + 'the parser is given the procargs2 data {string} and the marker entry {string}', async function (fixture, entry) {
  assert.ok(Object.prototype.hasOwnProperty.call(FIXTURES, fixture), 'unknown fixture ' + fixture);
  state = { fixture, entry, result: '', build: '' };
  if (process.platform !== 'darwin') {
    state.build = 'this acceptance needs a darwin host, platform is ' + process.platform;
    return;
  }
  const d = await buildDriver();
  state.build = d.build;
  if (d.build) return;
  const r = await run(d.bin, ['-test.run', '^TestKogenDarwinMarkerDriver$', '-test.count=1'], {
    cwd: path.join(ROOT, 'verify'),
    env: { ...process.env, KOGEN_DM_HEX: FIXTURES[fixture].toString('hex'), KOGEN_DM_ENTRY: entry },
  });
  const m = /KOGEN_DM_RESULT=(\S+)(.*)/.exec(r.stdout);
  state.result = m ? m[1] + m[2] : 'no result line; output: ' + r.stdout + r.stderr;
});

function expectResult(want) {
  const label = `procargs2 fixture "${state.fixture}" with marker "${state.entry}"`;
  assert.strictEqual(state.build, '', label + ': driver did not build: ' + state.build);
  assert.strictEqual(state.result, want, label + ': expected ' + want + ' from procargs2Marked, got ' + state.result);
}

Then(PREFIX + 'the parser reports a match', function () {
  expectResult('MATCH');
});
Then(PREFIX + 'the parser reports no match and does not panic', function () {
  expectResult('NOMATCH');
});

let testRun = null;
When(PREFIX + 'the tests declared in {string} are run', async function (file) {
  testRun = { file, names: [], out: '', problem: '' };
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    testRun.problem = file + ' does not exist';
    return;
  }
  const src = fs.readFileSync(full, 'utf8');
  testRun.src = src;
  testRun.names = [...src.matchAll(/^func (Test\w+)\(/gm)].map((m) => m[1]);
  if (testRun.names.length === 0) {
    testRun.problem = file + ' declares no Test function';
    return;
  }
  const r = await run('go', ['test', '-count=1', '-v', '-run', '^(' + testRun.names.join('|') + ')$', './verify'], { cwd: ROOT, env: { ...process.env, PWD: ROOT } });
  testRun.out = r.stdout + r.stderr;
  testRun.failed = !!r.error;
});

Then(PREFIX + 'every declared test passes and the file is built only on darwin', function () {
  assert.strictEqual(testRun.problem, '', testRun.problem);
  assert.ok(/^\/\/go:build darwin\s*$/m.test(testRun.src), testRun.file + ' lacks the //go:build darwin constraint');
  assert.ok(/procargs2Marked\(/.test(testRun.src), testRun.file + ' does not call procargs2Marked');
  for (const n of testRun.names) {
    assert.ok(testRun.out.includes('--- PASS: ' + n + ' '), `go test -run ${n} ./verify did not report PASS for ${n}: ${testRun.out.slice(-2000)}`);
  }
  assert.ok(!testRun.failed, 'go test failed: ' + testRun.out.slice(-2000));
});
