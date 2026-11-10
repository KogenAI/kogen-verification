const {Then} = require('@cucumber/cucumber');
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const check = require('./verification-go-test-v-runs-count__observer');
let binary;
function run(cmd,args,env=process.env) { return new Promise((resolve,reject)=>{const p=spawn(cmd,args,{env});let out='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>out+=d);p.on('error',reject);p.on('close',code=>code===0?resolve(out):reject(new Error(cmd+' '+args.join(' ')+' exit '+code+'\n'+out)));}); }
async function built() {
 if (!binary) binary=(async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'verbose-intent-'));const source=path.resolve('features/steps/verification-go-test-v-runs-count__driver/probe_test.go');const overlay=path.join(dir,'overlay.json');await fs.writeFile(overlay,JSON.stringify({Replace:{[path.resolve('verify/verbose_intent_probe_test.go')]:source}}));const bin=path.join(dir,'probe');await run('go',['test','-tags=intentprobe','-overlay',overlay,'-c','-o',bin,'./verify']);return bin;})();
 return binary;
}
Then('verification-go-test-v-runs-count: transcript yields {string}', async function(expected,doc) {
 const out=await run(await built(),['-test.run=^TestVerboseIntentProbe$'],{...process.env,VERBOSE_TRANSCRIPT:doc});
 const line=out.split('\n').find(x=>x.startsWith('VERBOSE_RESULT='));
 if(!line) throw new Error('TestVerboseIntentProbe produced no result: '+out);
 check(JSON.parse(line.slice(15)),JSON.parse(expected));
});
