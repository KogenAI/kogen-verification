const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function fixture(mode) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-install-'));
  const home = path.join(base, 'caller');
  const root = path.join(base, 'project');
  const bin = path.join(base, 'bin');
  const privateHome = path.join(base, 'private');
  for (const p of [home, root, bin, privateHome]) fs.mkdirSync(p);
  const xdg = path.join(base, 'data');
  const data = mode === 'explicit' ? path.join(base, 'custom-mise') : mode === 'xdg' ? path.join(xdg, 'mise') : path.join(home, '.local/share/mise');
  fs.mkdirSync(path.join(data, 'installs/ruby/3.4.8/gems'), { recursive: true });
  fs.writeFileSync(path.join(data, 'installs/ruby/3.4.8/gems/rails'), 'installed rails package\n');
  fs.writeFileSync(path.join(data, 'installs/ruby/3.4.8/run'), '#!/bin/sh\ncat "$(dirname "$0")/gems/rails"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'fixture-ruby'), '#!/bin/sh\ndata=${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}\nif [ ! -x "$data/installs/ruby/3.4.8/run" ]; then echo "missing installation"; exit 1; fi\nexec "$data/installs/ruby/3.4.8/run"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(home, 'private-marker'), 'caller only');
  fs.writeFileSync(path.join(root, 'check'), '#!/bin/sh\nset -eu\n[ ! -e "$HOME/private-marker" ] || { echo "home leaked"; exit 2; }\n[ -z "${PROBE_SECRET:-}" ] || { echo "secret leaked"; exit 2; }\n[ -z "${GEM_HOME:-}${GEM_PATH:-}${BUNDLE_PATH:-}" ] || { echo "selectors leaked"; exit 2; }\nfixture-ruby\n');
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: home, PROBE_SECRET: 'synthetic', GEM_HOME: '/not-the-install', GEM_PATH: '/not-the-install', BUNDLE_PATH: '/not-the-install' };
  if (mode === 'explicit') env.MISE_DATA_DIR = data;
  if (mode === 'xdg') env.XDG_DATA_HOME = xdg;
  return { base, root, home, data, privateHome, env };
}
function shell(command, cwd, env) {
  const r = spawnSync('/bin/sh', ['-c', `exec 2>&1\n${command}`], { cwd, env, encoding: 'utf8', timeout: 30000 });
  if (r.error) throw r.error;
  return { status: r.status, output: r.stdout };
}
function observe(result, output) {
  assert.deepEqual(result, { status: 0, output }, `installed tool and package with isolated home: ${JSON.stringify(result)}`);
}
if (require.main === module) {
  const f = fixture('default');
  try {
    const env = { PATH: f.env.PATH, HOME: f.privateHome, MISE_DATA_DIR: f.data };
    if (process.argv[2] === 'bad') {
      // All independently reach the observer, including isolation checks normally masked by tool red.
      for (const altered of [{ ...env, MISE_DATA_DIR: '' }, { ...env, HOME: f.home }, { ...env, PROBE_SECRET: 'synthetic' }, { ...env, GEM_HOME: 'wrong' }]) {
        let rejected = false;
        try { observe(shell('sh check', f.root, altered), 'installed rails package\n'); } catch { rejected = true; }
        if (!rejected) throw new Error('bad fixture accepted');
      }
      console.log('bad fixtures rejected');
      process.exitCode = 1;
    } else {
      observe(shell('sh check', f.root, env), 'installed rails package\n');
      console.log('good fixture accepted');
    }
  } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
} else {
  const { When, Then } = require('@cucumber/cucumber');
  When('an installed mise fixture uses {string} data discovery in a real probe', function (mode) {
    assert.ok(['default', 'explicit', 'xdg'].includes(mode));
    const f = fixture(mode);
    try {
      this.installDirect = shell('fixture-ruby', f.root, f.env);
      const harness = path.join(f.base, 'probetrust');
      const built = spawnSync('go', ['build', '-o', harness, './features/steps'], { encoding: 'utf8', timeout: 120000 });
      assert.equal(built.status, 0, `build existing probetrust harness: ${built.stdout}${built.stderr}`);
      const r = spawnSync(harness, ['probe', f.root, 'sh check'], { env: f.env, encoding: 'utf8', timeout: 60000 });
      assert.equal(r.status, 0, `real Probe.Run harness: ${r.stdout}${r.stderr}`);
      const got = JSON.parse(r.stdout);
      assert.equal(got.timed_out, false);
      this.installResult = { status: got.status, output: got.output };
    } finally { fs.rmSync(f.base, { recursive: true, force: true }); }
  });
  Then('both installed-tool runs print {string} and the probe retains isolation', function (line) {
    observe(this.installDirect, `${line}\n`);
    observe(this.installResult, `${line}\n`);
  });
}
