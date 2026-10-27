import {createHash,randomUUID} from 'node:crypto';
import {lstat,readdir,readFile,writeFile,mkdir,rename,copyFile,open} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {assertArtifactPath} from './artifact-protection.mjs';

export const workerOrder=['runtime','apps','sites','platform'];
export const configFiles={runtime:'wrangler.runtime.jsonc',apps:'wrangler.apps.jsonc',sites:'wrangler.sites.jsonc',platform:'wrangler.jsonc'};
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Archives contain only explicitly selected inputs. Never recurse into the
// workspace's .secrets, dependency tree, customer exports or local databases.
export async function fileInventory(directory,prefix=''){
 const root=await lstat(directory);
 if(!root.isDirectory()||root.isSymbolicLink())throw Error('Release directory must be a real directory');
 const result=[];
 for(const name of (await readdir(directory)).sort()){
  const path=join(directory,name),entry=await lstat(path),relative=prefix+name;
  assertArtifactPath(relative);
  if(entry.isSymbolicLink())throw Error('Release artifacts cannot contain symlinks');
  if(entry.isDirectory())result.push(...await fileInventory(path,relative+'/'));
  else if(entry.isFile())result.push({path:relative,bytes:entry.size,sha256:digest(await readFile(path))});
  else throw Error('Unsupported release artifact');
 }
 return result;
}
export async function copyTree(source,target){
 const before=await fileInventory(source);
 await mkdir(target,{recursive:true,mode:0o700});
 for(const file of before){await mkdir(dirname(join(target,file.path)),{recursive:true,mode:0o700});await copyFile(join(source,file.path),join(target,file.path));}
 if(!same(before,await fileInventory(source))||!same(before,await fileInventory(target)))throw Error('Release inputs changed while copying');
 return before;
}
export async function atomicJSON(path,value){
 const temporary=path+'.'+randomUUID()+'.tmp';
 const handle=await open(temporary,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 await rename(temporary,path);
 const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
}
export async function readJSON(path){
 const text=await readFile(path,'utf8');
 try{return JSON.parse(text);}catch{throw Error('Invalid JSON document; inspect the private file locally');}
}

// A current release accepts one exact schema, or initializes a distinct empty
// database. Numbered SQL replay and in-place account conversion are unsupported.
export function validateCompatibility(plan,schema){
 if(!plan||plan.version!==3||plan.environment!=='test'||plan.mixedWorkersCompatible!==true||typeof plan.review!=='string'||!plan.review.trim())throw Error('A current test-release and mixed-Worker review is required');
 if(['migrations','previousWorkersCompatible','restoreReview','restoreEvidence'].some(k=>Object.hasOwn(plan,k)))throw Error('Retired release compatibility fields are not supported');
 if(plan.schemaSha256!==schema.sqlSha256)throw Error('Release review must pin the complete current schema');
 if(!['none','initialize'].includes(schema.mode)||plan.schemaChange!==schema.mode)throw Error('Invalid schema change classification');
 if(schema.mode==='initialize'&&(plan.testDataResetAuthorized!==true||typeof plan.cutoverReview!=='string'||!plan.cutoverReview.trim()))throw Error('Empty-database initialization requires data-reset authorization and a current cutover review');
 return plan;
}

export async function sealRelease(directory,manifest){
 const files=await fileInventory(join(directory,'payload'));
 const result={...manifest,format:2,files,payloadDigest:digest(JSON.stringify(files))};
 const text=JSON.stringify(result,null,2)+'\n';
 await writeFile(join(directory,'manifest.json'),text,{flag:'wx',mode:0o600});
 await writeFile(join(directory,'manifest.sha256'),digest(text)+'\n',{flag:'wx',mode:0o600});
 return result;
}
export async function verifyRelease(directory){
 const text=await readFile(join(directory,'manifest.json'),'utf8');
 if(digest(text)!==(await readFile(join(directory,'manifest.sha256'),'utf8')).trim())throw Error('Release manifest changed');
 const manifest=JSON.parse(text);
 if(manifest.format!==2||!same(manifest.order,workerOrder)||!same(manifest.files,await fileInventory(join(directory,'payload')))||manifest.payloadDigest!==digest(JSON.stringify(manifest.files)))throw Error('Release artifact mismatch');
 if(manifest.compatibility?.buildInputs!==manifest.build?.inputs?.sha256)throw Error('Compatibility review does not match the archived build');
 for(const role of workerOrder)if(!manifest.workers?.[role]?.tag||!manifest.before?.workers?.[role]?.id)throw Error('Incomplete four-Worker manifest');
 validateCompatibility(manifest.compatibility,manifest.schema);
 if(digest(await readFile(join(directory,'payload/schema/current.sql')))!==manifest.schema.sqlSha256)throw Error('Archived schema differs from the reviewed schema');
 return manifest;
}

export function newJournal(manifest){
 return {release:manifest.id,manifestDigest:digest(JSON.stringify(manifest)),status:'prepared',steps:Object.fromEntries(['schema',...workerOrder].map(key=>[key,{status:'pending'}]))};
}

export function assertWorker(manifest,role,worker){
 if(!worker||worker.tag!==manifest.workers[role].tag)throw Error('Candidate Worker version was not confirmed');
 const expected=manifest.workers[role];
 if(!same(worker.services,expected.services))throw Error('Worker service bindings changed');
 if(!same(worker.databases,expected.databases))throw Error('Worker database bindings changed');
 for(const name of manifest.before.workers[role].secrets)if(!worker.secrets.includes(name))throw Error('Worker lost a required secret binding');
 if(role==='platform'&&manifest.cms.some(c=>['verified','connected'].includes(c.deployment_state))&&!worker.secrets.includes('CMS_BRIDGE_MASTER_KEY'))throw Error('CMS master secret binding missing');
}

// A running/unknown operation is never made pending on a read timeout or because
// the old version is still visible. Only positive remote evidence can settle it.
export function reconcileRelease(manifest,journal,observed){
 if(journal.release!==manifest.id||journal.manifestDigest!==digest(JSON.stringify(manifest)))throw Error('Journal belongs to another release');
 if(!same(manifest.cms,observed.cms))throw Error('CMS registrations changed; reconcile before continuing');
 const state=journal.steps.schema;
 if(state.status==='pending'){
  if(!same(observed.schema,manifest.schema.before))throw Error('Remote schema changed before release');
 }else if(state.operationConfirmed!==true)throw Error('Schema command outcome is unresolved; inspect the operation before continuing');
 else if(same(observed.schema,manifest.schema.expected))state.status='confirmed';
 else if(state.status==='confirmed')throw Error('Applied schema drifted');
 else throw Error('Schema initialization outcome is unresolved; inspect the actual schema and private logs');
 for(const role of workerOrder){
  const step=journal.steps[role],live=observed.workers[role];
  if(step.status==='pending'){
   if(!same(live,manifest.before.workers[role]))throw Error('Worker changed outside this release');
  }else{
   if(step.operationConfirmed!==true)throw Error('Worker command outcome is unresolved; an active version alone does not prove routing/settings completed');
   assertWorker(manifest,role,live);
   if(step.versionId&&step.versionId!==live.id)throw Error('Confirmed Worker version drifted');
   step.status='confirmed';step.versionId=live.id;
  }
 }
 return journal;
}

// Read-only status text. A fully confirmed, deployed journal whose live tags moved on was
// superseded by a later release (e.g. the CI redeploy); anything else keeps the strict error.
export function statusReconciliation(manifest,journal,observed){
 try{reconcileRelease(manifest,structuredClone(journal),observed);return 'ready';}catch(error){
  const done=journal.status==='deployed'&&Object.values(journal.steps).every(step=>step.status==='confirmed');
  const moved=workerOrder.filter(role=>observed.workers[role]?.tag!==manifest.workers[role].tag);
  if(error.message!=='Candidate Worker version was not confirmed'||!done||!moved.length)return error.message;
  return {result:'superseded by a later release',live:Object.fromEntries(workerOrder.map(role=>[role,{id:observed.workers[role]?.id,tag:observed.workers[role]?.tag}]))};
 }
}

export async function applyRelease(directory,driver){
 const manifest=await verifyRelease(directory);
 await driver.verifyToolchain(manifest,directory);
 const journalPath=join(directory,'journal.json');
 return driver.withLock(manifest,async guard=>{
  let journal;try{journal=await readJSON(journalPath);}catch(e){if(e.code!=='ENOENT')throw e;journal=newJournal(manifest);}
  journal=reconcileRelease(manifest,journal,await driver.observe(manifest));
  const save=()=>atomicJSON(journalPath,journal);
  await save();
  for(const role of ['schema',...workerOrder]){
   if(journal.steps[role].status==='confirmed')continue;
   await guard();await verifyRelease(directory);
   reconcileRelease(manifest,journal,await driver.observe(manifest));
   // Persist intent before the first possible external side effect.
   journal.status='applying';journal.steps[role]={status:'running',startedAt:new Date().toISOString()};await save();
   try{
    if(role==='schema'){
     if(manifest.schema.mode==='initialize')await driver.initialize(manifest,directory);
     journal.steps.schema.operationConfirmed=true;await save();
    }else await driver.deploy(role,manifest,directory,guard,async()=>{journal.steps[role].operationConfirmed=true;await save();});
    await guard();
    reconcileRelease(manifest,journal,await driver.observe(manifest));
    journal.steps[role].finishedAt=new Date().toISOString();await save();
   }catch{
    journal.status='needs-reconciliation';journal.steps[role].status='unknown';await save();
    throw Error('Release stopped at '+role+'. Inspect its journal and live status; do not repeat an uncertain operation.');
   }
  }
  // This confirms deployment identities, not application or customer acceptance.
  journal.status='deployed';journal.finishedAt=new Date().toISOString();await save();return journal;
 });
}
