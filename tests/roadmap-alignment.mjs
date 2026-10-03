import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateRoadmap,alignmentProblems} from '../tools/roadmap.mjs';

const current=JSON.parse(await readFile(new URL('../docs/roadmap/backlog.json',import.meta.url),'utf8'));
await validateRoadmap(current);assert.deepEqual(alignmentProblems(current),[]);
const task=(data,id)=>data.tasks.find(t=>t.id===id);
let refused=0;
function missing(id,prerequisite){
 const data=structuredClone(current);
 // Remove every incoming path to one handoff, rather than accidentally retaining
 // it transitively through another feature.
 for(const t of data.tasks)t.dependsOn=t.dependsOn.filter(d=>d!==prerequisite);
 assert.ok(alignmentProblems(data).includes(`${id} must follow shared prerequisite ${prerequisite}`));refused++;
}
for(const id of ['WH-054','WH-056','WH-067','WH-075','WH-091','WH-106'])missing(id,'WH-122');
missing('WH-116','WH-121');missing('WH-090','WH-054');missing('WH-090','WH-099');missing('WH-104','WH-090');
for(const [from,to] of [['WH-121','WH-020'],['WH-122','WH-090'],['WH-116','WH-020']]){
 const data=structuredClone(current);task(data,from).dependsOn.push(to);
 assert.ok(alignmentProblems(data).includes(`${from} must remain independent of downstream/optional gate ${to}`));refused++;
}
const cycle=structuredClone(current);task(cycle,'WH-122').dependsOn.push('WH-090');
await assert.rejects(validateRoadmap(cycle),/cycle/i);refused++;
console.log(`Roadmap handoffs passed: current graph accepted; ${refused} missing-prerequisite, downstream-gate and cycle regressions refused.`);
