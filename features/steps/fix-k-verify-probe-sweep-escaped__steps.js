'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { AfterAll, When, Then } = require('@cucumber/cucumber');
const harness = require('./fix-k-verify-probe-sweep-escaped__harness.js');

const P = 'fix-k-verify-probe-sweep-escaped: ';

AfterAll(function () {
  harness.cleanup();
});

When(P + 'TestProbeRealTimeoutEscaped runs with the {string} variant', { timeout: 115 * 1000 }, async function (variant) {
  this.fixProbeSweepEscaped = await harness.runTests(process.cwd(), variant);
});

When(P + 'these existing tests run with the {string} variant:', { timeout: 115 * 1000 }, async function (variant, text) {
  const names = text.split('\n').map((line) => line.trim()).filter(Boolean);
  this.fixProbeSweepEscaped = await harness.runTests(process.cwd(), variant, names);
});

Then(P + 'the test passes', function () {
  harness.judgeRun('pass', this.fixProbeSweepEscaped);
});

Then(P + 'the test fails', function () {
  harness.judgeRun('fail', this.fixProbeSweepEscaped);
});

Then(P + 'each of them passes', function () {
  harness.judgeEach(this.fixProbeSweepEscaped);
});

Then(P + 'the file {string} starts with the line {string}', function (file, line) {
  harness.judgeFirstLine(file, fs.readFileSync(path.join(process.cwd(), file), 'utf8'), line);
});
