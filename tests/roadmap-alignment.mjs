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
missing('WH-068','WH-154');missing('WH-068','WH-160');
missing('WH-077','WH-186');missing('WH-077','WH-191');
missing('WH-063','WH-199');missing('WH-063','WH-204');missing('WH-063','WH-205');
missing('WH-022','WH-168');missing('WH-022','WH-172');
missing('WH-034','WH-192');missing('WH-034','WH-197');missing('WH-034','WH-198');
missing('WH-061','WH-180');missing('WH-061','WH-184');
missing('WH-111','WH-206');missing('WH-111','WH-213');
for(const [from,to] of [['WH-121','WH-020'],['WH-122','WH-090'],['WH-116','WH-020'],['WH-156','WH-069'],['WH-158','WH-094'],['WH-159','WH-080'],['WH-154','WH-036'],['WH-186','WH-018'],['WH-186','WH-067'],['WH-187','WH-072'],['WH-188','WH-049'],['WH-191','WH-104'],
 ['WH-199','WH-036'],['WH-200','WH-005'],['WH-203','WH-036'],['WH-204','WH-048'],['WH-205','WH-104'],
 ['WH-168','WH-023'],['WH-169','WH-044'],['WH-170','WH-104'],['WH-171','WH-041'],['WH-172','WH-049'],['WH-022','WH-044'],
 ['WH-193','WH-045'],['WH-197','WH-049'],['WH-195','WH-041'],['WH-196','WH-044'],['WH-194','WH-023'],['WH-198','WH-104'],['WH-198','WH-047'],
 ['WH-181','WH-033'],['WH-183','WH-033'],['WH-184','WH-049'],['WH-182','WH-104'],
 ['WH-206','WH-112'],['WH-209','WH-048'],['WH-211','WH-104'],['WH-213','WH-049']]){
 const data=structuredClone(current);task(data,from).dependsOn.push(to);
 assert.ok(alignmentProblems(data).includes(`${from} must remain independent of downstream/optional gate ${to}`));refused++;
}
const cycle=structuredClone(current);task(cycle,'WH-122').dependsOn.push('WH-090');
await assert.rejects(validateRoadmap(cycle),/cycle/i);refused++;
console.log(`Roadmap handoffs passed: current graph accepted; ${refused} missing-prerequisite, downstream-gate and cycle regressions refused.`);
