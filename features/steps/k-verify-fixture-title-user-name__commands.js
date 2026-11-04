const { Then } = require('@cucumber/cucumber');
const { execFileSync } = require('node:child_process');

Then('k-verify-fixture-title-user-name: the baseline guard regression passes', { timeout: 120000 }, function () {
  execFileSync('go', ['test', './verify', '-count=1', '-run', '^TestBaselineGuardRunsAfterEachFixerAndAfterThePass$', '-v'], { encoding: 'utf8', timeout: 110000, stdio: 'pipe' });
});
