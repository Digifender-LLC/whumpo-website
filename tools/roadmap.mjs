import {readFile,writeFile,stat,realpath} from 'node:fs/promises';
import {dirname,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sourcePath=resolve(root,'docs/roadmap/backlog.json');
const outputPath=resolve(root,'docs/roadmap/backlog.md');
const repository='https://github.com/zemdregon/whumpo';
const priorities=['P0','P1','P2'];
const taskFields=['id','title','phase','priority','readiness','kind','size','dependsOn','blockers','outcome','scope','acceptance','verification','references','issue','owner','evidence'];
const fail=message=>{throw Error(message);};
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
function record(value,fields,label){
 if(!value||typeof value!=='object'||Array.isArray(value))fail(`${label} must be an object`);
 for(const field of fields)if(!Object.hasOwn(value,field))fail(`${label}.${field} is required`);
 for(const field of Object.keys(value))if(!fields.includes(field))fail(`${label}.${field} is unknown`);
}
function strings(value,label,required=false){
 if(!Array.isArray(value)||value.some(item=>!nonempty(item))||(required&&!value.length))fail(`${label} must be ${required?'a nonempty':'an'} array of nonempty strings`);
 if(new Set(value).size!==value.length)fail(`${label} contains duplicates`);
}
function oneOf(value,options,label){if(!options.includes(value))fail(`${label} must be one of ${options.join(', ')}`);}
function inside(path){const local=relative(root,path);return local!== '..'&&!local.startsWith(`..${sep}`)&&!isAbsolute(local);}

export async function validateRoadmap(data){
 record(data,['schemaVersion','reviewedAt','sourceCommit','phases','tasks'],'backlog');
 if(data.schemaVersion!==1)fail('schemaVersion must be 1');
 if(typeof data.reviewedAt!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.reviewedAt)||Number.isNaN(Date.parse(data.reviewedAt))||new Date(data.reviewedAt).toISOString().slice(0,10)!==data.reviewedAt)fail('reviewedAt must be a valid YYYY-MM-DD date');
 if(typeof data.sourceCommit!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(data.sourceCommit))fail('sourceCommit must be a full Git commit hash');
 if(!Array.isArray(data.phases)||!data.phases.length)fail('phases must be nonempty');
 if(!Array.isArray(data.tasks)||!data.tasks.length)fail('tasks must be nonempty');
 const phases=new Set(),tasks=new Map(),issueURLs=new Set();
 for(const phase of data.phases){
  record(phase,['id','title','outcome'],'phase');
  for(const key of ['id','title','outcome'])if(!nonempty(phase[key]))fail(`phase.${key} must be nonempty`);
  if(phases.has(phase.id))fail(`Duplicate phase: ${phase.id}`);
  phases.add(phase.id);
 }
 for(const task of data.tasks){
  record(task,taskFields,'task');
  if(typeof task.id!=='string'||!/^WH-\d{3,}$/.test(task.id))fail('Task id must use WH-001 format');
  const label=task.id;
  if(tasks.has(task.id))fail(`Duplicate task: ${task.id}`);
  tasks.set(task.id,task);
  for(const key of ['title','outcome'])if(!nonempty(task[key]))fail(`${label}.${key} must be nonempty`);
  if(!phases.has(task.phase))fail(`${label}: unknown phase ${task.phase}`);
  oneOf(task.priority,priorities,`${label}.priority`);
  oneOf(task.readiness,['ready','planned','blocked','deferred'],`${label}.readiness`);
  oneOf(task.kind,['implementation','verification','decision','release'],`${label}.kind`);
  oneOf(task.size,['S','M','L'],`${label}.size`);
  for(const key of ['scope','acceptance','verification','references'])strings(task[key],`${label}.${key}`,true);
  for(const key of ['dependsOn','blockers','evidence'])strings(task[key],`${label}.${key}`);
  for(const key of ['issue','owner'])if(task[key]!==null&&!nonempty(task[key]))fail(`${label}.${key} must be null or a nonempty string`);
  if(task.issue!==null){
   if(!/^https:\/\/github\.com\/zemdregon\/whumpo\/issues\/[1-9]\d*$/.test(task.issue))fail(`${label}: issue must be a Whumpo GitHub issue URL`);
   if(issueURLs.has(task.issue))fail(`${label}: duplicate issue mapping ${task.issue}`);
   issueURLs.add(task.issue);
  }
  if(task.readiness==='ready'&&task.blockers.length)fail(`${label}: ready tasks cannot have blockers`);
  if(task.readiness==='blocked'&&!task.blockers.length)fail(`${label}: blocked tasks need a concrete blocker`);
  for(const reference of task.references){
   if(isAbsolute(reference)||reference.includes('\\')||reference.split('/').some(part=>part==='..'||part===''))fail(`${label}: reference must be a repository-relative path: ${reference}`);
   const path=resolve(root,reference);
   if(!inside(path))fail(`${label}: reference escapes repository: ${reference}`);
   try{await stat(path);if(!inside(await realpath(path)))fail(`${label}: reference symlink escapes repository: ${reference}`);}
   catch(error){if(error.code==='ENOENT')fail(`${label}: reference does not exist: ${reference}`);throw error;}
  }
 }
 for(const task of data.tasks)for(const dependency of task.dependsOn){
  if(!tasks.has(dependency))fail(`${task.id}: unknown dependency ${dependency}`);
  if(dependency===task.id)fail(`${task.id}: cannot depend on itself`);
 }
 const visited=new Set(),visiting=new Set();
 function visit(id,path=[]){
  if(visiting.has(id))fail(`Dependency cycle: ${[...path,id].join(' -> ')}`);
  if(visited.has(id))return;
  visiting.add(id);
  for(const dependency of tasks.get(id).dependsOn)visit(dependency,[...path,id]);
  visiting.delete(id);visited.add(id);
 }
 for(const task of data.tasks)visit(task.id);
 return data;
}

// Architectural handoffs are paths, not a requirement to repeat every transitive edge.
// Keep these aligned with docs/roadmap/alignment.md when product decisions change.
export function alignmentProblems(data){
 const tasks=new Map(data.tasks.map(task=>[task.id,task])),problems=[];
 const id=number=>`WH-${String(number).padStart(3,'0')}`;
 function reaches(from,to,seen=new Set()){
  if(seen.has(from))return false;
  seen.add(from);
  return (tasks.get(from)?.dependsOn??[]).some(next=>next===to||reaches(next,to,seen));
 }
 const required={
  18:[52,117],22:[71],52:[71,113],54:[122,105,115,116],56:[52,122,105,116],
  67:[65,66,71,122,105,116],75:[52,122,113,116],77:[67,71,76],
  81:[105,113],83:[115],90:[89,113,122,54,56,...Array.from({length:13},(_,i)=>91+i)],92:[105,116],
  104:[31,32,80,90,112],106:[122,105,116],
  48:[5,17,19,117],49:[23,41,104,112],20:[121],116:[121,113,9],122:[89,113]
 };
 for(let feature=91;feature<=103;feature++)required[feature]=[122,105,116];
 // WH-068 notification children (WH-154 contract): the parent waits for its contract, connected acceptance and canary.
 required[68]=[154,159,160];
 // WH-077 portable export children (WH-186 contract): the parent waits for its contract, clean room and acceptance.
 required[77].push(186,189,191);
 // WH-061 retention children (WH-180 contract): the parent waits for every child; live custom-host acceptance stays
 // with the parent through WH-033.
 required[61]=[180,181,182,183,184];
 const forbidden={
  22:[23,41,47,49,104],42:[23,47,49,104],43:[23,47,49,104],
  48:[49,87,104,112,118],52:[12,18,36,68,69,74,86],
  56:[31,32,36,49,96,97,98,99,100,104],
  67:[70,72,77,80,104],71:[22,50,55,67,72],77:[72],
  81:[84,87,107,112],90:[42,49,104],105:[106,107,109,110,112],
  116:[20,106,117,118],117:[8,19,48],121:[20,21,116,117],122:[90,54,56,67,104,106],
  35:[11,12,16],36:[56,96,98]
 };
 // Notification children never reach the rule engine, Business workflows or the composed pilot; only the canary
 // (WH-160) waits for the WH-036 live sender.
 for(let child=154;child<=159;child++)forbidden[child]=[36,69,80,94];
 forbidden[160]=[69,80,94];
 // Portable export children never wait on the full MVP/paid-tier gates or optional physical databases; the
 // contract (WH-186) also stays upstream of the account export and module implementations it supports.
 for(let child=186;child<=191;child++)forbidden[child]=[49,72,104];
 forbidden[186].push(18,67);
 // Retention children never wait on custom-domain hosting acceptance, the paid launch or the cumulative launch gate.
 for(let child=180;child<=185;child++)forbidden[child]=[33,49,104];
 for(const [from,targets] of Object.entries(required))for(const to of targets){
  if(!tasks.has(id(from))||!tasks.has(id(to)))problems.push(`Missing alignment task ${id(from)} or ${id(to)}`);
  else if(!reaches(id(from),id(to)))problems.push(`${id(from)} must follow shared prerequisite ${id(to)}`);
 }
 for(const [from,targets] of Object.entries(forbidden))for(const to of targets){
  if(!tasks.has(id(from))||!tasks.has(id(to)))problems.push(`Missing alignment task ${id(from)} or ${id(to)}`);
  else if(reaches(id(from),id(to)))problems.push(`${id(from)} must remain independent of downstream/optional gate ${id(to)}`);
 }
 return problems;
}

const text=value=>value.replace(/([\\`*_[\]<>])/g,'\\$1').replace(/\r?\n/g,' ');
const bullets=(values,empty='None recorded.')=>values.length?values.map(value=>`- ${value}`).join('\n'):empty;
const ordered=tasks=>[...tasks].sort((a,b)=>priorities.indexOf(a.priority)-priorities.indexOf(b.priority)||a.id.localeCompare(b.id,undefined,{numeric:true}));
const repoURL=path=>`${repository}/blob/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`;

export function taskMarkdown(data,task,{local=false}={}){
 const link=path=>local?`../../${path.split('/').map(encodeURIComponent).join('/')}`:repoURL(path);
 const phase=data.phases.find(item=>item.id===task.phase);
 return [
  `## ${text(task.id)} — ${text(task.title)}`,
  `Phase: **${text(phase.title)}** (${text(task.phase)}). Priority: **${task.priority}**. Planning readiness: **${task.readiness}**. Kind: ${task.kind}. Size: ${task.size}.`,
  `Reviewed: ${data.reviewedAt}. Source baseline: \`${data.sourceCommit}\`. This is a planning snapshot, not current execution or deployment status.`,
  `Follow the [agent execution contract](${link('docs/roadmap/execution.md')}) and [canonical backlog](${link('docs/roadmap/backlog.json')}). Re-read the current feature contracts before work.`,
  '### Outcome',task.outcome,
  '### Scope',bullets(task.scope),
  '### Acceptance criteria',task.acceptance.map(value=>`- [ ] ${value}`).join('\n'),
  '### Verification',bullets(task.verification),
  '### Dependencies and blockers',
  `Planning dependencies: ${task.dependsOn.length?task.dependsOn.join(', '):'None'}. Verify completion in current issue evidence before execution; ordering is not proof of completion.`,
  bullets(task.blockers,'No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.'),
  '### References',bullets(task.references.map(path=>`[${text(path)}](${link(path)})`)),
  '### Execution coordination',
  `Issue: ${task.issue??'Not created'}. Planning owner: ${task.owner??'Unassigned'}. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.`,
  '### Evidence',bullets(task.evidence,'No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.'),
 ].join('\n\n')+'\n';
}

export function renderRoadmap(data){
 const lines=[
  '# Whumpo implementation backlog',
  '> Generated from `backlog.json` by `node tools/roadmap.mjs render`. Edit the JSON source, then render again.',
  `Reviewed ${data.reviewedAt} against source \`${data.sourceCommit}\`. ${data.tasks.length} planned tasks.`,
  'Planning readiness and dependencies describe the plan. Current execution, claims, blockers, and completion evidence live in GitHub Issues. A ready task is only a candidate: verify live dependency completion and authorization before work.',
  'Read the [execution contract](execution.md). Use `node tools/roadmap.mjs next` for candidates and `node tools/roadmap.mjs show WH-001` for an issue body.',
 ];
 for(const phase of data.phases){
  lines.push(`# ${text(phase.id)} — ${text(phase.title)}`,phase.outcome);
  for(const task of ordered(data.tasks.filter(item=>item.phase===phase.id)))lines.push(taskMarkdown(data,task,{local:true}).trimEnd());
 }
 return lines.join('\n\n')+'\n';
}

async function main(args){
 const [command,...rest]=args;
 if(!command||command==='--help'||command==='help'){
  console.log('Usage: node tools/roadmap.mjs validate | alignment | next | show WH-001 | render [--check]\nOnly render without --check writes a file. No command reads live issue state or calls external APIs.');return;
 }
 if(!['validate','alignment','next','show','render'].includes(command)||(command==='show'?rest.length!==1:command==='render'?rest.length>1||(rest.length===1&&rest[0]!=='--check'):rest.length!==0))fail('Invalid command. Run node tools/roadmap.mjs --help');
 let data;
 try{data=JSON.parse(await readFile(sourcePath,'utf8'));}
 catch(error){if(error.code==='ENOENT')fail('Missing docs/roadmap/backlog.json; create the canonical backlog first.');throw error;}
 await validateRoadmap(data);
 if(command==='validate'){console.log(`Valid roadmap: ${data.tasks.length} tasks, ${data.phases.length} phases; dependencies are acyclic and references exist.`);return;}
 if(command==='alignment'){
  const problems=alignmentProblems(data);if(problems.length)fail(`Alignment conflicts:\n${problems.join('\n')}`);
  console.log('Roadmap alignment passed: shared contract paths and independent implementation/launch lanes preserved. No live execution state read.');return;
 }
 if(command==='show'){
  const task=data.tasks.find(item=>item.id===rest[0]);if(!task)fail(`Unknown task: ${rest[0]}`);
  process.stdout.write(taskMarkdown(data,task));return;
 }
 if(command==='next'){
  console.log('Ready planning candidates only. Check live issue state/claims and completion evidence for every dependency before execution. No external state was read.');
  const candidates=ordered(data.tasks.filter(task=>task.readiness==='ready'));
  if(!candidates.length)console.log('No ready candidates. Resolve a recorded blocker or refine a planned task.');
  for(const task of candidates)console.log(`${task.priority} ${task.id} ${task.title}\n  ${task.dependsOn.length?`Verify prerequisites: ${task.dependsOn.join(', ')}`:'Planning root; still requires live coordination.'} | ${task.issue??'No issue linked'}`);
  return;
 }
 const rendered=renderRoadmap(data);
 if(rest[0]==='--check'){
  let current;try{current=await readFile(outputPath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(current!==rendered)fail('docs/roadmap/backlog.md is missing or stale. Run node tools/roadmap.mjs render');
  console.log('Generated backlog is current.');return;
 }
 await writeFile(outputPath,rendered,'utf8');console.log('Rendered docs/roadmap/backlog.md');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(error=>{console.error(`Roadmap: ${error.message}`);process.exitCode=1;});
