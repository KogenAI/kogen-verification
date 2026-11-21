'use strict';
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Given, When, Then } = require('@cucumber/cucumber');

const SKIP = new Set(['.git', 'node_modules', '.kogen']);
const OWNER_LINE = /\b(owner|owns|owning)\b/i;
const REPO = /\bkogen(?:-[a-z]+)?\b/;
const CITATION = /(?:^|[\s`(])([A-Za-z0-9_.\/-]+\.[A-Za-z0-9]+):(\d+)\b/g;

// Lists the text files of the checkout that the Build could have written its decision into.
function textFiles(dir, rel, out) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP.has(e.name) || r === 'features/steps' || r === 'testdata/tools') continue;
      textFiles(dir, r, out);
    } else if (e.isFile()) {
      const st = fs.statSync(path.join(dir, r));
      if (st.size > 1000000) continue;
      const text = fs.readFileSync(path.join(dir, r), 'utf8');
      if (!text.includes('\0')) out.push({ rel: r, text });
    }
  }
  return out;
}

// The first file with a line naming a component repository as owner, and that repository.
function findDecision() {
  for (const f of textFiles(process.cwd(), '', [])) {
    for (const line of f.text.split('\n')) {
      const m = REPO.exec(line);
      if (m && OWNER_LINE.test(line)) return { file: f, owner: m[0], line: line.trim() };
    }
  }
  return null;
}

// Runs one existing Go test of the verify package, asynchronously, and keeps its output.
function runTest(name) {
  const args = ['test', './verify', '-run', `^${name}$`, '-count=1', '-v', '-timeout=100s'];
  return new Promise((resolve) => {
    const child = cp.spawn('go', args, { cwd: process.cwd() });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (e) => resolve({ status: null, out: out + String(e) }));
    child.on('close', (status) => resolve({ status, out }));
  });
}

Given('main-health-f59a52: the kogen-verification checkout is at its main head', function () {
  assert.ok(fs.existsSync(path.join(process.cwd(), 'verify', 'run.go')), 'verify/run.go is missing from the checkout');
});

Then('main-health-f59a52: a text file of the checkout names the owning repository', function () {
  const d = findDecision();
  assert.ok(d, 'no text file outside .kogen and features/steps has a line that names a Kogen component repository together with the word owner, owns or owning');
  this.mainHealthDecision = d;
});

Then('main-health-f59a52: that text file cites a file and a line it read', function () {
  const d = this.mainHealthDecision || findDecision();
  assert.ok(d, 'no text file names the owning repository, so there is nothing that cites a file and line');
  const cites = [...d.file.text.matchAll(CITATION)].map((m) => ({ rel: m[1], line: Number(m[2]) })).filter((c) => c.line >= 1);
  assert.ok(cites.length > 0, `${d.file.rel} names ${d.owner} but cites no <path>:<line>`);
  if (d.owner === 'kogen-verification') {
    const ok = cites.some((c) => {
      if (path.isAbsolute(c.rel) || c.rel.split('/').includes('..')) return false;
      const file = path.join(process.cwd(), c.rel);
      return fs.existsSync(file) && fs.statSync(file).isFile() && c.line <= fs.readFileSync(file, 'utf8').split('\n').length;
    });
    assert.ok(ok, `${d.file.rel} names kogen-verification as owner but none of its citations ${JSON.stringify(cites)} is a line of a file of this checkout`);
  }
});

When('main-health-f59a52: the focused Go test {string} runs', { timeout: 115000 }, async function (name) {
  this.mainHealthRuns = this.mainHealthRuns || {};
  this.mainHealthRuns[name] = await runTest(name);
});

Then('main-health-f59a52: the focused Go test {string} reported PASS', function (name) {
  const r = this.mainHealthRuns && this.mainHealthRuns[name];
  const command = `go test ./verify -run ^${name}$ -count=1 -v`;
  assert.ok(r, `${name}: the test was not run via ${command}`);
  assert.equal(r.status, 0, `${name} via ${command}: exit ${r.status}\n${r.out}`);
  assert.match(r.out, new RegExp(`--- PASS: ${name} `), `${name} via ${command} was absent, skipped or ran zero times (exit ${r.status})\n${r.out}`);
});
