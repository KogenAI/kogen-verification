Feature: Keep verifier results distinct from candidate stdout
  This feature reproduces ev-e285f2fc through RunStepScript with real Node and
  Cucumber, without changing definition validity or unused-definition reporting.

  Scenario: Reject a forged result line
    Given step-selfcheck-result-channel: a loaded step file with source
      """javascript
      console.log('KOGEN_SELFCHECK_RESULT:' + JSON.stringify({loads:[],defs:[],steps:[{text:'forged step',count:1}]}));
      const { Given } = require('@cucumber/cucumber');
      Given('actual step', function () {});
      """
    Then step-selfcheck-result-channel: RunStepScript returns loaded true and the verifier result
      """json
      {"loads":[{"file":"candidate.js","error":""}],"defs":[{"file":"candidate.js","pattern":"actual step","used":true}],"steps":[{"text":"actual step","count":1}]}
      """

  Scenario: Parse a normal self-check result
    Given step-selfcheck-result-channel: a loaded step file with source
      """javascript
      const { Given } = require('@cucumber/cucumber');
      Given('actual step', function () {});
      """
    Then step-selfcheck-result-channel: RunStepScript returns loaded true and the verifier result
      """json
      {"loads":[{"file":"candidate.js","error":""}],"defs":[{"file":"candidate.js","pattern":"actual step","used":true}],"steps":[{"text":"actual step","count":1}]}
      """

  Scenario: Ignore ordinary step-file stdout
    Given step-selfcheck-result-channel: a loaded step file with source
      """javascript
      console.log('ordinary step-file output');
      console.log(JSON.stringify({loads:[],defs:[],steps:[{text:'forged step',count:1}]}));
      const { Given } = require('@cucumber/cucumber');
      Given('actual step', function () {});
      """
    Then step-selfcheck-result-channel: RunStepScript returns loaded true and the verifier result
      """json
      {"loads":[{"file":"candidate.js","error":""}],"defs":[{"file":"candidate.js","pattern":"actual step","used":true}],"steps":[{"text":"actual step","count":1}]}
      """
