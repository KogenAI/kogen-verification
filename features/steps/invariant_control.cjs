'use strict';
const {spawnSync}=require('node:child_process');
const observe=require('./invariant_observer.cjs');
const r=spawnSync('go',['run','./features/steps/invariantdriver'],{input:JSON.stringify({Names:['A','B','C'],Violate:'B'}),encoding:'utf8',timeout:110000});
if(r.status!==0) {process.stderr.write(r.stderr);process.exit(2);}
const actual=JSON.parse(r.stdout);
if(process.argv[2]==='bad') actual.calls[2][6]='A,B,C';
try {observe(actual,{names:['A','B','C'],state:'failed',problem:'^model\\.qnt: invariant B violated \\(seed 17\\)\\n\\[violation\\]\\n?$',lines:2}); console.log('accepted');}
catch(e) {console.log('rejected');process.exit(1);}
