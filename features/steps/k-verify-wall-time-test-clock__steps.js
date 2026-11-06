'use strict';
const { AfterAll, Given, When, Then } = require('@cucumber/cucumber');
const driver = require('./k-verify-wall-time-test-clock__driver.js');

const P = 'k-verify-wall-time-test-clock: ';

AfterAll(function () {
  driver.cleanup();
});

Given(P + 'the {string} product variant is built', { timeout: 115 * 1000 }, async function (variant) {
  this.wallTimeClockBuild = await driver.build(variant);
});

When(P + 'TestWallTimeDeadlineAndNeverStarted runs {int} time(s) against it', { timeout: 115 * 1000 }, async function (runs) {
  this.wallTimeClockRuns = runs;
  this.wallTimeClockResults = await driver.runTest(this.wallTimeClockBuild, runs);
});

Then(P + 'every run passes', function () {
  driver.requireEveryRunPasses(this.wallTimeClockResults, this.wallTimeClockRuns);
});

Then(P + 'the test fails', function () {
  driver.requireFails(this.wallTimeClockResults);
});

Then(P + 'the test fails at its 30-second fallback deadline', function () {
  driver.requireFailsAtFallback(this.wallTimeClockResults);
});
