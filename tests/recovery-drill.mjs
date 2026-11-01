// WH-008 isolated local disaster-recovery drill. Synthetic data only: the source
// platform uses the actual D1 query adapter over SQLite, recovery targets are empty
// local D1/R2 resources (Miniflare) and programs run in actual workerd/QuickJS.
// No remote Cloudflare access, provider dispatch, public listener, customer traffic
// or key retirement. Local timings are not a forecast of Cloudflare restore time.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,rm,readdir,writeFile,readFile,rename,cp,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {sqliteD1,sqliteD1Adapter} from './sqlite-d1.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,enableFixtureVisitorAccess,fixtureVisitorSQL} from './current-site-fixture.mjs';
import {createRestoreInventory,openRestoreInventory} from '../tools/restore-inventory.mjs';
import {inspectIsolatedRestore} from '../tools/restore-admission.mjs';
import {restoreCapturedCMSDatabase,captureCMSDatabase} from '../tools/cms-database-snapshot.mjs';
import {captureRecoveryPoint,verifyRecoveryPoint,openArchivedControl,restoreControlD1,restoreObjects,restoreWorkerArtifact,isolatedObjects,reconcileArtifacts,reconcileRestoreSuppressions,restoreDiscrepancies,recoveryCoverage,inventoryKeyVersions,inventoryCutovers,DrillHold} from '../tools/recovery-drill.mjs';

import {build} from 'esbuild';
Error.stackTraceLimit=0;
const suppression=await import('data:text/javascript;base64,'+Buffer.from((await build({stdin:{contents:"export * from './src/restore-suppression.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false})).outputFiles[0].text).toString('base64'));
const id=()=>crypto.randomUUID(),hash=v=>createHash('sha256').update(v).digest('hex');
const directory=await mkdtemp('/tmp/whumpo-recovery-drill-'),phases={},holds={};let refusals=0;
const phase=async(name,work)=>{const start=performance.now();try{return await work();}finally{phases[name]=Math.round((performance.now()-start)*10)/10;console.error(`drill phase ${name}: ${phases[name]} ms`);}};
const drillHold=async(work,code)=>{await assert.rejects(work,e=>e instanceof DrillHold&&e.code===code,code);refusals++;};
const closers=[];let summaryExtra,fixture,isolated,sourceRuntime,restoredRuntime;
const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
const workerd=async dir=>new Miniflare(convertV4MiniflareOptions({modulesRoot:dir,modules:[{type:'ESModule',path:dir+'/worker.js'},...(await readdir(dir)).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/'+p}))],compatibilityDate:'2026-09-29'}));
const lane=()=>hash(id());
async function execute(runtime,source,input){const r=await runtime.dispatchFetch('http://runtime/execute',{method:'POST',headers:{'x-whumpo-lane':lane()},body:JSON.stringify({version:1,source,input})});assert.equal(r.status,200);return r.json();}
const network=globalThis.fetch,independentEvidenceRetries=[];
async function retryIndependentEvidence(run){for(let attempt=1;;attempt++){const result=await run();if(result.holds[0]!=='independent-evidence'||attempt===3)return result;independentEvidenceRetries.push(attempt);}}
try{
 // ---- Source platform: complete current schema in local D1 + private local R2.
 // The source platform uses the actual D1 query adapter over SQLite, like the
 // restore-inventory suites: its full observations must fit the inventory's fixed
 // ten-second evidence deadline. Private object bodies sit in a separate store.
 fixture=await phase('setupSource',()=>sqliteD1());const {db}=fixture,bodies=new Map();
 const files={get:async key=>{const b=bodies.get(key);return b?{size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer}:null;},put:async(key,value)=>{bodies.set(key,Buffer.from(value));},delete:async key=>{bodies.delete(key);}};
 const build=join(directory,'build'),runtimeBuild=join(build,'runtime');await mkdir(build,{mode:0o700});
 await phase('buildRuntimeArtifact',async()=>execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',runtimeBuild],{stdio:'pipe',maxBuffer:16*1024*1024}));
 sourceRuntime=await workerd(runtimeBuild);let executions=0;
 // Direct handler calls bypass the platform's per-project lane wrapper; supply an opaque lane.
 const runtimeService={fetch:(url,init={})=>{executions++;const headers=new Headers(init.headers);if(!headers.has('x-whumpo-lane'))headers.set('x-whumpo-lane',lane());return sourceRuntime.dispatchFetch(url,{...init,headers});}};
 // Isolated targets: a separate Wrangler state directory with EMPTY D1 databases
 // and buckets. No routes, service bindings or schema are configured for them.
 const isolatedConfig=join(directory,'isolated.json');
 await writeFile(isolatedConfig,JSON.stringify({name:'whumpo-recovery-drill-isolated',compatibility_date:'2026-09-29',d1_databases:['A','B'].map((n,i)=>({binding:'DRILL_'+n,database_name:'drill-'+n.toLowerCase(),database_id:`${i+3}${i+3}${i+3}${i+3}${i+3}${i+3}${i+3}${i+3}-0000-4000-8000-000000000000`})),r2_buckets:['A','B'].map(n=>({binding:'OBJECTS_'+n,bucket_name:'drill-objects-'+n.toLowerCase()}))}));
 const {getPlatformProxy}=await import('wrangler');isolated=await getPlatformProxy({configPath:isolatedConfig,persist:{path:join(directory,'isolated-state')},remoteBindings:false});
 const target=isolated.env;
 globalThis.fetch=()=>assert.fail('The recovery drill must not dispatch to any real provider');

 const m=await phase('bundleHandlers',()=>currentSiteFixtureHandlers()),keyring=fixtureKeyring(),canary='PRIVATE_RECOVERY_DRILL_CANARY';
 await initializeFixtureKeys(db,keyring);const owner=await workspaceFixture(db,m),scope=await owner.scope();
 const {project:site,version:siteVersion}=await createFixtureProject(scope,owner.account,'Recovered garden','Synthetic recovery drill website');
 let revision=(await m.readChat(scope,owner.account)).state.revision,review=id();
 assert.equal((await m.sendChat(scope,owner.account,{id:review,revision,content:'/publish '+siteVersion})).status,200);
 revision=(await m.readChat(scope,owner.account)).state.revision;
 assert.equal((await m.sendChatControl(scope,owner.account,{id:id(),revision,action:{type:'confirm',kind:'site',reviewId:review}})).status,200);
 for(const provider of ['github','cloudflare'])for(const purpose of ['token','pkce']){
  const record=id(),cipher=await fixtureCiphertext(keyring,`whumpo:${provider}:${purpose}:${owner.account}:${record}`,canary);
  if(purpose==='pkce')await db.prepare(`INSERT INTO ${provider}_oauth_states(user_id,state_hash,authority_id,verifier_ciphertext,expires_at) VALUES(?,?,?,?,'2099-01-01')`).bind(owner.account,record,owner.authority,cipher).run();
  else if(provider==='github')await db.prepare("INSERT INTO github_token_vault VALUES(?,?,?,'2099-01-01','revoking')").bind(record,owner.account,cipher).run();
  else await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,'2099-01-01','2026-10-08','revoking')").bind(record,owner.account,cipher).run();
 }
 const objectRow=async(project,name,bytes)=>{const key='private-drill/'+id();await files.put(key,bytes);await db.prepare("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,?,?,?,?,1,1,'pending',?)").bind(id(),project,name,key,hash(bytes),bytes.length,new Date().toISOString()).run();return key;};
 const objectKeys=[await objectRow(site,'Garden plan',Buffer.from('Synthetic private garden plan '+canary)),await objectRow(site,'Planting notes',Buffer.from('Synthetic private planting notes'))];
 // Visitor application: actual owner handlers and actual QuickJS transitions.
 const app=id(),program=id(),test=id(),appReview=id(),page=id(),now=new Date().toISOString();
 const source='export default ({state,input})=>({state:{note:input.note,edits:(state.edits??0)+1},result:"Saved"})';
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Recovered notebook','Synthetic recovery drill application','draft',?,?)").bind(app,owner.account,now,now).run();
 await m.backend.saveBackend(scope,owner.account,app,program,source);await m.backend.testBackend(scope,runtimeService,owner.account,app,program,test,{state:{},input:{note:'test'}});
 await enableFixtureVisitorAccess(scope,owner.account,app,{handlers:m});
 await m.appActivation.prepareApplication(scope,owner.account,app,appReview,'enable',program,test);await m.appActivation.confirmApplication(scope,owner.account,appReview);
 await m.appPages.prepareAppPage(scope,owner.account,app,page,{title:'Recovered notebook',description:'Synthetic recovery drill',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]});await m.appPages.confirmAppPage(scope,owner.account,page);
 const visitors=[];
 for(const note of ['first visitor note','second visitor note']){const who=id();await db.prepare(fixtureVisitorSQL).bind(who,app,app).run();const session=await m.appData.issueAppSession(db,who);const r=await m.appData.transitionAppData(db,runtimeService,session,app,id(),0,{note});assert.equal(r.state,'complete');visitors.push({who,session});}
 assert.ok(executions>=3,'Fixture writes used actual QuickJS executions');
 // ---- WH-008 refresh: one synthetic row in each table added since the October 8 drill. Real triggers stay on.
 const ms=Date.now(),iso=new Date(ms).toISOString(),seeded={};
 {
  const run=(sql,...v)=>db.prepare(sql).bind(...v).run();
  const costKey=hash('drill-cost');
  await run("INSERT INTO cost_events(idempotency_key,revision,source,dimension,scope,owner_id,project_id,workload,work_class,outcome,quantity_value,cost_basis,cost_micros,occurred_at,observed_at,event_json) VALUES(?,1,'inference-receipt','input-tokens','tenant',?,?,'drill-work','task','settled',10,'receipt',5,?,?,?)",costKey,owner.account,site,iso,iso,JSON.stringify({contractVersion:1,customerUnits:0,idempotencyKey:costKey,revision:1}));
  const reviewed=id();
  await run("INSERT INTO directory_reviews(id,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at,status) VALUES(?,?,?,'edit','[]',?,0,0,?,'applied')",reviewed,owner.account,site,hash('directory'),iso);
  await run("INSERT INTO review_receipts(family,id,owner_user_id,project_id,kind,target,outcome,payload_digest,request_hash,applied_at,lifecycle_class,sealed_at,seal) VALUES('directory_reviews',?,?,?,'change',?,'applied',?,?,?,'directories',?,?)",reviewed,owner.account,site,site,hash('directory'),hash('request'),iso,iso,hash('seal'));
  await run("INSERT INTO lookup_consents(consent_id,owner_id,provider,operation_id,credential_id,params_digest,destination,created_at,expires_at,state,revision) VALUES(?,?,'gmail','messages.search','cred-drill',?,'owner-panel',?,?,'issued',1)",id(),owner.account,hash('params'),ms,ms+600000);
  const receipt=id();
  await run("INSERT INTO connector_receipts(receipt_id,owner_id,provider,operation_id,authority,credential_id,provider_account_id,destination_id,operation_digest,request_digest,review_digest,price_units,price_basis,state,created_at,expires_at,updated_at,revision) VALUES(?,?,'hubspot','contacts.note','owner-request','cred-drill','acct-drill','dest-drill',?,?,?,0,'plan-inclusion','review',?,?,?,1)",receipt,owner.account,hash('op'),hash('req'),hash('rev'),ms,ms+600000,ms);
  await run("INSERT INTO rule_approvals(approval_id,owner_id,rule_id,rule_revision,provider,operation_id,destination_digest,template_digest,credential_id,max_per_period,period_start,used_count,created_at,revision) VALUES(?,?,'rule-drill',1,'gmail','messages.send',?,?,'cred-drill',5,0,0,?,1)",id(),owner.account,hash('dest'),hash('tpl'),ms);
  await run("INSERT INTO account_closures(closure_id,account_id,state,revision,requested_at,updated_at,history) VALUES(?,?,'requested',1,?,?,'[\"requested\"]')",id(),'closing-'+id(),ms,ms);
  await run("INSERT INTO owner_email_change_limits(kind,account_id,at) VALUES('request',?,?)",owner.account,ms);
  await run("INSERT INTO owner_email_change_limits(kind,address_key,at) VALUES('send',?,?)",hash('new@example.test'),ms);
  await run("INSERT INTO owner_email_changes(change_id,account_id,request_id,request_hash,new_address,new_address_hash,epoch,created_at,expires_at,state,revision,history,deliverable) VALUES(?,?,?,?,'new@example.test',?,1,?,?,'pending',1,'[\"pending\"]',1)",id(),owner.account,id(),hash('email-request'),hash('new@example.test'),ms,ms+3600000);
  await run("INSERT INTO owner_security_reviews(review_id,account_id,epoch,credential_revision,kit_generation,credentials,connections,created_at,expires_at,state,revision) SELECT ?,account_id,auth_epoch,credential_revision,kit_generation,'[]','[]',?,?,'open',1 FROM identity_accounts WHERE account_id=?",id(),ms,ms+600000,owner.account);
  // WH-052 P-2 job journal: one job through admission, claim, intent and result, so its job, four events and outbox entry are archived and restored.
  const job=id(),jobEnvelope=JSON.stringify({jobId:job,limits:{maxAttempts:3},ownerAccountId:owner.account,purpose:'platform-email',schedule:{createdAt:0,expiresAt:604800000,notBefore:0}});
  await run("INSERT INTO job_journal(id,owner_user_id,purpose,envelope_json,envelope_digest,created_at,expires_at,max_attempts,due,initial_due,last_event,last_at) VALUES(?,?,'platform-email',?,?,0,604800000,3,0,0,'enqueued',0)",job,owner.account,jobEnvelope,hash('job-envelope'));
  await run("UPDATE job_journal SET state='leased',fence=1,lease_until=60000,last_event='claimed',last_at=0 WHERE id=?",job);
  await run("UPDATE job_journal SET state='awaiting',attempt=1,attempt_id=id||'.1',last_event='intent',last_at=1,last_ref=id||'.1' WHERE id=?",job);
  await run("UPDATE job_journal SET state='complete',result_ref='drill-result',lease_until=0,last_event='external_result',last_at=2,last_ref='drill-result' WHERE id=?",job);
  // WH-156 shared outbox (schema batch 3e): a counted provider call whose reply was lost. The journal holds the attempt as uncertain and the trigger moves
  // the notice to unknown-outcome with its 72-hour reconciliation bound; a restore never redispatches it. The ledger row is the 1970-01-01 day of the synthetic clock.
  const noticeJob=id(),noticeId=id();
  await run("INSERT INTO notification_send_ledger(provider,day,sends,ceiling) VALUES('cloudflare-email','1970-01-01',0,14285)");
  await run("INSERT INTO job_journal(id,owner_user_id,purpose,envelope_json,envelope_digest,created_at,expires_at,max_attempts,due,initial_due,last_event,last_at) VALUES(?,?,'platform-email',?,?,1000,604800000,1,1000,1000,'enqueued',1000)",noticeJob,owner.account,JSON.stringify({jobId:noticeJob,limits:{maxAttempts:1},ownerAccountId:owner.account,purpose:'platform-email',schedule:{createdAt:1000,expiresAt:604800000,notBefore:1000}}),hash('notice-envelope'));
  await run("INSERT INTO notification_notices(id,user_id,scope,recipient_key,template,event_ref,created_at,expires_at) VALUES(?,?,'account-email',?,'account.passkey-added@1','drill-notice',1000,86401000)",noticeId,owner.account,'account-email:'+owner.account);
  await run('UPDATE notification_notices SET job_id=? WHERE id=?',noticeJob,noticeId);
  await run("UPDATE job_journal SET state='leased',fence=1,lease_until=61000,last_event='claimed',last_at=1001 WHERE id=?",noticeJob);
  await run("UPDATE job_journal SET state='awaiting',attempt=1,attempt_id=id||'.1',last_event='intent',last_at=1002,last_ref=id||'.1' WHERE id=?",noticeJob);
  await run("UPDATE notification_notices SET state='dispatching',attempts=1,dispatched_at=1002 WHERE id=?",noticeId);
  await run("UPDATE job_journal SET state='uncertain',last_event='uncertain',last_at=61002,last_ref=NULL WHERE id=?",noticeJob);
  assert.equal((await db.prepare('SELECT state FROM notification_notices WHERE id=?').bind(noticeId).first()).state,'unknown-outcome');
  // WH-127 form attachments (schema batch 3b): a records form with an upload collection, one visitor record and its attached upload,
  // so the link, the record, the event, the upload and its photo row are archived and restored. Registry rows are written directly (the
  // reviewed activation path is tests/form-attachments.mjs); every admission trigger stays on.
  {
   const at=Math.floor(ms/1000),recordsInstance=id(),filesInstance=id(),entry=id(),file=id(),request=id(),visitor=visitors[0].who,key=`photos/${app}/${file}.jpg`,bytes=Buffer.from('Synthetic drill attachment');
   const instance=(resource,local,kind,config,dependencies)=>run("INSERT INTO module_instances(id,project_id,local_id,kind,module_digest,schema_digest,config_json,config_digest,descriptor_json,descriptor_digest,dependencies_json,config_revision,source_version_id,source_spec_digest,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'{}',?,?,1,?,?,?,?)",
    resource,app,local,kind,hash('module'),hash('schema'),JSON.stringify(config),hash(JSON.stringify(config)),hash('descriptor'),JSON.stringify(dependencies),id(),hash('spec'),at,at);
   await instance(filesInstance,'media','files',{collections:[{id:'mine',read:'submitter',upload:['visitor'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:null}]},[]);
   await instance(recordsInstance,'requests','records',{retentionDays:30,schemas:[{id:'request',fieldsRevision:1,fields:[],staffWrite:[]}],forms:[{id:'photo-form',recordId:'request',submit:'visitor',uploadCollectionId:'mine'}],views:[]},[filesInstance]);
   for(const resource of [filesInstance,recordsInstance])await run("INSERT INTO module_activations(instance_id,state,revision,review_id,descriptor_digest,config_revision,updated_at) VALUES(?,'active',1,?,?,1,?)",resource,id(),hash('descriptor'),at);
   await files.put(key,bytes);objectKeys.push(key);
   await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at,handoff_json) VALUES(?,?,'Visitor upload drill',?,?,?,1,1,'ready',?,'null')",file,app,key,hash(bytes),bytes.length,iso);
   await run("INSERT INTO module_files(file_id,instance_id,project_id,collection_id,uploader_kind,visitor_id,request_id,created_at) VALUES(?,?,?,'mine','visitor',?,?,?)",file,filesInstance,app,visitor,id(),at);
   await run("INSERT INTO module_records(id,instance_id,project_id,schema_id,form_id,fields_revision,submitter_kind,visitor_id,values_json,revision,created_request_id,last_request_id,created_at,updated_at,expires_at) VALUES(?,?,?,'request','photo-form',1,'visitor',?,'{}',1,?,?,?,?,?)",entry,recordsInstance,app,visitor,request,request,at,at,at+86400*30);
   await run("INSERT INTO module_record_events(instance_id,request_id,project_id,entry_id,event,revision,created_at) VALUES(?,?,?,?,'form.accepted',1,?)",recordsInstance,request,app,entry,at);
   await run('INSERT INTO module_record_files(entry_id,file_id,instance_id,project_id,request_id) VALUES(?,?,?,?,?)',entry,file,recordsInstance,app,request);
   // WH-093 (schema batch 6): the owner's lead row over that record.
   await run("INSERT INTO module_record_leads(entry_id,instance_id,project_id,stage,note,due_date,revision,last_request_id,created_at,updated_at) VALUES(?,?,?,'contacted','Synthetic drill note','2026-11-05',1,?,?,?)",entry,recordsInstance,app,request,at,at);
   // WH-194 (schema group C2): a cancelled order (its hold was placed by the reservation and released), a registered one with its registration, attempt and event, and a draft review with the owner's registrant contact. A reserved or dispatching order is not seeded: restore admission refuses to restore one (uncertain-effect).
   for(const [label,host] of [['cancelled','drill-cancelled.example'],['registered','drill-registered.example'],['transfer','drill-transfer.example']]){
    const quote=id(),review=id(),order=id(),q=JSON.stringify({quoteId:quote,ownerId:owner.account,projectId:app,hostname:host,quotedAt:ms,expiresAt:ms+600000,contractVersion:1,operation:'register',autoRenew:false,premium:false,funding:{sourceKind:'payment-method',sourceId:'pm-drill',benefitCents:0,customerChargeCents:1300},initial:{totalCents:1300}});
    await run('INSERT INTO domain_quotes(quote_id,owner_user_id,project_id,hostname,quote_json,quote_digest,quoted_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',quote,owner.account,app,host,q,hash(q),ms,ms+600000);
    await run('INSERT INTO domain_reviews(review_id,quote_id,quote_digest,owner_user_id,project_id,project_revision,hostname,funding_source_id,consent_text_digest,created_at,expires_at) VALUES(?,?,?,?,?,1,?,?,?,?,?)',review,quote,hash(q),owner.account,app,host,'pm-drill',hash('consent'),ms,ms+300000);
    await run("INSERT INTO domain_orders(order_id,idempotency_key,review_id,quote_id,quote_digest,owner_user_id,project_id,hostname,state,history_json,consented_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'consented','[\"quoted\",\"consented\"]',?,?)",order,hash(order),review,quote,hash(q),owner.account,app,host,ms+1,ms+1);
    const move=(state,history,extra='')=>run(`UPDATE domain_orders SET state=?,history_json=?,updated_at=?,version=version+1${extra} WHERE order_id=?`,state,JSON.stringify(history),ms+2,order);
    await move('reserved',['quoted','consented','reserved']);
    if(label==='cancelled')await move('cancelled',['quoted','consented','reserved','cancelled:owner-cancelled']);
    if(label!=='cancelled'){
     await move('dispatching',['quoted','consented','reserved','dispatching'],`,attempts=1,attempt_id='${order}:a1',attempt_started_at=${ms+2}`);
     await move('registered',['quoted','consented','reserved','dispatching','registered'],`,registration_expires_at=${ms+365*86400000},charge_mismatch=0`);
     await run("INSERT INTO domain_registrar_events(event_id,order_id,attempt_id,event_type,applied,received_at) VALUES(?,?,?,'registered',1,?)",id(),order,order+':a1',ms+3);
     if(label==='registered'){
      // WH-196: a confirmed renewal opt-in (the confirmation turns auto-renew on) and the approval it covers.
      const renewal=id();
      await run('INSERT INTO domain_renewal_reviews(review_id,hostname,owner_user_id,renewal_total_cents,consent_text_digest,created_at,expires_at) VALUES(?,?,?,1400,?,?,?)',renewal,host,owner.account,hash('renewal'),ms+4,ms+300000);
      await run('UPDATE domain_renewal_reviews SET confirmed_at=? WHERE review_id=?',ms+5,renewal);
      await run('INSERT INTO domain_renewal_approvals(hostname,for_expiry,review_id,price_cents,approved_at) VALUES(?,?,?,1400,?)',host,ms+365*86400000,renewal,ms+340*86400000);
     }
     if(label==='transfer'){
      // WH-196: a settled transfer-out request (failed: the unlock was refused and the name returned to active). Open ones (requested, unknown-outcome) are refused by restore admission.
      const request=id(),at=ms+61*86400000;
      await run("INSERT INTO domain_transfer_requests(request_id,hostname,owner_user_id,state,requested_at,updated_at) VALUES(?,?,?,'requested',?,?)",request,host,owner.account,at,at);
      await run("UPDATE domain_transfer_requests SET state='failed',updated_at=?,version=1 WHERE request_id=?",at+1,request);
     }
    }
   }
   {
    const quote=id(),review=id(),host='drill-draft.example',q=JSON.stringify({quoteId:quote,ownerId:owner.account,projectId:app,hostname:host,quotedAt:ms,expiresAt:ms+600000,contractVersion:1,operation:'register',autoRenew:false,premium:false,funding:{sourceKind:'payment-method',sourceId:'pm-drill',benefitCents:0,customerChargeCents:1300},initial:{totalCents:1300}});
    await run('INSERT INTO domain_quotes(quote_id,owner_user_id,project_id,hostname,quote_json,quote_digest,quoted_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',quote,owner.account,app,host,q,hash(q),ms,ms+600000);
    await run('INSERT INTO domain_reviews(review_id,quote_id,quote_digest,owner_user_id,project_id,project_revision,hostname,funding_source_id,consent_text_digest,created_at,expires_at) VALUES(?,?,?,?,?,1,?,?,?,?,?)',review,quote,hash(q),owner.account,app,host,'pm-drill',hash('consent'),ms,ms+300000);
    await run("INSERT INTO domain_registrant_contacts(review_id,owner_user_id,contact_name,street,city,country,phone,email,created_at) VALUES(?,?,'Synthetic Owner','1 Test Street','Testville','US','+1.5550100','owner@example.test',?)",review,owner.account,ms);
   }
   // WH-157 recipients (schema batch 3c): a verified visitor notification address, a consenting record and a staff opt-in. The staff grant is
   // written directly (its reviewed Chat path is tests/shared-modules-access.mjs), so that one trigger is off for the seed and restored.
   const access=(await db.prepare('SELECT access_id FROM app_visitors WHERE id=?').bind(visitor).first()).access_id,grant=await db.prepare("SELECT sql FROM sqlite_master WHERE name='module_access_role_insert'").first(),consenting=id();
   await run("INSERT INTO module_records(id,instance_id,project_id,schema_id,form_id,fields_revision,submitter_kind,visitor_id,values_json,revision,created_request_id,last_request_id,created_at,updated_at,expires_at,receipt_consent) VALUES(?,?,?,'request','photo-form',1,'visitor',?,'{}',1,?,?,?,?,?,1)",consenting,recordsInstance,app,visitor,consenting,consenting,at,at,at+86400*30);
   await run('INSERT INTO visitor_notification_addresses(visitor_id,address) VALUES(?,?)',visitor,'drill-visitor@example.test');
   await run('UPDATE visitor_notification_addresses SET code_hash=?,code_expires_at=unixepoch()+600 WHERE visitor_id=?',hash('drill-code'),visitor);
   await run('UPDATE visitor_notification_addresses SET verified_at=unixepoch(),code_hash=NULL,code_expires_at=NULL WHERE visitor_id=?',visitor);
   await run('DROP TRIGGER module_access_role_insert');
   try{await run("INSERT INTO module_access_roles(instance_id,visitor_id,project_id,role,state,review_id,access_revision,granted_at,updated_at) VALUES(?,?,?,'staff','granted',?,1,?,?)",access,visitor,app,id(),at,at);}finally{await run(grant.sql);}
   await run('INSERT INTO staff_notification_optins(instance_id,visitor_id,opted_in_at) VALUES(?,?,?)',access,visitor,at);
   // WH-083 native handoff (schema batch 3d): a code-issued handoff bound to the owner's browser session. Hashes only; the restore grants no native session.
   await run("INSERT INTO identity_handoffs(id,browser_token_hash,purpose,state,code_challenge,redirect_uri,created_at,expires_at,account_id,source_session_id,auth_epoch,code_hash,code_issued_at,code_expires_at) VALUES(?,?,'signin',?,?,'https://whumpo.com/app/return',?,?,?,?,1,?,?,?)",id(),hash('drill-handoff-token'),'drill-state-'+'s'.repeat(20),'c'.repeat(43),at,at+300,owner.account,owner.authority,hash('drill-handoff-code'),at,at+60);
   // WH-086 push (schema batch 4): a sealed-token device on the owner's session lineage and an opaque event. A restore holds the rows but sends nothing: the device is live only with a current session.
   const pushLineage=(await db.prepare('SELECT lineage_id FROM identity_sessions WHERE id=?').bind(owner.authority).first()).lineage_id;
   await run("INSERT INTO push_devices(id,account_id,lineage_id,platform,token_hash,token_sealed,notifications_enabled,created_at,last_seen_at) VALUES(?,?,?,'android',?,?,1,?,?)",id(),owner.account,pushLineage,hash('drill-push-token'),await fixtureCiphertext(keyring,`whumpo:push:token:${owner.account}:${pushLineage}`,'drill-synthetic-fcm-token-000001'),at,at);
   await run("INSERT INTO push_events(id,account_id,kind,project_id,created_at,expires_at) VALUES(?,?,'operation_completed',?,?,?)",id(),owner.account,app,at,at+86400);
  }
  // Workspace layout cap (B11): 52 revisions leave the newest 50, and the newest receipt is never pruned.
  await run("INSERT INTO workspace_preferences(user_id,revision,layout_json,updated_at) VALUES(?,0,'{\"version\":1,\"n\":0}',?) ON CONFLICT(user_id) DO NOTHING",owner.account,iso);
  for(let n=0;n<52;n++){
   const previous=(await db.prepare('SELECT revision,layout_json FROM workspace_preferences WHERE user_id=?').bind(owner.account).first()),next=JSON.stringify({version:1,n:n+1});
   await run("INSERT INTO workspace_layout_receipts(request_id,user_id,request_hash,request_json,from_revision,to_revision,previous_json,layout_json,created_at) VALUES(?,?,?,'{}',?,?,?,?,?)",id(),owner.account,hash('layout'+n),previous.revision,previous.revision+1,previous.layout_json,next,iso);
   await run('UPDATE workspace_preferences SET revision=?,layout_json=?,updated_at=? WHERE user_id=?',previous.revision+1,next,iso,owner.account);
  }
  for(const t of ['review_receipts','cost_events','lookup_consents','connector_receipts','account_closures','rule_approvals','owner_email_changes','owner_email_change_limits','owner_security_reviews','workspace_layout_receipts','job_journal','job_journal_events','job_outbox','module_records','module_files','module_record_files','module_record_leads','domain_quotes','domain_reviews','domain_orders','domain_funding_holds','domain_registrant_contacts','domain_order_attempts','domain_registrar_events','domain_registrations','domain_renewal_reviews','domain_renewal_approvals','domain_transfer_requests','visitor_notification_addresses','staff_notification_optins','identity_handoffs','push_devices','push_events','notification_notices','notification_send_ledger'])seeded[t]=(await db.prepare(`SELECT count(*) n FROM ${t}`).first()).n;
  assert.ok(Object.values(seeded).every(n=>n>=1)&&seeded.workspace_layout_receipts===50,JSON.stringify(seeded));
 }
 const reference=async(database,runtime)=>{
  const rows=(await database.prepare('SELECT d.visitor_id,d.state_json,v.source FROM app_documents d JOIN app_visitors x ON x.id=d.visitor_id JOIN app_spaces a ON a.project_id=x.project_id JOIN backend_versions v ON v.id=a.version_id ORDER BY d.visitor_id').all()).results;
  const outputs=[];for(const row of rows)outputs.push(await execute(runtime,row.source,{state:JSON.parse(row.state_json),input:{note:'recovery probe'}}));
  return {documents:rows.length,sha256:hash(JSON.stringify(outputs))};
 };
 const before=await reference(db,sourceRuntime);assert.equal(before.documents,2);

 // ---- Independent authority and encrypted key custody, outside the data archive.
 const inventoryFile=join(directory,'operator.whumpo-restore-inventory'),streamId='recovery-drill-stream';
 await createRestoreInventory({inventoryFile,streamId});
 const inventory=await openRestoreInventory({inventoryFile,expectedStreamId:streamId,sourceDb:db});closers.push(()=>inventory.close());
 const keys=await keyBackupFixture();closers.push(()=>keys.close());const stored=await keys.create(keyring),keyBackup=stored.proof;
 await mkdir(join(directory,'points'),{mode:0o700});
 const pointA=join(directory,'points','A'),snapshotA='drill-point-a';
 const capture=await phase('captureRecoveryPoint',()=>captureRecoveryPoint({sourceDb:db,objects:files,directory:pointA,snapshotId:snapshotA,workers:{runtime:runtimeBuild}}));
 assert.equal(capture.objects,3);assert.deepEqual(capture.workers,['runtime']);
 const pointDigestA=capture.pointDigest,archived=await openArchivedControl(pointA,pointDigestA);
 const manifest=await phase('registerArchive',async()=>{try{return await inventory.registerArchive({archiveDb:archived.db,snapshotId:snapshotA,keyBackup});}finally{archived.close();}});
 const pointBytes=await readFile(join(pointA,'control.json'));
 assert.ok(!pointBytes.includes(Buffer.from(JSON.parse(keyring).keys[0].secret)),'Key material stays out of the data archive');
 assert.ok(!JSON.stringify(capture).includes(canary)&&!JSON.stringify(manifest).includes(canary));

 // ---- Loss window, then the disaster: new work after the point, every private
 // object body lost and the runtime build output gone. D1 remains readable here.
 const disasterAt=Date.now();
 await objectRow(site,'Created after the recovery point',Buffer.from('Lost synthetic upload'));
 for(const key of [...objectKeys])await files.delete(key);
 await rm(runtimeBuild,{recursive:true});

 // ---- Restore into isolated resources.
 const restoreStart=performance.now();
 await phase('verifyRecoveryPoint',()=>verifyRecoveryPoint(pointA,pointDigestA));
 // An interrupted single-batch restore leaves the target empty and can be retried.
 const failing={prepare:sql=>target.DRILL_A.prepare(sql),batch:statements=>target.DRILL_A.batch([...statements,target.DRILL_A.prepare('INSERT INTO drill_injected_failure VALUES(1)')])};
 await drillHold(()=>restoreControlD1(failing,pointA,pointDigestA),'restore-batch-failed');
 assert.equal((await target.DRILL_A.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='users'").first()).n,0,'Failed batch left no partial schema');
 const control=await phase('restoreControlD1',()=>restoreControlD1(target.DRILL_A,pointA,pointDigestA));
 assert.equal(control.digest,capture.controlDigest);
 await drillHold(()=>restoreControlD1(target.DRILL_A,pointA,pointDigestA),'restore-target-not-empty');
 // Interrupted object copy, then idempotent resume.
 let puts=0;const interrupted={list:o=>target.OBJECTS_A.list(o),get:k=>target.OBJECTS_A.get(k),put:async(k,v,o)=>{if(++puts>1)throw Error('Injected interruption');return target.OBJECTS_A.put(k,v,o);}};
 await assert.rejects(restoreObjects(interrupted,pointA,pointDigestA));
 const objects=isolatedObjects(target.OBJECTS_A),inspectOnce=(extra={})=>inspectIsolatedRestore({db:target.DRILL_A,manifest,keyBackup,evidenceSource:inventory.evidenceSource,expectedStreamId:streamId,objects,...extra});
 // The inventory's evidence reply has fixed ten-second deadlines covering two full
 // source observations. On a contended host independent-evidence holds can occur
 // from missing/unavailable/malformed evidence. Retries up to three attempts.
 const inspect=(extra={})=>retryIndependentEvidence(()=>inspectOnce(extra));
 const partial=await inspect();assert.deepEqual(partial.holds,['missing-objects']);holds.partialObjects=partial.holds;
 const resumed=await phase('restoreObjects',()=>restoreObjects(target.OBJECTS_A,pointA,pointDigestA));
 assert.deepEqual({written:resumed.written,skipped:resumed.skipped},{written:2,skipped:1});
 assert.deepEqual(await restoreObjects(target.OBJECTS_A,pointA,pointDigestA),{objects:3,written:0,skipped:3,preexisting:3},'Repeated restore writes nothing');
 const restoredBuild=join(directory,'restored-runtime');
 const worker=await phase('restoreWorkerArtifact',()=>restoreWorkerArtifact(pointA,pointDigestA,'runtime',restoredBuild));
 const admitted=await phase('inspectIsolatedRestore',()=>inspect());
 assert.equal(admitted.status,'verified',JSON.stringify(admitted));
 assert.deepEqual([admitted.servingAllowed,admitted.providerDispatchAllowed,admitted.retirementAllowed],[false,false,false]);
 assert.equal(admitted.keys.credentials,5);assert.equal(admitted.objects,3);
 const artifacts=await phase('reconcileArtifacts',()=>reconcileArtifacts(target.DRILL_A));
 assert.equal(artifacts.status,'consistent',JSON.stringify(artifacts));assert.equal(artifacts.publishedSites,1);assert.equal(artifacts.enabledApplications,1);assert.equal(artifacts.applicationDocuments,2);
 restoredRuntime=await workerd(restoredBuild);
 const after=await phase('restoredQuickJS',()=>reference(target.DRILL_A,restoredRuntime));
 assert.deepEqual(after,before,'Restored program, documents and runtime artifact reproduce the pre-disaster outputs');
 // Every table of the current schema is captured and restored (or excluded with a rationale); a restored count that differs from the archive holds.
 const catalog=JSON.parse(await readFile('docs/data-lifecycle.json','utf8')),{snapshot:pointSnapshot}=await verifyRecoveryPoint(pointA,pointDigestA);
 const countRestored=async table=>(await target.DRILL_A.prepare(`SELECT count(*) n FROM "${table}"`).first()).n;
 const coverage=await phase('recoveryCoverage',()=>recoveryCoverage(pointSnapshot,countRestored,catalog));
 assert.equal(coverage.status,'complete',JSON.stringify(coverage.holds));assert.equal(coverage.tables,261);assert.equal(coverage.excluded,0);
 for(const table of Object.keys(seeded))assert.equal(await countRestored(table),seeded[table],table+' restored with its archived rows');
 // A new table, a table that vanished from the restore, a stale exclusion and a mismatched count each fail until classified.
 const withTable=structuredClone(pointSnapshot);withTable.tables.push({name:'new_personal_data',columns:['id'],rows:[]});
 holds.unclassifiedTable=(await recoveryCoverage(withTable,countRestored,catalog)).holds;assert.deepEqual(holds.unclassifiedTable,['coverage-unclassified-table']);
 holds.restoreMismatch=(await recoveryCoverage(pointSnapshot,async()=>-1,catalog)).holds;assert.deepEqual(holds.restoreMismatch,['coverage-restore-mismatch']);
 holds.staleExclusion=(await recoveryCoverage(pointSnapshot,countRestored,catalog,{retired_table:'none'})).holds;assert.deepEqual(holds.staleExclusion,['coverage-stale-exclusion']);
 const excludedCoverage=await recoveryCoverage(pointSnapshot,async()=>-1,catalog,Object.fromEntries(pointSnapshot.tables.filter(t=>t.name!=='sqlite_sequence').map(t=>[t.name,'drill rationale'])));
 assert.equal(excludedCoverage.status,'complete');assert.equal(excludedCoverage.excluded,261);
 refusals+=3;
 // WH-117 key versions in the restored candidate: one registered key, all 4 credential rows under it, no running rotation.
 const keyVersions=await phase('inventoryKeyVersions',()=>inventoryKeyVersions(target.DRILL_A));
 assert.equal(keyVersions.status,'settled',JSON.stringify(keyVersions.holds));assert.deepEqual(keyVersions.ciphertextByKey,{[keyVersions.active]:5});assert.equal(keyVersions.registered.length,1);
 const rto=Math.round(performance.now()-restoreStart);
 const loss=await phase('restoreDiscrepancies',()=>restoreDiscrepancies(target.DRILL_A,db));
 assert.deepEqual(loss.counts.resurrected,{});assert.deepEqual(loss.counts.rolledBack,{});assert.deepEqual(loss.tables.lostSinceSnapshot,{project_files:1});
 // The candidate stays unchanged and unrouted: nothing in the drill wrote to it.
 assert.equal((await captureCMSDatabase(async sql=>(await target.DRILL_A.prepare(sql).all()).results,{maxRows:200000})).digest,capture.controlDigest);
 assert.ok(!JSON.stringify([admitted,artifacts,loss]).includes(canary)&&!JSON.stringify([admitted,artifacts,loss]).includes(owner.account));

 // ---- Missing/corrupt keys, archives and artifacts fail visibly.
 const recoveryKey=stored.recoveryKeyFile,moved=recoveryKey+'.moved';
 await rename(recoveryKey,moved);holds.missingRecoveryKey=(await inspect()).holds;await rename(moved,recoveryKey);
 assert.deepEqual(holds.missingRecoveryKey,['key-backup-unavailable']);
 const otherKeys=(await keys.create(fixtureKeyring('cd'.repeat(32)))).proof;
 holds.unregisteredKeyBackup=(await inspect({keyBackup:otherKeys})).holds;assert.deepEqual(holds.unregisteredKeyBackup,['key-backup-binding']);
 const damaged=join(directory,'points','damaged');
 const damage=async(mutate,code)=>{await rm(damaged,{recursive:true,force:true});await cp(pointA,damaged,{recursive:true});await mutate(damaged);await drillHold(()=>verifyRecoveryPoint(damaged,pointDigestA),code);};
 const firstObject=async dir=>join(dir,'objects',(await readdir(join(dir,'objects')))[0]);
 await damage(async dir=>unlink(await firstObject(dir)),'object-missing');
 await damage(async dir=>{const f=await firstObject(dir),b=await readFile(f);b[0]^=1;await unlink(f);await writeFile(f,b,{mode:0o600});},'object-digest');
 await damage(async dir=>{const f=join(dir,'control.json'),b=await readFile(f);await unlink(f);await writeFile(f,Buffer.concat([b.subarray(0,b.length-1),Buffer.from(' }')]),{mode:0o600});},'control-digest');
 await damage(async dir=>{const f=join(dir,'workers','runtime','worker.js');await writeFile(f,(await readFile(f,'utf8'))+'\n// altered');},'worker-artifact-digest');
 await damage(async dir=>unlink(join(dir,'recovery-point.json')),'point-missing');
 // A consistently edited manifest (object entry and its digest both replaced) still fails the independent pin.
 await damage(async dir=>{const f=join(dir,'recovery-point.json'),p=JSON.parse(await readFile(f));p.objects.entries.pop();p.objects.count--;p.objects.sha256=createHash('sha256').update(JSON.stringify(p.objects.entries)).digest('hex');await unlink(f);await writeFile(f,JSON.stringify(p),{mode:0o600});},'point-digest');
 await drillHold(()=>verifyRecoveryPoint(pointA,'0'.repeat(64)),'point-digest');
 await drillHold(()=>restoreWorkerArtifact(pointA,pointDigestA,'runtime',restoredBuild),'restore-target-not-empty');
 await target.OBJECTS_A.delete(objectKeys[0]);
 holds.missingRestoredObject=(await inspect()).holds;assert.deepEqual(holds.missingRestoredObject,['missing-objects']);
 await target.OBJECTS_A.put(objectKeys[0],Buffer.alloc(Buffer.byteLength('Synthetic private garden plan '+canary),'x'));
 holds.corruptRestoredObject=(await inspect()).holds;assert.deepEqual(holds.corruptRestoredObject,['object-integrity']);
 await drillHold(()=>restoreObjects(target.OBJECTS_A,pointA,pointDigestA),'restore-target-conflict');
 await target.OBJECTS_A.delete(objectKeys[0]);assert.equal((await restoreObjects(target.OBJECTS_A,pointA,pointDigestA)).written,1);
 await target.OBJECTS_A.put('unexpected/object','x');await drillHold(()=>restoreObjects(target.OBJECTS_A,pointA,pointDigestA),'restore-target-not-isolated');await target.OBJECTS_A.delete('unexpected/object');
 assert.equal((await inspect()).status,'verified','Retried object restore returns to the verified state');
 // A changed published artifact in a candidate copy (immutability triggers are
 // created after rows, so edit the archived cells): pointers and manifest refuse it.
 const {snapshot}=await verifyRecoveryPoint(pointA,pointDigestA);
 const tamperedCopy=async(changes)=>{
  const copy=structuredClone(snapshot);
  for(const [table,column,value] of changes){const t=copy.tables.find(x=>x.name===table),i=t.columns.indexOf(column);for(const row of t.rows)row[i]=value;}
  const sql=new DatabaseSync(':memory:');restoreCapturedCMSDatabase(sql,copy);return sql;
 };
 for(const [changes,expected] of [[[['site_versions','html',"'Tampered page'"]],['site-artifact-digest']],[[['site_versions','html',"'Tampered page'"],['backend_versions','digest',"'"+'0'.repeat(64)+"'"]],['app-program-digest','site-artifact-digest']]]){
  const sql=await tamperedCopy(changes);
  try{
   const copy=sqliteD1Adapter(sql),report=await reconcileArtifacts(copy);assert.deepEqual(report.holds,expected);holds['tampered:'+expected.join('+')]=report.holds;
   holds.tamperedCandidate=(await inspect({db:copy})).holds;assert.deepEqual(holds.tamperedCandidate,['manifest-mismatch']);
  }finally{sql.close();}
 }

 // ---- Interrupted key rotation and interrupted cutover, on throwaway copies of the archive (nothing live is written).
 {
  const sql=await tamperedCopy([]);
  try{
   sql.prepare("INSERT INTO connection_key_registry(id,fingerprint,review_id) VALUES('next-key',?,'synthetic-rotation-review')").run(hash('next-key'));
   const active=sql.prepare('SELECT active_key,revision FROM connection_key_policy').get();
   sql.prepare("INSERT INTO connection_key_rotations(id,source_key,target_key,revision,review_id,state) VALUES(?,?,?,?,?,'running')").run(id(),active.active_key,'next-key',active.revision+1,'synthetic-rotation-review');
   const copy=sqliteD1Adapter(sql),stuck=await inventoryKeyVersions(copy);
   assert.deepEqual(stuck.holds,['key-rotation-unsettled']);assert.equal(stuck.rotations.running.length,1);assert.deepEqual(stuck.registered,[active.active_key,'next-key'].sort());
   holds.interruptedRotation=(await inspect({db:copy})).holds;assert.notEqual(holds.interruptedRotation.length,0,'A candidate with a running rotation is never admitted');
   refusals++;
   // A ciphertext under a key id that is not registered is a missing key version.
  }finally{sql.close();}
  const lostKey=await tamperedCopy([['github_token_vault','ciphertext',"'wv2.lost-key.AAAA'"]]);
  try{holds.unregisteredKeyVersion=(await inventoryKeyVersions(sqliteD1Adapter(lostKey))).holds;}finally{lostKey.close();}
  assert.deepEqual(holds.unregisteredKeyVersion,['key-version-unregistered']);refusals++;
  const journal=(status,steps)=>({release:'drill-release',manifestDigest:hash('m'),status,steps:Object.fromEntries(['schema','runtime','apps','sites','platform'].map((k,i)=>[k,{status:steps[i]??'pending',...(steps[i]==='running'||steps[i]==='unknown'||steps[i]==='confirmed'?{operationConfirmed:steps[i]!=='running'}:{})}]))});
  const settled=inventoryCutovers([journal('deployed',Array(5).fill('confirmed')),journal('prepared',[])]);
  assert.deepEqual([settled.status,settled.interrupted],['settled',0]);
  const midApply=inventoryCutovers([journal('applying',['confirmed','confirmed','running'])]);
  assert.deepEqual(midApply.holds,['cutover-interrupted']);assert.deepEqual(midApply.releases[0].stuck,[{step:'apps',status:'running',operationConfirmed:false}]);assert.equal(midApply.releases[0].pending,2);
  const uncertain=inventoryCutovers([journal('needs-reconciliation',['confirmed','unknown'])]);
  assert.equal(uncertain.releases[0].stuck[0].status,'unknown');
  holds.cutoverFormat=inventoryCutovers([{release:'x',status:'weird',steps:{}},null]).holds;assert.deepEqual(holds.cutoverFormat,['journal-format']);
  holds.cutoverMidApply=midApply.holds;refusals+=3;
  summaryExtra={cutovers:{settled:settled.interrupted,midApplyStuck:midApply.releases[0].stuck.length}};
 }

 // ---- Identity, revocation, deletion and publication changes after the point.
 const replacement=await workspaceSession(db,m,{account:owner.account,credential:owner.credential}),current=await replacement.scope();
 await owner.revoke();
 revision=(await m.readChat(current,owner.account)).state.revision;const withdraw=id();
 assert.equal((await m.sendChat(current,owner.account,{id:withdraw,revision,content:'/unpublish '+site})).status,200);
 revision=(await m.readChat(current,owner.account)).state.revision;
 assert.equal((await m.sendChatControl(current,owner.account,{id:id(),revision,action:{type:'confirm',kind:'site',reviewId:withdraw}})).status,200);
 assert.equal((await db.prepare('SELECT version_id FROM publications WHERE project_id=?').bind(site).first()).version_id,null);
 const erased=visitors[1],deletion=await m.appLifecycle.prepareAppDeletion(db,erased.session,app);
 assert.equal((await m.appLifecycle.deleteAppAccount(db,erased.session,app,deletion.id,deletion.revision,'DELETE')).deleted,true);
 const gaps=await phase('reconciliationInventory',()=>restoreDiscrepancies(target.DRILL_A,db));
 assert.ok(gaps.tables.resurrected.identity_sessions>=1&&gaps.tables.resurrected.app_visitors===1&&gaps.tables.resurrected.app_documents===1&&gaps.tables.rolledBack.publications===1,JSON.stringify(gaps));
 const revoked=await inspect();holds.afterRevocation=revoked.holds;assert.equal(revoked.status,'held');
 assert.ok(['suppressed-record','stale-authority'].includes(revoked.holds[0]),JSON.stringify(revoked.holds));
 // The candidate is held, not scrubbed: the restored rows remain present for WH-019.
 assert.ok(await target.DRILL_A.prepare('SELECT id FROM identity_sessions WHERE id=?').bind(owner.authority).first());
 assert.ok(await target.DRILL_A.prepare('SELECT id FROM app_visitors WHERE id=?').bind(erased.who).first());

 // ---- Total control-database loss: no independent current authority on main.
 const lost={prepare(){throw Error('source lost');},batch(){throw Error('source lost');}};
 const orphan=await openRestoreInventory({inventoryFile,expectedStreamId:streamId,sourceDb:lost});closers.push(()=>orphan.close());
 holds.sourceLost=(await inspectOnce({evidenceSource:orphan.evidenceSource})).holds;assert.deepEqual(holds.sourceLost,['independent-evidence']);
 assert.equal((await restoreDiscrepancies(target.DRILL_A,lost)).sourceAvailable,false);
 // WH-019: without the current source there is no ledger to replay; with it, one atomic idempotent replay removes what the
 // current ledger says was erased or revoked, and the gate reports clear. Synthetic and local: sessions are epoch evidence, not ledger rows.
 {const unavailable=await reconcileRestoreSuppressions(target.DRILL_A,lost,suppression);assert.equal(unavailable.status,'unavailable');assert.deepEqual(unavailable.holds,['suppression-source-unavailable'],'a caller that reads only holds sees a hold');}
 await drillHold(()=>reconcileRestoreSuppressions(target.DRILL_A,db,{}),'suppression-module');
 // The hold names why the replay was refused (error name, code and a bounded message), never row data.
 {const refusing={...suppression,replayRestoreSuppressions:async()=>{throw Object.assign(Error('FOREIGN KEY constraint failed '+'f'.repeat(64)),{code:'ERR_SQLITE_ERROR'});}};
  await assert.rejects(()=>reconcileRestoreSuppressions(target.DRILL_A,db,refusing),e=>e instanceof DrillHold&&e.code==='suppression-replay-refused'&&/^Error ERR_SQLITE_ERROR: FOREIGN KEY constraint failed/.test(e.detail)&&!/f{64}/.test(e.detail)&&e.detail.length<=240,'the replay refusal carries its real, bounded cause');}
 const reconciled=await phase('reconcileRestoreSuppressions',()=>reconcileRestoreSuppressions(target.DRILL_A,db,suppression));
 assert.equal(reconciled.status,'reconciled');assert.ok(reconciled.pendingBefore.visitor>=1,JSON.stringify(reconciled.pendingBefore));assert.ok(reconciled.applied.visitorsRemoved>=1);
 assert.equal(await target.DRILL_A.prepare('SELECT id FROM app_visitors WHERE id=?').bind(erased.who).first(),null,'The erased visitor is not resurrected');
 assert.deepEqual((await restoreDiscrepancies(target.DRILL_A,db)).tables.resurrected.app_visitors,undefined);
 assert.ok(Object.values((await reconcileRestoreSuppressions(target.DRILL_A,db,suppression)).applied).every(n=>n===0),'A duplicate replay changes nothing');

 // ---- A point captured during in-flight provider work never dispatches or admits.
 const inflight=id();
 await db.prepare("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,'2026-10-08','2026-10-08')").bind(inflight,owner.account,'c'.repeat(64)).run();
 await db.prepare("UPDATE standard_ai_requests SET state='dispatched' WHERE id=?").bind(inflight).run();
 await files.put(objectKeys[1],'Synthetic private planting notes');
 const pointB=join(directory,'points','B'),snapshotB='drill-point-b';
 const captureB=await captureRecoveryPoint({sourceDb:db,objects:{get:async key=>(await files.get(key))??(await target.OBJECTS_A.get(key))},directory:pointB,snapshotId:snapshotB});
 const archivedB=await openArchivedControl(pointB,captureB.pointDigest);let manifestB;try{manifestB=await inventory.registerArchive({archiveDb:archivedB.db,snapshotId:snapshotB,keyBackup});}finally{archivedB.close();}
 await restoreControlD1(target.DRILL_B,pointB,captureB.pointDigest);await restoreObjects(target.OBJECTS_B,pointB,captureB.pointDigest);
 const inspectB=()=>inspectIsolatedRestore({db:target.DRILL_B,manifest:manifestB,keyBackup,evidenceSource:inventory.evidenceSource,expectedStreamId:streamId,objects:isolatedObjects(target.OBJECTS_B)});
 const executed=executions;
 holds.inFlightSource=(await inspectB()).holds;assert.deepEqual(holds.inFlightSource,['independent-evidence'],'Unresolved current effects refuse evidence');
 await db.prepare("UPDATE standard_ai_requests SET state='completed',input_tokens=1,output_tokens=1 WHERE id=?").bind(inflight).run();
 await inventory.observe({operationId:'drill-inflight-terminal',selection:{kind:'external-effect',store:'standard_ai_requests',effectId:inflight}});
 holds.inFlightCandidate=(await retryIndependentEvidence(inspectB)).holds;// The settled source row now differs from the archived in-flight row, so the derived
 // current-record constraint holds it first; the restore-admission suite covers the
 // separate uncertain-effect refusal for an unchanged in-flight candidate.
 assert.deepEqual(holds.inFlightCandidate,['stale-authority'],'The recovered in-flight row stays held after reconciliation');
 assert.equal(executions,executed,'Admission and reconciliation dispatched no runtime work');

 const summary={suite:'WH-008 isolated local disaster-recovery drill',node:process.versions.node,
  inventory:{controlRows:capture.controlRows,controlBytes:capture.controlBytes,restoreStatements:control.statements,objects:capture.objects,objectBytes:capture.objectBytes,runtimeFiles:worker.files,credentials:admitted.keys.credentials,keyIds:admitted.keys.keyIds.length,tables:admitted.tables,artifacts:{publishedSites:artifacts.publishedSites,publishedBackends:artifacts.publishedBackends,applications:artifacts.applications,applicationDocuments:artifacts.applicationDocuments}},
  measured:{phasesMs:phases,restoreToVerifiedMs:rto,lossSinceSnapshot:{...loss.tables.lostSinceSnapshot,objects:1},pointAgeAtDisasterMs:disasterAt-capture.capturedAt,rpoLocalMs:disasterAt-capture.capturedAt,rtoLocalMs:rto},
  coverage:{...coverage,perClass:undefined},keyVersions,seededRows:seeded,...summaryExtra,holds,afterRevocationTables:gaps.tables,drillRefusals:refusals,independentEvidenceRetries:independentEvidenceRetries.length,afterRevocationCounts:gaps.counts,servingAllowed:false,providerDispatchAllowed:false,retirementAllowed:false,remoteAccess:false};
 console.log(JSON.stringify(summary,null,1));
}finally{
 globalThis.fetch=network;
 for(const close of closers.reverse())await close().catch(()=>{});
 await restoredRuntime?.dispose();await sourceRuntime?.dispose();await isolated?.dispose();await fixture?.close();
 await rm(directory,{recursive:true,force:true});
}
