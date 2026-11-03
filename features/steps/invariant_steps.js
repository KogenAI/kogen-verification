'use strict';
const {When, Then} = require('@cucumber/cucumber');
const {spawnSync} = require('node:child_process');
const assert = require('node:assert/strict');
const observe = require('./invariant_observer.cjs');
When('the synthetic invariant model is checked with:', {timeout:120000}, function (text) {
 const r=spawnSync('go',['run','./features/steps/invariantdriver'],{input:text,encoding:'utf8',timeout:110000});
 assert.equal(r.status,0,`invariant driver: ${r.error || ''}\n${r.stdout}\n${r.stderr}`);
 this.invariantActual=JSON.parse(r.stdout);
});
Then('the invariant evidence is:', function(text) { observe(this.invariantActual,JSON.parse(text)); });
