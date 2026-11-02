// Steps of the probe trust scenarios: a synthetic project whose tool configuration a fake
// tool manager trusts only at the project's real location, run directly and as verify probes
// through the harness features/steps/probetrust.go.
const { Before, After, BeforeAll, AfterAll, Given, When, Then, setDefaultTimeout } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

setDefaultTimeout(300 * 1000);

const GREETING = 'hello from the project tool';

// greet is reached on PATH like a tool-manager shim: it refuses the .mise.toml of its working
// directory unless that directory is under an entry of MISE_TRUSTED_CONFIG_PATHS.
const GREET = `#!/bin/sh
config="$PWD/.mise.toml"
if [ -f "$config" ]; then
  here=$(pwd -P)
  trusted=no
  old_ifs=$IFS
  IFS=:
  for entry in $MISE_TRUSTED_CONFIG_PATHS; do
    [ -n "$entry" ] || continue
    real=$(cd "$entry" 2>/dev/null && pwd -P) || continue
    case "$here/" in "\${real%/}/"*) trusted=yes ;; esac
  done
  IFS=$old_ifs
  if [ "$trusted" = no ]; then
    echo "greet: Config files in $config are not trusted." >&2
    exit 1
  fi
fi
if [ "$#" -gt 0 ]; then
  echo "greet: unknown option $1" >&2
  exit 2
fi
sed -n 's/^greeting = "\\(.*\\)"$/\\1/p' "$config"
`;

let harness;
let harnessDir;

BeforeAll(function () {
  harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'probetrust-harness-'));
  harness = path.join(harnessDir, 'probetrust');
  const built = spawnSync('go', ['build', '-o', harness, './features/steps'], { encoding: 'utf8' });
  assert.equal(built.status, 0, `go build ./features/steps (probetrust.go) failed: ${built.stdout}${built.stderr}`);
});

AfterAll(function () {
  if (harnessDir) fs.rmSync(harnessDir, { recursive: true, force: true });
});

Before(function () {
  this.dirs = [];
  this.tmp = (prefix) => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    this.dirs.push(dir);
    return dir;
  };
});

After(function () {
  for (const dir of this.dirs) fs.rmSync(dir, { recursive: true, force: true });
});

Given('a project whose tool configuration the tool manager trusts only at the project\'s own location', function () {
  this.root = this.tmp('probetrust-project-');
  fs.writeFileSync(path.join(this.root, '.mise.toml'), `greeting = "${GREETING}"\n`);
  fs.mkdirSync(path.join(this.root, 'features/steps'), { recursive: true });
  fs.writeFileSync(path.join(this.root, 'features/steps/fixture_steps.js'), '// observer bytes\n');
  const bin = this.tmp('probetrust-bin-');
  fs.writeFileSync(path.join(bin, 'greet'), GREET, { mode: 0o755 });
  this.probeTmp = this.tmp('probetrust-tmp-');
  this.env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, MISE_TRUSTED_CONFIG_PATHS: this.root, TMPDIR: this.probeTmp };
});

function runIn(world, command, dir) {
  const r = spawnSync('/bin/sh', ['-c', `exec 2>&1\n${command}`], { cwd: dir, env: world.env, encoding: 'utf8' });
  world.result = { where: `${command} in ${dir}`, status: r.status, output: r.stdout };
}

When('the control {string} runs in the project with the caller\'s environment', function (command) {
  runIn(this, command, this.root);
});

When('the control {string} runs in a copy of the project elsewhere with the caller\'s environment', function (command) {
  const copy = path.join(this.tmp('probetrust-elsewhere-'), 'project');
  fs.cpSync(this.root, copy, { recursive: true });
  runIn(this, command, copy);
});

When('the control {string} runs as a probe of the project', function (command) {
  const r = spawnSync(harness, ['probe', this.root, command], { env: this.env, encoding: 'utf8' });
  assert.equal(r.status, 0, `probetrust probe ${this.root} ${command} failed: exit ${r.status}: ${r.stdout}${r.stderr}`);
  const got = JSON.parse(r.stdout);
  assert.equal(got.timed_out, false, `probe of ${command} timed out: ${r.stdout}`);
  this.result = { where: `probe of ${command}`, status: got.status, output: got.output };
});

When('the control {string} runs as a probe of the project from a copy of the project elsewhere', function (command) {
  const copy = path.join(this.tmp('probetrust-elsewhere-'), 'project');
  fs.cpSync(this.root, copy, { recursive: true });
  const r = spawnSync(harness, ['probe', this.root, `cd '${copy}' && ${command}`], { env: this.env, encoding: 'utf8' });
  assert.equal(r.status, 0, `probetrust probe ${this.root} (${command} in ${copy}) failed: exit ${r.status}: ${r.stdout}${r.stderr}`);
  const got = JSON.parse(r.stdout);
  assert.equal(got.timed_out, false, `probe of ${command} in ${copy} timed out: ${r.stdout}`);
  this.result = { where: `probe of ${command} in ${copy}`, status: got.status, output: got.output };
});

When('the declared observer {string} whose good control {string} expects exit {int} and the output line {string} is executed for the project', function (id, command, exit, line) {
  assert.equal(exit, 0, 'an observer good check expects exit 0');
  const r = spawnSync(harness, ['execute', this.root, id, command, `${line}\n`], { env: this.env, encoding: 'utf8' });
  assert.equal(r.status, 0, `probetrust execute failed: exit ${r.status}: ${r.stdout}${r.stderr}`);
  this.refusal = r.stdout;
});

Then('it exits {int} with the output line {string}', function (status, line) {
  const want = `${line}\n`;
  assert.deepEqual({ status: this.result.status, output: this.result.output }, { status, output: want },
    `${this.result.where}: exit ${this.result.status}, output ${JSON.stringify(this.result.output)}; want exit ${status}, output ${JSON.stringify(want)}`);
});

Then('it exits {int} with output containing {string}', function (status, text) {
  assert.ok(this.result.status === status && this.result.output.includes(text),
    `${this.result.where}: exit ${this.result.status}, output ${JSON.stringify(this.result.output)}; want exit ${status}, output containing ${JSON.stringify(text)}`);
});

Then('the declared evidence is met', function () {
  assert.equal(this.refusal, 'met\n', `want the declared evidence met; got: ${this.refusal}`);
});

Then('the declared evidence is refused with {string}', function (text) {
  assert.ok(this.refusal.includes(text), `want a refusal containing ${JSON.stringify(text)}; got: ${this.refusal}`);
});
