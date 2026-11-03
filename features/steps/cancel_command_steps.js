'use strict';
const { When, Then, AfterAll } = require('@cucumber/cucumber');
const harness = require('./cancel_command_harness.cjs');
When('the cancellation fixture uses the {string} route with ordering {string}', { timeout: 240000 }, function (route, mode) {
  this.cancelCommand = harness.drive(route, mode);
});
Then('the cancellation fixture reports these observations:', function (text) {
  harness.observe(this.cancelCommand, JSON.parse(text));
});
AfterAll(harness.cleanup);
