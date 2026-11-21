'use strict';

// Steps of verify-packaged-candidate-dependency-build. Nothing runs when this file is loaded.
// The first When builds, once per run, the kogen driver (go build -tags kogendriver of the driver
// folder); it is both the command under test and the packaged candidate it runs. A failed build
// is recorded, not thrown, and the Then steps show it. The fixture project and its local mirror
// tarball are written here. Child processes run asynchronously.

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Given, When, Then } = require('@cucumber/cucumber');

const P = 'verify-packaged-candidate-dependency-build: ';
const DRIVER_DIR = './features/steps/verify-packaged-candidate-dependency-build__driver';

const tail = (text) => (text.length > 2500 ? '...' + text.slice(-2500) : text);

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: err + String(e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

let driverBuild = null;
function buildDriver() {
  if (!driverBuild) {
    driverBuild = (async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vpcdb-driver-'));
      const bin = path.join(dir, 'kogen');
      const r = await run('go', ['build', '-tags', 'kogendriver', '-o', bin, DRIVER_DIR], { cwd: process.cwd() });
      return { bin, ok: r.code === 0, output: r.out + r.err };
    })();
  }
  return driverBuild;
}

async function makeFixture(world, mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vpcdb-fixture-'));
  const project = path.join(root, 'project');
  const src = path.join(root, 'src', 'package');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(path.join(project, 'mirror'), { recursive: true });
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'mirrordep', version: '1.0.0' }));
  const tar = await run('tar', ['-czf', path.join(project, 'mirror', 'mirrordep-1.0.0.tgz'), '-C', path.join(root, 'src'), 'package'], {});
  assert.equal(tar.code, 0, `tar of the mirror tarball failed: ${tar.err}`);
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { mirrordep: 'file:mirror/mirrordep-1.0.0.tgz' } }));
  fs.writeFileSync(path.join(project, 'stand-in-mode'), mode);
  world.project = project;
  world.binary = null;
  world.runs = [];
}

Given(P + 'a fixture project with a local mirror and a candidate that completes every phase', async function () {
  await makeFixture(this, 'ok');
});

Given(P + 'a fixture project with a local mirror and a candidate whose Build resume loses the restore flag', async function () {
  await makeFixture(this, 'lose-restore-flag');
});

Given(P + 'a fixture directory that does not exist', async function () {
  await makeFixture(this, 'ok');
  this.project = path.join(path.dirname(this.project), 'no-such-fixture');
});

async function runOnce(world) {
  const d = await buildDriver();
  if (!d.ok) return { code: -1, out: '', err: 'driver build failed:\n' + tail(d.output) };
  world.binary = d.bin;
  return run(d.bin, ['verify', 'candidate', '--project', world.project], { cwd: os.tmpdir() });
}

When(P + 'I run kogen verify candidate --project with the fixture directory', async function () {
  this.runs = [await runOnce(this)];
});

When(P + 'I run kogen verify candidate --project with the fixture directory twice', async function () {
  this.runs = [await runOnce(this), await runOnce(this)];
});

const show = (r) => `exit ${r.code}\nstdout:\n${tail(r.out)}\nstderr:\n${tail(r.err)}`;
const lines = (r) => r.out.split('\n').filter((l) => l !== '');

function receipt(r) {
  const ls = lines(r);
  assert.ok(ls.length >= 2, `no receipt line after the landed line; ${show(r)}`);
  try {
    return JSON.parse(ls[1]);
  } catch (e) {
    assert.fail(`the second output line is not JSON: ${ls[1]}; ${show(r)}`);
  }
}

Then(P + 'the command exits with status 0 and prints the landed line first', function () {
  const r = this.runs[0];
  assert.equal(r.code, 0, show(r));
  assert.equal(lines(r)[0], 'candidate-build: landed', show(r));
});

Then(P + 'the receipt has exactly the keys binary_sha256, project, phases and elapsed_seconds', function () {
  const rec = receipt(this.runs[0]);
  assert.deepEqual(Object.keys(rec).sort(), ['binary_sha256', 'elapsed_seconds', 'phases', 'project']);
  assert.equal(typeof rec.elapsed_seconds, 'number');
  assert.equal(rec.project, this.project);
});

Then(P + 'the receipt binary_sha256 is the sha256 of the packaged binary', function () {
  assert.ok(this.binary, 'the packaged binary was not built');
  const want = crypto.createHash('sha256').update(fs.readFileSync(this.binary)).digest('hex');
  assert.equal(receipt(this.runs[0]).binary_sha256, want);
});

Then(P + 'the receipt phases are install, shape, build, resume, restore, land in that order', function () {
  assert.deepEqual(receipt(this.runs[0]).phases, ['install', 'shape', 'build', 'resume', 'restore', 'land']);
});

Then(P + 'the command exits with status 1 and prints the line "candidate-build: failed resume" and never the landed line', function () {
  const r = this.runs[0];
  assert.equal(r.code, 1, show(r));
  assert.ok(lines(r).includes('candidate-build: failed resume'), show(r));
  assert.ok(!lines(r).includes('candidate-build: landed'), show(r));
});

Then(P + 'the command exits with status 2 and prints the line "candidate-build: unavailable" and never the landed line', function () {
  const r = this.runs[0];
  assert.equal(r.code, 2, show(r));
  assert.ok(lines(r).includes('candidate-build: unavailable'), show(r));
  assert.ok(!lines(r).includes('candidate-build: landed'), show(r));
});

Then(P + 'both runs print the same phases and the phases include install', function () {
  const [a, b] = this.runs.map(receipt);
  assert.ok(a.phases.includes('install'), `phases: ${JSON.stringify(a.phases)}`);
  assert.deepEqual(a.phases, b.phases);
});

Then(P + 'both receipts are identical except for elapsed_seconds', function () {
  const strip = (rec) => {
    const { elapsed_seconds, ...rest } = rec;
    assert.equal(typeof elapsed_seconds, 'number');
    return rest;
  };
  const [a, b] = this.runs.map(receipt);
  assert.deepEqual(strip(a), strip(b));
});
