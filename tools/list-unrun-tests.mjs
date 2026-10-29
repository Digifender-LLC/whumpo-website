// Lists tests/*.mjs not referenced by a verify profile, package.json script or workflow.
import {readFileSync,readdirSync} from 'node:fs';
import {profiles} from './verify.mjs';
const text=readFileSync('package.json','utf8')+readdirSync('.github/workflows').map(f=>readFileSync('.github/workflows/'+f,'utf8')).join('\n');
const inProfile=new Set(Object.values(profiles).flat());
for(const f of readdirSync('tests').filter(f=>f.endsWith('.mjs')).sort()){
 const p='tests/'+f;
 if(!inProfile.has(p))console.log((text.includes(p)?'script/ci  ':'UNRUN      ')+p);
}
