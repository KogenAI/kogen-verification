const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = 'TestReadinessRecordEqualsTheElixirRecordAndReadsBack';
function run(mode, version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readiness-unpinned-'));
  try {
    for (const name of ['go.mod', 'go.sum', 'verify']) fs.cpSync(name, path.join(root, name), { recursive: true });
    if (mode === 'foreign') {
      const file = path.join(root, 'verify/testdata/golden/readiness.json');
      const records = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const r of records) {
        r.sha256 = 'obsolete-coordinator-hash';
        r.baseline = ['obsolete-coordinator-path'];
        r.record.sha256 = r.sha256;
        r.record.baseline = r.baseline;
      }
      fs.writeFileSync(file, JSON.stringify(records));
    }
    if (mode.startsWith('fault')) {
      const file = path.join(root, 'verify/readiness.go');
      const text = fs.readFileSync(file, 'utf8');
      const changed = text.replace(/("version":\s*)3,/, (_, prefix) => prefix + '999,');
      if (changed === text) throw new Error('RecordPass version mutation did not apply');
      fs.writeFileSync(file, changed);
    }
    if (version !== 'pinned') {
      const edit = spawnSync('go', ['mod', 'edit', '-require=github.com/KogenAI/kogen-coordinator@' + version], { cwd: root, encoding: 'utf8' });
      if (edit.status !== 0) throw new Error(edit.stderr);
    }
    const args = ['test', '-mod=mod', './verify', '-count=1', '-run', '^' + test + '$', '-json'];
    const result = spawnSync('go', args, { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    if (require.main !== module) process.stdout.write(result.stdout + result.stderr);
    const events = result.stdout.split('\n').filter(x => x.startsWith('{')).map(x => JSON.parse(x));
    const wanted = mode === 'fault' ? 'fail' : 'pass';
    for (const suffix of ['readiness-simple', 'readiness-full']) {
      const name = test + '/' + suffix;
      if (events.filter(e => e.Test === name && e.Action === wanted).length !== 1) {
        throw new Error('go ' + args.join(' ') + ': required ' + name + ' outcome ' + wanted + '; absent, skipped, or wrong outcome\n' + result.stdout + result.stderr);
      }
    }
    if (result.error || result.status !== (mode === 'fault' ? 1 : 0)) throw new Error('go ' + args.join(' ') + ': unexpected process outcome\n' + result.stdout + result.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
if (require.main === module) {
  // Both controls ask the same observer to accept a passing run.
  try { run(process.argv[2] === 'bad' ? 'fault-as-pass' : 'normal', 'pinned'); console.log('accepted'); }
  catch (e) { console.log('rejected'); process.exitCode = 1; }
} else {
  const { Then } = require('@cucumber/cucumber');
  Then('k-verify-readiness-golden-unpinned: {word} records pass with coordinator {string}', { timeout: 240000 }, function (mode, version) { run(mode, version); });
  Then('k-verify-readiness-golden-unpinned: changing the written version makes both records fail', { timeout: 240000 }, function () { run('fault', 'pinned'); });
}
