const { Then } = require('@cucumber/cucumber');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
function pattern(s) { return new RegExp(s.replace(/^\(\?i\)/, ''), s.startsWith('(?i)') ? 'is' : 's'); }
Then('public README matches {string}', function (s) {
  assert.match(fs.readFileSync('README.md', 'utf8'), pattern(s));
});
Then('public README excludes {string}', function (s) {
  assert.doesNotMatch(fs.readFileSync('README.md', 'utf8'), pattern(s));
});
Then('public README contains exactly one inquiry address {string}', function (s) {
  assert.equal(fs.readFileSync('README.md', 'utf8').split(s).length - 1, 1, 'README inquiry address occurrence count');
});
Then('tracked public Markdown excludes {string}', function (s) {
  const files = cp.execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(p => p.endsWith('.md') && fs.existsSync(p));
  const hits = files.filter(p => pattern(s).test(fs.readFileSync(p, 'utf8')));
  assert.deepEqual(hits, [], 'Tracked Markdown with machine-specific paths');
});
Then('public policy files are absent', function () {
  const files = cp.execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
  assert.deepEqual(files.filter(p => /(^|\/)(SECURITY|CONTRIBUTING|BRANDING)\.md$/i.test(p) && fs.existsSync(p)), [], 'Excluded public policy files');
});
