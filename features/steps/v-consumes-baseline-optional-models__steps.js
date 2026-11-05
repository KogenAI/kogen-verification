const { Given, Then } = require('@cucumber/cucumber');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const P = 'v-consumes-baseline-optional-models: ';
const coordinator = 'github.com/KogenAI/kogen-coordinator';
const fixture = 'verify/testdata/readiness-simple';
const modelsPath = '.kogen/models.yaml';
// The lineup written into a copy of the fixture: project.ModelsTemplate() of the pinned coordinator.
const lineup = 'models:\n  shape:\n    model: gpt-6.1-sol\n    effort: high\n  build:\n    model: gpt-6.1-sol\n    effort: medium\n  review:\n    model: gpt-6.1-terra\n    effort: medium\n';
// The pinned coordinator's last Baseline line, and the absent-file rule added in front of it.
const insertLine = '\treturn slices.Insert(all, slices.Index(all, ConfigPath)+1, ModelsPath), nil\n';
const absentRule = '\tif !isRegular(filepath.Join(root, ModelsPath)) {\n\t\treturn all, nil\n\t}\n';
const baselineProgram = `package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/KogenAI/kogen-coordinator/project"
)

func main() {
	for _, root := range os.Args[1:] {
		cfg, err := project.LoadConfig(root)
		if err != nil {
			fmt.Println(err)
			os.Exit(2)
		}
		paths, err := project.Baseline(root, "fixture", cfg)
		if err != nil {
			fmt.Println(err)
			os.Exit(2)
		}
		b, _ := json.Marshal(paths)
		fmt.Println(string(b))
	}
}
`;

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr, command: `${cmd} ${args.join(' ')}`, outcome: err ? (err.killed ? 'timed out' : `exit ${err.code}`) : 'exit 0' });
    });
  });
}

function writable(dir) {
  fs.chmodSync(dir, 0o755);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) writable(p);
    else fs.chmodSync(p, 0o644);
  }
}

// withCoordinator gives fn the go build flags that select the named coordinator: none for the
// pinned one; for the absent-file rule, -modfile with a replace onto a scratch copy of the pinned
// coordinator's source whose Baseline leaves .kogen/models.yaml out when that file is absent.
async function withCoordinator(name, fn) {
  if (name === 'pinned') return fn([]);
  if (name !== 'absent-file rule') throw new Error(`unknown coordinator ${JSON.stringify(name)}: use "pinned" or "absent-file rule"`);
  const listed = await run('go', ['list', '-m', '-f', '{{.Dir}}', coordinator], 60000);
  const dir = listed.stdout.trim();
  if (listed.err || !dir) throw new Error(`${listed.command} (${listed.outcome}) did not name the pinned coordinator's source:\n${listed.stdout}${listed.stderr}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v-consumes-baseline-optional-models-'));
  try {
    const copy = path.join(tmp, 'coordinator');
    fs.cpSync(dir, copy, { recursive: true });
    writable(copy);
    const file = path.join(copy, 'project/baseline.go');
    const text = fs.readFileSync(file, 'utf8');
    if (text.split(insertLine).length !== 2) throw new Error(`the pinned coordinator's ${dir}/project/baseline.go does not end Baseline with exactly one line ${JSON.stringify(insertLine)}; the absent-file rule cannot be added`);
    fs.writeFileSync(file, text.replace(insertLine, absentRule + insertLine));
    const mod = path.join(tmp, 'mod');
    fs.mkdirSync(mod);
    fs.writeFileSync(path.join(mod, 'go.mod'), `${fs.readFileSync('go.mod', 'utf8')}\nreplace ${coordinator} => ${copy}\n`);
    fs.copyFileSync('go.sum', path.join(mod, 'go.sum'));
    return await fn([`-modfile=${path.join(mod, 'go.mod')}`]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

Given(P + 'go.mod has SHA-256 {string} and go.sum has SHA-256 {string}', function (mod, sum) {
  const got = { 'go.mod': sha256('go.mod'), 'go.sum': sha256('go.sum') };
  const want = { 'go.mod': mod, 'go.sum': sum };
  const changed = Object.keys(want).filter((f) => got[f] !== want[f]);
  if (changed.length) throw new Error(changed.map((f) => `${f} changed: SHA-256 ${got[f]}, expected ${want[f]}`).join('\n'));
});

Given(P + 'go.mod requires {string} at {string}', function (module, version) {
  const lines = fs.readFileSync('go.mod', 'utf8').split('\n').map((l) => l.trim().replace(/^require\s+/, ''));
  const found = lines.filter((l) => l.split(/\s+/)[0] === module);
  if (found.length !== 1 || found[0] !== `${module} ${version}`) throw new Error(`go.mod requires ${JSON.stringify(found)}, expected exactly "${module} ${version}"`);
});

Then(P + 'a copy of the readiness-simple fixture has these baselines:', { timeout: 120000 }, async function (table) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v-consumes-baseline-optional-models-'));
  try {
    const roots = {};
    for (const state of ['absent', 'present']) {
      roots[state] = path.join(tmp, state);
      fs.cpSync(fixture, roots[state], { recursive: true });
      fs.rmSync(path.join(roots[state], modelsPath), { force: true });
      if (state === 'present') fs.writeFileSync(path.join(roots[state], modelsPath), lineup);
    }
    const program = path.join(tmp, 'baseline.go');
    fs.writeFileSync(program, baselineProgram);
    const got = {};
    for (const name of [...new Set(table.hashes().map((r) => r.coordinator))]) {
      await withCoordinator(name, async (flags) => {
        const r = await run('go', ['run', '-trimpath', ...flags, program, roots.absent, roots.present], 110000);
        const lines = r.stdout.trim().split('\n');
        if (r.err || lines.length !== 2) throw new Error(`${r.command} with the ${name} coordinator (${r.outcome}) did not print two baselines:\n${r.stdout}${r.stderr}`);
        got[`${name}/absent`] = JSON.parse(lines[0]).join(', ');
        got[`${name}/present`] = JSON.parse(lines[1]).join(', ');
      });
    }
    const wrong = table.hashes().filter((r) => got[`${r.coordinator}/${r[modelsPath]}`] !== r.baseline)
      .map((r) => `${r.coordinator} coordinator, ${modelsPath} ${r[modelsPath]}: baseline ${got[`${r.coordinator}/${r[modelsPath]}`]}, expected ${r.baseline}`);
    if (wrong.length) throw new Error(wrong.join('\n'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

Then(P + 'with the {string} coordinator, go test of package {string} passes', { timeout: 120000 }, async function (name, pkg) {
  const full = `github.com/KogenAI/kogen-verification/${pkg.replace(/^\.\//, '')}`;
  await withCoordinator(name, async (flags) => {
    const args = ['test', '-trimpath', ...flags, '-count=1', '-json', pkg];
    const r = await run('go', args, 110000);
    const events = r.stdout.split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
    const output = events.map((e) => e.Output || '').join('') + r.stderr;
    const ends = events.filter((e) => e.Package === full && !e.Test && ['pass', 'fail', 'skip'].includes(e.Action)).map((e) => e.Action);
    const failed = events.filter((e) => e.Package === full && e.Test && e.Action === 'fail').map((e) => e.Test);
    if (r.err || ends.length !== 1 || ends[0] !== 'pass') {
      throw new Error(`go ${args.join(' ')} with the ${name} coordinator: process ${r.outcome}, package ${full} ${ends.length ? ends.join(', ') : 'reported no result'}, expected one pass${failed.length ? `; failed tests: ${failed.join(', ')}` : ''}\n${output.split('\n').filter((l) => /^\s+\S+_test\.go:\d+:/.test(l)).join('\n')}\n${output}`);
    }
  });
});
