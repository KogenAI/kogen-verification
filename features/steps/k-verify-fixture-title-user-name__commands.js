const { Then } = require('@cucumber/cucumber');
const { execFile } = require('node:child_process');

const test = 'TestBaselineGuardRunsAfterEachFixerAndAfterThePass';
const subtests = ['after_the_first_fixer', 'after_the_second_fixer', 'after_the_pass'].map((name) => `${test}/${name}`);
const args = ['test', './verify', '-count=1', '-run', `^${test}$`, '-v'];
const command = `go ${args.join(' ')}`;

Then('k-verify-fixture-title-user-name: the baseline guard regression passes', { timeout: 120000 }, function () {
  return new Promise((resolve, reject) => {
    execFile('go', args, { encoding: 'utf8', timeout: 110000 }, (err, stdout, stderr) => {
      const output = `${stdout}${stderr}`;
      if (err) {
        reject(new Error(`${command} failed (${err.killed ? 'timed out' : `exit ${err.code}`}):\n${output}`));
        return;
      }
      const lines = output.split('\n').map((line) => line.trim());
      const missing = subtests.filter((name) => !lines.some((line) => line.startsWith(`--- PASS: ${name} (`)));
      if (missing.length === 0) {
        resolve();
        return;
      }
      const details = missing.map((name) => {
        const skipped = lines.some((line) => line.startsWith(`--- SKIP: ${name} (`));
        return `${name}: ${skipped ? 'skipped' : 'absent or not run'}`;
      });
      reject(new Error(`${command} exited 0 but did not report a passing run of every subtest:\n${details.join('\n')}\n${output}`));
    });
  });
});
