const assert = require('node:assert/strict');
function observe(got, expected) {
 for (const [key,value] of Object.entries(expected)) {
  const actual=key.split('.').reduce((o,k)=>o?.[k],got);
  assert.deepEqual(actual,value,key);
 }
}
module.exports=observe;
if(require.main===module){
 const expected={'record.maintained_features.0.path':'spec/green.feature','record.maintained_features.1.result.problems.0':'Later failed','trace':['acceptance','model','feature'],'feedback':'spec/red.feature: Later failed'};
 const got={record:{maintained_features:[{path:'spec/green.feature'},{result:{problems:['Later failed']}}]},trace:['acceptance','model','feature'],feedback:'spec/red.feature: Later failed'};
 if(process.argv[2]==='bad') got.feedback='';
 try{observe(got,expected);console.log('accepted');}catch{console.log('rejected');process.exitCode=1;}
}
