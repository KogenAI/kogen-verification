const assert=require('node:assert/strict');
module.exports=function observe(actual, expected){
 const r=actual.record||{};
 const lines=(actual.feedback||'').split('\n').filter(x=>x.startsWith('Acceptance coverage:'));
 const got={green:r.green, uncovered:r.uncovered_acceptance, count:r.uncovered_acceptance_count, lines:lines.length, bounded:lines.every(x=>Buffer.byteLength(x)<=512)};
 if(expected.errorContains!==undefined){assert.ok((actual.error||'').includes(expected.errorContains),`refusal must name ${expected.errorContains}: ${actual.error}`);return;}
 if(expected.control){assert.equal(actual.sameRecord,true);assert.equal(actual.sameFeedback,true);assert.equal(Object.hasOwn(r,'uncovered_acceptance'),false);assert.equal(Object.hasOwn(r,'uncovered_acceptance_count'),false);assert.equal(lines.length,0);return;}
 if(expected.generatedCount){expected={...expected,uncovered:Array.from({length:expected.generatedCount},(_,i)=>`features/ch${String(i).padStart(3,'0')}.feature`)};delete expected.generatedCount;}
 if(expected.failureNames){for(const name of expected.failureNames)assert.ok((r.failing||[]).join('\n').includes(name),`failure missing ${name}`);expected={...expected};delete expected.failureNames;}
 assert.deepEqual(got,expected);
 if(got.count>0){assert.ok(lines[0].includes(String(got.count)),'coverage line must name total');assert.ok(lines[0].includes(got.uncovered[0]),'coverage line must name first path');}
};
if(require.main===module){
 const good={record:{green:true,uncovered_acceptance:['features/ch01.feature','features/ch02.feature'],uncovered_acceptance_count:2},feedback:'Acceptance coverage: 2 uncovered: features/ch01.feature, features/ch02.feature'};
 const expected={green:true,uncovered:['features/ch01.feature','features/ch02.feature'],count:2,lines:1,bounded:true};
 if(process.argv[2]==='bad')good.record.uncovered_acceptance.reverse();
 try{module.exports(good,expected);console.log('accepted');}catch(e){console.log('rejected');process.exitCode=1;}
}
