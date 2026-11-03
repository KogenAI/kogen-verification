// Steps of the probe second-temporary-directory scenarios: controls of the synthetic project of
// probe_trust_steps.js that run its fake tool-manager shim `greet` in a directory other than the
// probe's scratch copy, and observations of the caller's temporary directory (the TMPDIR the
// harness features/steps/probetrust.go runs with).
const { Given, Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function writeControl(root, script, body) {
  const file = path.join(root, script);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\n${body}`, { mode: 0o755 });
}

// The control is like a driver that makes its own working copy: it creates a second temporary
// directory with mktemp under TMPDIR, records its path outside the probe, copies the project
// there, runs greet in that copy with its own arguments, removes the directory and exits with
// greet's status.
Given('the project has the control {string} that copies the project into a temporary directory it creates and runs greet there', function (script) {
  this.secondRecord = path.join(this.tmp('probetrust-record-'), 'second-tmp');
  writeControl(this.root, script, `second=$(mktemp -d "\${TMPDIR:-/tmp}/second-tmp.XXXXXX") || exit 3
printf '%s\\n' "$second" > '${this.secondRecord}'
cp -R . "$second/project" || exit 3
cd "$second/project" && greet "$@"
status=$?
cd / && rm -rf "$second"
exit $status
`);
});

// The copy lies directly in the caller's temporary directory, where the probe makes its scratch
// copy and its own temporary directory, but it is neither of them.
Given('the project has the control {string} that runs greet in a copy of the project in the caller\'s temporary directory', function (script) {
  const copy = path.join(fs.mkdtempSync(path.join(this.probeTmp, 'caller-')), 'project');
  fs.cpSync(this.root, copy, { recursive: true });
  writeControl(this.root, script, `cd '${copy}' && greet\n`);
});

Then('nothing the probe created is left in the caller\'s temporary directory', function () {
  const left = fs.readdirSync(this.probeTmp).filter((name) => name.startsWith('kogen-probe'));
  assert.deepEqual(left, [], `left behind in the caller's temporary directory ${this.probeTmp}: ${left.join(', ')}`);
});

Then('the control created its temporary directory directly inside a {string} directory of the caller\'s temporary directory', function (prefix) {
  assert.ok(fs.existsSync(this.secondRecord), `the control recorded no temporary directory in ${this.secondRecord}`);
  const created = path.normalize(fs.readFileSync(this.secondRecord, 'utf8').trim());
  const parent = path.dirname(created);
  assert.ok(path.dirname(parent) === this.probeTmp && path.basename(parent).startsWith(prefix) && path.basename(created).startsWith('second-tmp.'),
    `the control created its temporary directory ${created}; want ${this.probeTmp}/${prefix}<random>/second-tmp.<random>`);
});
