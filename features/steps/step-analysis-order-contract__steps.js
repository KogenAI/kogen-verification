'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('error', reject);
    const timer = setTimeout(() => child.kill('SIGKILL'), 100000);
    child.on('close', code => { clearTimeout(timer); resolve({ code, out, command: [command, ...args].join(' ') }); });
  });
}

function passed(result, names) {
  const context = `${names.join(', ')} via ${result.command}: exit ${result.code}\n${result.out}`;
  assert.equal(result.code, 0, context);
  for (const name of names) {
    assert.ok(result.out.split('\n').some(line => line.startsWith(`--- PASS: ${name} (`)),
      `${name} absent, skipped or ran zero times; ${context}`);
  }
}

function rejected(result, names, property) {
  const context = `${property}: ${names.join(', ')} via ${result.command}: exit ${result.code}\n${result.out}`;
  assert.equal(result.code, 1, context);
  assert.ok(names.some(name => result.out.split('\n').some(line => line.startsWith(`--- FAIL: ${name} (`))),
    `No selected test rejected ${property}; ${context}`);
}

// The mutations exist only in a temporary Go overlay. The checkout is never changed.
// One test binary is built and reused for the baseline and all four mutations.
async function inspect(testSource) {
  const source = testSource === undefined ? await fs.readFile('verify/stepcheck_test.go', 'utf8') : testSource;
  const names = [...source.matchAll(/^func (Test[A-Za-z0-9_]+)\s*\(/gm)].map(m => m[1]);
  assert.ok(names.length, 'verify/stepcheck_test.go contains no runnable Go tests');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'step-analysis-order-'));
  try {
    let code = await fs.readFile('verify/stepcheck.go', 'utf8');
    const signature = 'func StepAnalysisIn(root, stepsDir string, intent *project.Intent, scenarios []project.Scenario) (own, files, texts []string) {';
    assert.equal(code.split(signature).length, 2, 'StepAnalysisIn overlay anchor changed');
    code = code.replace(signature, signature + '\n if filepath.Base(os.Args[0]) == "configured" { stepsDir = StepsFolder }');
    const end = '\treturn own, files, texts\n}';
    assert.equal(code.split(end).length, 2, 'StepAnalysisIn return overlay anchor changed');
    code = code.replace(end, `
 switch filepath.Base(os.Args[0]) {
 case "files": sort.Strings(files)
 case "repeated":
   texts = nil
   for _, sc := range scenarios { for _, st := range sc.Steps { texts = append(texts, st.Text) } }
 case "texts": sort.Strings(texts)
 }
${end}`);
    const production = path.join(dir, 'stepcheck.go');
    const tests = path.join(dir, 'stepcheck_test.go');
    await fs.writeFile(production, code);
    await fs.writeFile(tests, source);
    const overlay = path.join(dir, 'overlay.json');
    await fs.writeFile(overlay, JSON.stringify({ Replace: {
      [path.resolve('verify/stepcheck.go')]: production,
      [path.resolve('verify/stepcheck_test.go')]: tests
    } }));
    const binary = path.join(dir, 'verify.test');
    const build = await run('go', ['test', '-overlay', overlay, '-c', '-o', binary, './verify']);
    assert.equal(build.code, 0, `${names.join(', ')} via ${build.command}: exit ${build.code}\n${build.out}`);
    const filter = `^(${names.join('|')})$`;
    const results = { names };
    for (const mutation of ['', 'files', 'repeated', 'texts', 'configured']) {
      const executable = mutation ? path.join(dir, mutation) : binary;
      if (mutation) await fs.symlink(binary, executable);
      results[mutation || 'baseline'] = await run(executable, ['-test.run=' + filter, '-test.v', '-test.count=1']);
    }
    return results;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function verify(results, mutations) {
  passed(results.baseline, results.names);
  for (const mutation of mutations) rejected(results[mutation], results.names, mutation);
}

if (require.main === module) {
  // Final-byte observer controls use the exact correct and configured-coverage-wrong
  // test fixtures retained in controls.json, not invented test-runner transcripts.
  (async () => {
    const mode = process.argv[2];
    assert.ok(mode === 'good' || mode === 'bad');
    const controls = JSON.parse(await fs.readFile('.kogen/intents/step-analysis-order-contract/controls.json', 'utf8'));
    const files = mode === 'good' ? controls.correct.files : controls.wrong.find(w => w.name === 'omit configured coverage').files;
    const results = await inspect(files['verify/stepcheck_test.go']);
    verify(results, ['files', 'repeated', 'texts', 'configured']);
    process.stdout.write('observer accepted\n');
  })().catch(() => { process.stdout.write('observer rejected\n'); process.exitCode = 1; });
} else {
  const { Given, Then } = require('@cucumber/cucumber');
  let inspection;
  Given('step-analysis-order-contract: the existing step analysis test file is available', async function () {
    await fs.access('verify/stepcheck_test.go');
  });
  Then('step-analysis-order-contract: its tests reject {string} while passing unchanged analysis', { timeout: 115000 }, async function (mutations) {
    if (!inspection) inspection = inspect();
    verify(await inspection, mutations.split(','));
  });
}
