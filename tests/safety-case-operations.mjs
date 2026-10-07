import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
import {captureRestoreRecordSnapshot} from '../tools/restore-admission.mjs';
import {checkHoldInventory} from '../tools/safety-hold-inventory.mjs';
import {enableFixtureVisitorAccess} from './current-site-fixture.mjs';
// WH-132: authenticated operator surface, object/project holds over every ordinary deletion/expiry path, restricted
// evidence storage, two-person disclosure records and restore suppression. Synthetic, benign placeholders only.
const d1=process.argv.includes('--d1');
const source=`export * as cases from './src/safety-cases.ts';export * as http from './src/safety-case-http.ts';export {cleanupPhotos} from './src/files.ts';
 export {cleanupTraffic,readTraffic} from './src/site-traffic.ts';export {cleanupContacts,deleteContact,contactInbox} from './src/contacts.ts';export {updateProfilePhoto,updateProfile} from './src/profile.ts';
 export {deleteGuestFeedback} from './src/guest-previews/owner.ts';export {newSessionToken,hashToken} from './src/security.ts';export {resolveIdentity,IdentityError} from './src/workspace-identity/authority.ts';
 export {admitWorkspace} from './src/workspace-identity/admission.ts';export {default as worker} from './src/index.ts';
 export {readChat,sendChatControl} from './src/chat.ts';export {createWebsite,prepareSpecification,readSpecificationProposal} from './src/project-specification/store.ts';
 export {moduleCatalog} from './src/project-specification/catalog.ts';export {jsonDigest} from './src/project-specification/v2/json.ts';`;
const built=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')),{cases:c}=m;
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('Unexpected network');};
/** In-memory R2 with the conditional-put and listing semantics the code relies on (SQLite mode only). */
function memoryBucket(){
 const objects=new Map();
 const view=(key,o)=>({key,size:o.bytes.length,uploaded:o.uploaded,customMetadata:o.customMetadata,httpMetadata:o.httpMetadata,body:{cancel:async()=>{}},arrayBuffer:async()=>o.bytes.slice().buffer});
 return {objects,
  get:async key=>objects.has(key)?view(key,objects.get(key)):null,head:async key=>objects.has(key)?view(key,objects.get(key)):null,
  put:async(key,bytes,options={})=>{if(options.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;objects.set(key,{bytes:new Uint8Array(bytes),uploaded:options.uploaded??new Date(),customMetadata:options.customMetadata??{},httpMetadata:options.httpMetadata});return view(key,objects.get(key));},
  delete:async keys=>{for(const key of [keys].flat())objects.delete(key);},
  list:async({prefix='',limit=1000}={})=>({objects:[...objects.keys()].filter(k=>k.startsWith(prefix)).sort().slice(0,limit).map(k=>view(k,objects.get(k)))})};
}
const fixture=await databaseFixture({r2:d1}),{db}=fixture,FILES=d1?fixture.env.FILES:memoryBucket();let checks=0;
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first(),all=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results;
const count=async(table,where='1',...p)=>(await row(`SELECT count(*) AS n FROM ${table} WHERE ${where}`,...p)).n;
const refused=async(fn,reason)=>{await assert.rejects(fn,e=>e instanceof c.SafetyCaseError&&e.reason===reason,reason);checks++;};
const blocked=async fn=>{await assert.rejects(fn,/safety_preservation_hold/);checks++;};
const sha=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const exists=async key=>!!await FILES.head(key);
const MARK='SYNTHETIC-PRIVATE-MARKER';
const principal=(token,database=db)=>m.resolveIdentity(database,{version:1,client:'web',kind:'session',token});
async function operator(){const f=await workspaceFixture(db,m);return {id:f.account,ref:'human:'+f.account,fixture:f,p:await principal(f.token)};}
const env={DB:db,FILES,ENVIRONMENT:'test'};
const post=(path,data,{token,origin='https://whumpo.com',method='POST',type='application/json'}={})=>new Request('https://whumpo.com/api/operator/safety-cases/v1/'+path,
 {method,headers:{origin,...(type?{'content-type':type}:{}),...(token?{cookie:'__Host-whumpo_session='+token}:{})},...(method==='POST'?{body:typeof data==='string'?data:JSON.stringify({version:1,...data})}:{})});
const call=async(path,data,options)=>{const response=await m.http.handleSafetyCaseRequest(post(path,data,options),env);return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};};
try{
 // Test fixtures seed customer rows directly; the admission guards below are covered by their own suites.
 const seedGuards=await all("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND sql LIKE '%BEFORE INSERT ON%' AND (tbl_name IN ('site_versions','backend_versions','app_visitors','contact_submissions','app_spaces'))");
 for(const {name} of seedGuards)await run(`DROP TRIGGER ${name}`);
 const admin=await operator(),reviewer=await operator(),approver=await operator(),auditor=await operator(),discloser=await operator(),outsider=await operator();
 const customer=await workspaceFixture(db,m),other=await workspaceFixture(db,m),subject=customer.account;
 await c.bootstrapSafetyRoleAdministrator(db,{grantId:'grant-admin',accountId:admin.id});
 for(const [id,op,role] of [['g-review',reviewer,'case_reviewer'],['g-review-disclose',reviewer,'disclosure_approver'],['g-approve',approver,'preservation_approver'],['g-audit',auditor,'case_auditor'],['g-disclose',discloser,'disclosure_approver']])
  await c.grantSafetyCaseRole(db,admin.p,{grantId:id,operatorAccountId:op.id,role});
 // Bootstrap is single-use while an administrator is active.
 await refused(()=>c.bootstrapSafetyRoleAdministrator(db,{grantId:'grant-admin-2',accountId:outsider.id}),'conflict');

 // ---- Customer fixture: two projects, photos in private R2, versions, visitors, contacts, traffic, guest feedback, profile photo.
 const [p1,p2,pOther]=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
 for(const [p,u] of [[p1,subject],[p2,subject],[pOther,other.account]])await run("INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,?,'2026-10-04','2026-10-04')",p,u,MARK);
 const photo=async(project,old=false)=>{const id=crypto.randomUUID(),key=`photos/${project}/${id}.jpg`,bytes=new TextEncoder().encode(MARK+id);
  await FILES.put(key,bytes,{customMetadata:{sha256:await sha(bytes)},...(old&&!d1?{uploaded:new Date(Date.now()-7200000)}:{})});
  await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,'Photo',?,?,?,1,1,'ready','2026-10-04T00:00:00.000Z')",id,project,key,await sha(bytes),bytes.length);
  return {id,key,bytes};};
 const f1=await photo(p1),f1b=await photo(p1),f2=await photo(p2),f2b=await photo(p2),fo=await photo(pOther);
 // WH-126: visitors belong to each project's access instance, saved and activated through the real owner path.
 const customerScope=await customer.scope();for(const p of [p1,p2])await enableFixtureVisitorAccess(customerScope,subject,p,{handlers:m});
 const version=async project=>{const id=crypto.randomUUID();await run("INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at) VALUES(?,?,'c','{}','<p></p>','d','2026-10-04')",id,project);return id;};
 const v1=await version(p1),v2=await version(p2);
 const backend=crypto.randomUUID();await run("INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,'x',?,'2026-10-04')",backend,p2,'b'.repeat(64));
 const space="INSERT INTO app_spaces(project_id,owner_user_id,version_id,access_id,resource_id) SELECT ?,?,?,id,? FROM module_instances WHERE project_id=? AND kind='access'";
 await run(space,p2,subject,backend,crypto.randomUUID(),p2);
 const visitor=crypto.randomUUID();await run("INSERT INTO app_visitors(id,project_id,access_id,revoked) SELECT ?,?,id,1 FROM module_instances WHERE project_id=? AND kind='access'",visitor,p2,p2);
 // Live visitors whose documents are overwritten and copied into recovery points (p2 project-held, p1 only object-held).
 const backend1=crypto.randomUUID();await run("INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,'x',?,'2026-10-04')",backend1,p1,'c'.repeat(64));
 await run(space,p1,subject,backend1,crypto.randomUUID(),p1);
 const [live,live2,live1]=[crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID()];
 for(const [v,p] of [[live,p2],[live2,p2],[live1,p1]])await run("INSERT INTO app_visitors(id,project_id,access_id,revoked) SELECT ?,?,id,0 FROM module_instances WHERE project_id=? AND kind='access'",v,p,p);
 for(const [id,p,expires] of [['contact-1',p1,'2026-01-01T00:00:00.000Z'],['contact-2',p2,'2026-01-01T00:00:00.000Z'],['contact-o',pOther,'2026-01-01T00:00:00.000Z']])
  await run("INSERT INTO contact_submissions(id,project_id,settings_revision,request_hash,name,email,message,created_at,expires_at) VALUES(?,?,1,'h',?,?,?,'2026-01-01T00:00:00.000Z',?)",id,p,MARK,'v@example.invalid',MARK,expires);
 for(const p of [p1,p2,pOther])await run("INSERT INTO site_traffic_daily(project_id,day,requests) VALUES(?,date('now','-60 days'),3)",p);
 for(const p of [p1,p2,pOther])await run("INSERT INTO site_traffic_quality(project_id,day,excluded_requests,missed_measurements,updated_at) VALUES(?,date('now','-60 days'),1,1,'2026-10-04T00:00:00.000Z')",p);
 const avatar=new TextEncoder().encode(MARK+'avatar'),avatarB64=Buffer.from(avatar).toString('base64');
 await run('INSERT INTO user_profiles(user_id,photo,photo_digest) VALUES(?,?,?)',subject,avatarB64,await sha(avatar));
 await run("INSERT INTO profile_photo_safety(user_id,digest,photo_revision,policy_version) VALUES(?,?,0,'2026-09-30')",subject,await sha(avatar));
 for(const {sql} of seedGuards)await run(sql); // restore the exact current schema (restore admission compares it)

 // ---- Acceptance 1: operator actions require an authenticated identity, enforced through the HTTP surface.
 let r=await call('cases/open',{caseId:'case-1',subjectUserId:subject,intakeRef:'intake-1'});
 assert.equal(r.status,401);assert.equal(r.body.code,'proof_required');assert.equal(r.cache,'no-store');checks++;
 r=await call('cases/open',{caseId:'case-1',subjectUserId:subject,intakeRef:'intake-1',actor:reviewer.ref},{token:reviewer.fixture.token});
 assert.equal(r.status,400);assert.equal(r.body.code,'invalid_input');checks++; // a declared actor field is refused, never used
 const stale=await workspaceSession(db,m,{account:reviewer.id,credential:reviewer.fixture.credential},-700);
 r=await call('cases/open',{caseId:'case-1',subjectUserId:subject,intakeRef:'intake-1'},{token:stale.token});
 assert.equal(r.status,401);assert.equal(r.body.code,'proof_required');checks++; // fresh passkey proof required (reauthenticate)
 r=await call('cases/open',{caseId:'case-1',subjectUserId:subject,intakeRef:'intake-1'},{token:customer.token});
 assert.equal(r.status,403);assert.equal(r.body.code,'missing_role');checks++; // an ordinary customer session holds no role
 r=await call('cases/open',{caseId:'case-1',subjectUserId:subject,intakeRef:'intake-1'},{token:reviewer.fixture.token,method:'GET',type:null});assert.equal(r.status,404);checks++;
 r=await call('cases/delete',{caseId:'case-1'},{token:reviewer.fixture.token});assert.equal(r.status,404);checks++;
 r=await call('cases/open','{"version":1,',{token:reviewer.fixture.token});assert.equal(r.status,400);checks++;
 r=await call('cases/open',{caseId:'case-1',subjectUserId:subject,intakeRef:'intake-1'},{token:reviewer.fixture.token});
 assert.equal(r.status,200,JSON.stringify(r.body));checks++;
 assert.equal((await row("SELECT opened_by FROM safety_cases WHERE id='case-1'")).opened_by,reviewer.ref);checks++;
 // Transport refusals (no session, malformed body, declared actor), stale proofs and role failures are recorded only in the
 // bounded, content-free denied-attempt log; none of them wrote to the immutable privileged audit.
 const deniedRows=(await all('SELECT principal_ref AS p,action,outcome,reason FROM safety_case_denied_attempts ORDER BY seq')).map(x=>[x.p,x.action,x.outcome,x.reason].join(':'));
 assert.deepEqual(deniedRows,[':open_case:denied:unauthenticated',reviewer.ref+':open_case:rejected:invalid_input',reviewer.ref+':open_case:denied:unauthenticated',
  'human:'+customer.account+':open_case:denied:missing_role',reviewer.ref+':open_case:rejected:invalid_input']);checks++;
 assert.equal((await row("SELECT count(*) AS n FROM safety_case_audit WHERE reason IN ('unauthenticated','missing_role','invalid_input')")).n,0);checks++;
 for(let i=0;i<70;i++)assert.equal((await call('holds/place',{holdId:'h-x',caseId:'case-1',legalBasisRef:'b',reviewDays:30,scope:'account'})).status,401);
 assert.equal((await row('SELECT count(*) AS n FROM safety_case_denied_attempts WHERE principal_ref IS NULL')).n,60,'Anonymous budget');checks++;
 assert.equal((await row("SELECT count(*) AS n FROM safety_case_audit WHERE action='place_hold'")).n,0);checks++;
 // The surface is mounted in the platform Worker behind its origin check.
 const workerEnv={...env,API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},ASSETS:{fetch:async()=>new Response('asset')}};
 let response=await m.worker.fetch(post('cases/read',{caseId:'case-1'},{token:reviewer.fixture.token}),workerEnv,{waitUntil:()=>{}});
 assert.equal(response.status,200);assert.equal((await response.json()).result.openedBy,reviewer.ref);checks++;
 response=await m.worker.fetch(post('cases/read',{caseId:'case-1'},{token:reviewer.fixture.token,origin:'https://evil.example'}),workerEnv,{waitUntil:()=>{}});assert.equal(response.status,403);checks++;
 // A role holder whose session is revoked is no longer authenticated.
 const temporary=await workspaceSession(db,m,{account:auditor.id,credential:auditor.fixture.credential});const tempPrincipal=await principal(temporary.token);await temporary.revoke();
 await assert.rejects(()=>c.readSafetyCase(db,tempPrincipal,{caseId:'case-1'}),e=>e instanceof m.IdentityError);checks++;

 // ---- Project- and object-scope holds.
 await refused(()=>c.placePreservationHold(db,approver.p,{holdId:'h-bad',caseId:'case-1',legalBasisRef:'basis-1',reviewDays:30,scope:'project'}),'invalid_input');
 await refused(()=>c.placePreservationHold(db,approver.p,{holdId:'h-foreign',caseId:'case-1',legalBasisRef:'basis-1',reviewDays:30,scope:'project',projectId:pOther}),'not_found');
 await refused(()=>c.placePreservationHold(db,approver.p,{holdId:'h-foreign-file',caseId:'case-1',legalBasisRef:'basis-1',reviewDays:30,scope:'object',projectId:p1,fileId:fo.id}),'not_found');
 r=await call('holds/place',{holdId:'h-project',caseId:'case-1',legalBasisRef:'basis-1',reviewDays:30,scope:'project',projectId:p2},{token:approver.fixture.token});assert.equal(r.status,200,JSON.stringify(r.body));checks++;
 await c.placePreservationHold(db,approver.p,{holdId:'h-object',caseId:'case-1',legalBasisRef:'basis-1',reviewDays:30,scope:'object',projectId:p1,fileId:f1.id});
 // A photo removed by the customer just before the account hold is still queued, now with its owner.
 await run('DELETE FROM project_files WHERE id=?',f1b.id);
 assert.deepEqual({...await row('SELECT project_id,owner_user_id FROM file_cleanup WHERE object_key=?',f1b.key)},{project_id:p1,owner_user_id:subject});checks++;

 // ---- Acceptance 2: every ordinary deletion/expiry path for held scope is blocked or excluded (see tools/safety-hold-inventory.mjs).
 const inventory=await checkHoldInventory();assert.deepEqual([inventory.unclassified,inventory.stale],[[],[]]);checks++;
 await blocked(()=>run('DELETE FROM project_files WHERE id=?',f1.id));                // object hold: photo removal
 await run('DELETE FROM project_files WHERE id=?',fo.id);                               // unrelated account unaffected
 await blocked(()=>run('DELETE FROM project_files WHERE id=?',f2.id));                // project hold: photo removal
 await blocked(()=>run('DELETE FROM site_versions WHERE id=?',v2));                   // version removal
 await assert.rejects(()=>run('DELETE FROM site_versions WHERE id=?',v1),/version_removal_unreviewed/);checks++; // p1 is only object-held: ordinary review gate, not a hold
 await blocked(()=>run('DELETE FROM app_visitors WHERE id=?',visitor));               // visitor deletion / owner erasure
 await blocked(()=>run('DELETE FROM projects WHERE id=?',p2));
 await blocked(()=>run('DELETE FROM projects WHERE id=?',p1));                         // object hold pins its project
 await blocked(()=>run('UPDATE projects SET owner_user_id=? WHERE id=?',other.account,p2));
 await blocked(()=>run('DELETE FROM users WHERE id=?',subject));                        // the cascade reaches held projects
 await blocked(()=>m.deleteContact(db,subject,'contact-2'));
 await m.cleanupContacts(db);assert.deepEqual((await all('SELECT id FROM contact_submissions ORDER BY id')).map(r=>r.id),['contact-2']);checks++;
 assert.equal((await m.contactInbox(db,subject,p2)).messages.length,0);checks++;    // expired-but-held messages stay invisible to the owner
 await m.cleanupTraffic(db);assert.deepEqual((await all('SELECT project_id FROM site_traffic_daily')).map(r=>r.project_id),[p2]);assert.deepEqual((await all('SELECT project_id FROM site_traffic_quality')).map(r=>r.project_id),[p2]);checks++;
 assert.equal((await m.readTraffic(db,subject,p2)).rows.length,0);checks++;
 // R2: the object-held photo's project is not project-held, so the pre-hold queued object is cleaned once no hold covers it.
 await run("UPDATE file_cleanup SET created_at='2026-01-01T00:00:00.000Z'");
 await m.cleanupPhotos({DB:db,FILES});assert.equal(await exists(f1b.key),false);assert.equal(await exists(fo.key),false);checks++;
 // App documents (owner decision, October 4, 2026): overwrites and cleared recovery-point copies inside a held project are
 // preserved invisibly; the write still succeeds. p1 is only object-held, so its documents are not captured.
 const write=(v,state)=>run('UPDATE app_documents SET state_json=?,revision=revision+1 WHERE visitor_id=?',JSON.stringify(state),v);
 await write(live,{note:MARK+'-first'});await write(live,{note:MARK+'-second'});await write(live1,{note:MARK+'-p1'});
 await run('UPDATE app_documents SET state_json=state_json,revision=revision+1 WHERE visitor_id=?',live); // unchanged state: nothing to keep
 const kept=await all("SELECT hold_id,project_id,source_id,payload_json FROM safety_preserved_records WHERE source='app_document' ORDER BY seq");
 assert.deepEqual(kept.map(k=>[k.hold_id,k.project_id,k.source_id]),[['h-project',p2,live],['h-project',p2,live]]);
 assert.deepEqual(kept.map(k=>JSON.parse(k.payload_json)),[{visitor:live,revision:0,state:{}},{visitor:live,revision:1,state:{note:MARK+'-first'}}]);checks++;
 assert.equal(JSON.parse((await row('SELECT state_json FROM app_documents WHERE visitor_id=?',live)).state_json).note,MARK+'-second');checks++; // customer write succeeded
 const pointA=crypto.randomUUID(),pointB=crypto.randomUUID();
 for(const point of [pointA,pointB])await run('INSERT INTO app_recovery_points(id,user_id,project_id,version_id) VALUES(?,?,?,?)',point,subject,p2,backend);
 assert.equal(await count('app_recovery_documents','point_id IN (?,?)',pointA,pointB),4);
 await run('UPDATE app_recovery_points SET removed=1 WHERE id=?',pointA);                 // recovery-point removal
 await run('UPDATE app_visitors SET revoked=1 WHERE id=?',live2);                         // visitor revocation clears its copies
 const copies=await all("SELECT hold_id,source_id,payload_json FROM safety_preserved_records WHERE source='app_recovery_document' ORDER BY seq");
 assert.deepEqual(copies.map(k=>{const v=JSON.parse(k.payload_json);return [k.hold_id,k.source_id,v.point,v.visitor];}).sort(),[['h-project',pointA,pointA,live],['h-project',pointA,pointA,live2],['h-project',pointB,pointB,live2]].sort());
 assert.equal(JSON.parse(copies.find(k=>JSON.parse(k.payload_json).visitor===live).payload_json).state.note,MARK+'-second');checks++;
 assert.equal(await count('app_recovery_documents','point_id IN (?,?)',pointA,pointB),1);checks++; // removal and revocation still succeeded
 // Profile photo removal and avatar change preserve the prior payload invisibly while an account hold is active.
 // A photo the customer removes just before the account hold is placed.
 const late=await photo(p1,true);await run('DELETE FROM project_files WHERE id=?',late.id);
 await c.placePreservationHold(db,approver.p,{holdId:'h-account',caseId:'case-1',legalBasisRef:'basis-2',reviewDays:366});
 await m.updateProfilePhoto(db,subject,new Request('https://whumpo.com/api/profile/photo',{method:'DELETE',headers:{'if-match':'0'}}));
 assert.equal((await row('SELECT photo FROM user_profiles WHERE user_id=?',subject)).photo,null);
 const preserved=await row("SELECT seq,hold_id,source,payload_json FROM safety_preserved_records WHERE source='profile_photo'");
 assert.equal(preserved.hold_id,'h-account');assert.equal(JSON.parse(preserved.payload_json).photo,avatarB64);assert.equal(JSON.parse(preserved.payload_json).safety.digest,await sha(avatar));checks++;
 await blocked(()=>run('DELETE FROM safety_preserved_records'));
 // Queued objects of an account-held owner are retained by cleanup, and the queue row itself cannot be dropped.
 await run("UPDATE file_cleanup SET created_at='2026-01-01T00:00:00.000Z'");
 await m.cleanupPhotos({DB:db,FILES});assert.equal(await exists(late.key),true);assert.equal(await count('file_cleanup','object_key=?',late.key),1);checks++;
 await blocked(()=>run('DELETE FROM file_cleanup WHERE object_key=?',late.key));

 // ---- Restricted evidence storage.
 await refused(()=>c.captureSafetyEvidence({DB:db,FILES},reviewer.p,{objectId:'ev-1',caseId:'case-1',holdId:'h-object',source:'project_photo',sourceRef:f1.id}),'missing_role');
 await refused(()=>c.captureSafetyEvidence({DB:db,FILES},approver.p,{objectId:'ev-x',caseId:'case-1',holdId:'h-object',source:'project_photo',sourceRef:f2.id}),'conflict'); // outside that hold's scope
 r=await call('evidence/capture',{objectId:'ev-1',caseId:'case-1',holdId:'h-object',source:'project_photo',sourceRef:f1.id},{token:approver.fixture.token});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.result.sha256,await sha(f1.bytes));assert.doesNotMatch(JSON.stringify(r.body),new RegExp(MARK));checks++;
 const restricted='restricted/safety-evidence/case-1/ev-1';
 assert.deepEqual(new Uint8Array(await (await FILES.get(restricted)).arrayBuffer()),f1.bytes);checks++;
 // An unconfirmed copy (lost R2 response) resumes on exact retry; a changed retry conflicts.
 const flaky={...FILES,get:FILES.get.bind(FILES),head:FILES.head.bind(FILES),delete:FILES.delete.bind(FILES),put:async()=>{throw Error('lost R2 response');}};
 await assert.rejects(()=>c.captureSafetyEvidence({DB:db,FILES:flaky},approver.p,{objectId:'ev-2',caseId:'case-1',holdId:'h-project',source:'project_photo',sourceRef:f2.id}));checks++;
 assert.equal((await row("SELECT stored_at FROM safety_evidence_objects WHERE id='ev-2'")).stored_at,null);
 await refused(()=>c.closeSafetyCase(db,reviewer.p,{caseId:'case-1',closeRef:'close-early'}),'active_hold');
 await c.captureSafetyEvidence({DB:db,FILES},approver.p,{objectId:'ev-2',caseId:'case-1',holdId:'h-project',source:'project_photo',sourceRef:f2.id});
 await refused(()=>c.captureSafetyEvidence({DB:db,FILES},approver.p,{objectId:'ev-2',caseId:'case-1',holdId:'h-project',source:'project_photo',sourceRef:f2b.id}),'conflict');
 await c.captureSafetyEvidence({DB:db,FILES},approver.p,{objectId:'ev-3',caseId:'case-1',holdId:'h-account',source:'preserved_record',sourceRef:String(preserved.seq)});
 await refused(()=>c.captureSafetyEvidence({DB:db,FILES},approver.p,{objectId:'ev-4',caseId:'case-1',holdId:'h-account',source:'profile_photo',sourceRef:subject}),'not_found'); // removed; preserved copy captured instead
 assert.equal(await count('safety_evidence_objects','stored_at IS NOT NULL'),3);checks++;
 // Ordinary cleanup never lists or deletes the restricted prefix.
 await m.cleanupPhotos({DB:db,FILES});assert.equal(await exists(restricted),true);checks++;

 // ---- Acceptance 3: export/disclosure is a separate, two-person, audited operation that transmits nothing.
 const fetchesBefore=network;
 await refused(()=>c.requestSafetyDisclosure(db,approver.p,{disclosureId:'d-1',caseId:'case-1',legalProcessRef:'process-1',recipientRef:'recipient-1',evidenceObjectIds:['ev-1']}),'missing_role');
 await refused(()=>c.requestSafetyDisclosure(db,reviewer.p,{disclosureId:'d-1',caseId:'case-1',legalProcessRef:'process-1',recipientRef:'recipient-1',evidenceObjectIds:['ev-1','ev-missing']}),'not_found');
 await refused(()=>c.requestSafetyDisclosure(db,reviewer.p,{disclosureId:'d-1',caseId:'case-1',legalProcessRef:MARK+' raw',recipientRef:'recipient-1',evidenceObjectIds:['ev-1']}),'invalid_input');
 const requested=await c.requestSafetyDisclosure(db,reviewer.p,{disclosureId:'d-1',caseId:'case-1',legalProcessRef:'process-1',recipientRef:'recipient-1',evidenceObjectIds:['ev-2','ev-1']});
 assert.deepEqual(await c.requestSafetyDisclosure(db,reviewer.p,{disclosureId:'d-1',caseId:'case-1',legalProcessRef:'process-1',recipientRef:'recipient-1',evidenceObjectIds:['ev-1','ev-2']}),requested);checks++;
 await refused(()=>c.requestSafetyDisclosure(db,reviewer.p,{disclosureId:'d-1',caseId:'case-1',legalProcessRef:'process-2',recipientRef:'recipient-1',evidenceObjectIds:['ev-1']}),'conflict');
 await refused(()=>c.approveSafetyDisclosure(db,reviewer.p,{disclosureId:'d-1',caseId:'case-1',manifestSha256:requested.manifestSha256}),'conflict'); // requester cannot approve
 await refused(()=>c.approveSafetyDisclosure(db,discloser.p,{disclosureId:'d-1',caseId:'case-1',manifestSha256:'0'.repeat(64)}),'conflict');  // must approve the exact manifest
 await refused(()=>c.recordSafetyDisclosure(db,discloser.p,{disclosureId:'d-1',caseId:'case-1',outcomeRef:'outcome-1'}),'conflict');        // not before approval
 r=await call('disclosures/approve',{disclosureId:'d-1',caseId:'case-1',manifestSha256:requested.manifestSha256},{token:discloser.fixture.token});assert.equal(r.status,200);checks++;
 await refused(()=>c.disposeSafetyEvidence({DB:db,FILES},approver.p,{objectId:'ev-1',caseId:'case-1',disposeRef:'dispose-1'}),'conflict');
 const manifest=await c.readSafetyDisclosure(db,auditor.p,{disclosureId:'d-1',caseId:'case-1'});
 assert.equal(manifest.state,'approved');assert.deepEqual(manifest.items.map(i=>i.id),['ev-1','ev-2']);assert.ok(manifest.items.every(i=>/^[0-9a-f]{64}$/.test(i.sha256)));checks++;
 await c.recordSafetyDisclosure(db,discloser.p,{disclosureId:'d-1',caseId:'case-1',outcomeRef:'outcome-1'});
 await c.requestSafetyDisclosure(db,reviewer.p,{disclosureId:'d-2',caseId:'case-1',legalProcessRef:'process-3',recipientRef:'recipient-2',evidenceObjectIds:['ev-3']});
 await c.cancelSafetyDisclosure(db,reviewer.p,{disclosureId:'d-2',caseId:'case-1',cancelRef:'cancel-1'});
 assert.equal(network,fetchesBefore);checks++;
 for(const q of ["UPDATE safety_disclosures SET state='approved' WHERE id='d-1'","DELETE FROM safety_disclosures","DELETE FROM safety_disclosure_items","UPDATE safety_evidence_objects SET sha256='0'","DELETE FROM safety_evidence_objects"])
  {await assert.rejects(()=>run(q),q);checks++;}

 // ---- Preserved-record capacity is 50,000 and fails closed beyond it (the overwrite is refused, never silently unkept).
 const admitSql=(await row("SELECT sql FROM sqlite_master WHERE name='safety_preserved_records_admit'")).sql;await run('DROP TRIGGER safety_preserved_records_admit');
 const fill=50000-1-await count('safety_preserved_records');
 await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?) INSERT INTO safety_preserved_records(hold_id,subject_user_id,project_id,source,source_id,payload_json,preserved_at) SELECT 'h-account',?,?,'app_document','fill','{}',0 FROM n`,fill,subject,p2);
 await run(admitSql);
 await write(live,{note:'at-49999'});assert.equal(await count('safety_preserved_records'),50000);checks++;
 await assert.rejects(()=>write(live,{note:'beyond'}),/safety_case_capacity/);checks++;
 assert.equal(JSON.parse((await row('SELECT state_json FROM app_documents WHERE visitor_id=?',live)).state_json).note,'at-49999');checks++;

 // ---- Restore suppression: neither the current source nor a candidate can be admitted while a hold is active.
 await assert.rejects(()=>captureRestoreRecordSnapshot(db),/could not be observed/);checks++;

 // ---- Release: ordinary deletion resumes; preserved payloads follow; restricted evidence remains until audited disposal.
 for(const hold of ['h-object','h-project','h-account'])await c.releasePreservationHold(db,approver.p,{holdId:hold,caseId:'case-1',releaseRef:'release-'+hold});
 assert.equal(await count('safety_preserved_records'),0);checks++;
 await m.cleanupPhotos({DB:db,FILES});assert.equal(await exists(late.key),false);assert.equal(await count('file_cleanup','object_key=?',late.key),0);checks++;
 await m.cleanupContacts(db);await m.cleanupTraffic(db);assert.equal(await count('contact_submissions'),0);assert.equal(await count('site_traffic_daily'),0);assert.equal(await count('site_traffic_quality'),0);checks++;
 await run('DELETE FROM app_visitors WHERE id=?',visitor);await assert.rejects(()=>run('DELETE FROM site_versions WHERE id=?',v2),/version_removal_unreviewed/);await run('DELETE FROM project_files WHERE id=?',f1.id);
 // Seeded app fixture rows; closure removes app spaces before the account. Recovery points are never deleted by the
 // product, so the fixture lifts that guard for one statement and restores the exact schema afterwards.
 for(const v of [live,live2,live1])await run('DELETE FROM app_visitors WHERE id=?',v);
 const pointGuard=(await row("SELECT sql FROM sqlite_master WHERE name='app_recovery_delete_guard'")).sql;await run('DROP TRIGGER app_recovery_delete_guard');
 await run('DELETE FROM app_recovery_points WHERE project_id=?',p2);await run(pointGuard);
 await run('DELETE FROM app_spaces WHERE project_id=?',p1);
 await run('DELETE FROM app_spaces WHERE project_id=?',p2);
 await run('DELETE FROM users WHERE id=?',subject);assert.equal(await count('projects','owner_user_id=?',subject),0);checks++;
 assert.equal(await exists(restricted),true);assert.equal(await count('safety_evidence_objects'),3);checks++;
 const snapshot=await captureRestoreRecordSnapshot(db);assert.ok(snapshot.records.length>0);checks++; // admitted again after release
 await refused(()=>c.disposeSafetyEvidence({DB:db,FILES},approver.p,{objectId:'ev-1',caseId:'case-1',disposeRef:'dispose-1'}),'conflict'); // case still open
 await c.closeSafetyCase(db,reviewer.p,{caseId:'case-1',closeRef:'close-1'});
 await refused(()=>c.disposeSafetyEvidence({DB:db,FILES},reviewer.p,{objectId:'ev-1',caseId:'case-1',disposeRef:'dispose-1'}),'missing_role');
 // WH-132 retention: a closed case keeps its evidence until an operator releases its one-year retention term.
 await refused(()=>c.disposeSafetyEvidence({DB:db,FILES},approver.p,{objectId:'ev-1',caseId:'case-1',disposeRef:'dispose-1'}),'conflict');
 assert.equal(await exists(restricted),true);checks++;

 // ---- Conflict of interest and non-disclosure to the subject.
 const selfCase=await workspaceFixture(db,m);
 await c.openSafetyCase(db,reviewer.p,{caseId:'case-op',subjectUserId:auditor.id,intakeRef:'intake-op'});
 await c.placePreservationHold(db,approver.p,{holdId:'h-op',caseId:'case-op',legalBasisRef:'basis-op',reviewDays:10});
 await refused(()=>c.readSafetyCase(db,auditor.p,{caseId:'case-op'}),'not_found');                     // same answer as an absent case
 await refused(()=>c.readSafetyCase(db,auditor.p,{caseId:'case-absent'}),'not_found');
 assert.ok(!(await c.listActivePreservationHolds(db,auditor.p)).some(h=>h.caseId==='case-op'));checks++;
 assert.ok((await c.listActivePreservationHolds(db,approver.p)).some(h=>h.caseId==='case-op'));checks++;
 await c.releasePreservationHold(db,approver.p,{holdId:'h-op',caseId:'case-op',releaseRef:'release-op'});
 void selfCase;

 // ---- WH-132 retention review: one-year default term, operator review at expiry, exact preview digest -> apply,
 // release or extend, nothing deleted while any hold is active, never automatic.
 assert.equal(c.safetyRetentionDays,365);
 const term=await row('SELECT opened_at,retention_due_at FROM safety_cases WHERE id=?','case-1');assert.equal(term.retention_due_at-term.opened_at,365*86400);
 for(const o of await all("SELECT captured_at,retention_due_at FROM safety_evidence_objects WHERE case_id='case-1'"))assert.equal(o.retention_due_at-o.captured_at,365*86400);checks++;
 /** Simulated passage of time: the fixture lifts the immutability guards for one statement and restores the exact schema. */
 const age=async(caseId,days=400)=>{
  const guards=await all("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('safety_cases_update','safety_cases_close_held','safety_evidence_objects_update')");
  for(const g of guards)await run(`DROP TRIGGER ${g.name}`);
  try{await run('UPDATE safety_cases SET opened_at=opened_at-?,retention_due_at=retention_due_at-? WHERE id=?',days*86400,days*86400,caseId);
   await run('UPDATE safety_evidence_objects SET captured_at=captured_at-?,retention_due_at=retention_due_at-? WHERE case_id=?',days*86400,days*86400,caseId);}
  finally{for(const g of guards)await run(g.sql);}
 };
 const queue=async who=>(await c.listSafetyRetentionReviews(db,who.p));
 const preview=(who,input)=>c.previewSafetyRetentionDecision(db,who.p,input),apply=(who,input)=>c.applySafetyRetentionDecision(db,who.p,input);
 // Not yet due: not listed, no preview, no decision.
 assert.ok(!(await queue(approver)).some(i=>i.caseId==='case-1'));checks++;
 await refused(()=>preview(approver,{caseId:'case-1',decision:'release',decisionRef:'ret-early'}),'conflict');
 const early=await row("SELECT due_at FROM safety_case_retention WHERE case_id='case-1'");
 await refused(()=>apply(approver,{caseId:'case-1',decision:'release',decisionRef:'ret-early',reviewSha256:'0'.repeat(64)}),'conflict');
 await assert.rejects(()=>run("INSERT INTO safety_retention_decisions VALUES('case-1',1,'release',?,NULL,?,'ret-direct',?,unixepoch())",early.due_at,'0'.repeat(64),approver.ref),/safety_retention_changed/);checks++;
 // Due: listed for operators with a case role, never to the case subject; nothing was deleted by expiry itself.
 await age('case-1');
 let due=(await queue(approver)).find(i=>i.caseId==='case-1');
 assert.deepEqual([due.status,due.releasable,due.storedEvidence,due.activeHolds,due.openDisclosures],['retention_review_due',true,3,0,0]);assert.ok(due.retentionDueAt<=Date.now()/1000);checks++;
 assert.ok((await queue(auditor)).some(i=>i.caseId==='case-1'));await refused(()=>queue(reviewer),'missing_role');
 assert.equal(await count('safety_evidence_objects',"case_id='case-1' AND disposed_at IS NULL"),3);assert.equal(await exists(restricted),true);checks++;
 r=await call('retention/list',{},{token:auditor.fixture.token});assert.equal(r.status,200);assert.ok(r.body.result.some(i=>i.caseId==='case-1'&&i.status==='retention_review_due'));checks++;
 assert.equal((await call('retention/preview',{caseId:'case-1',decision:'release',decisionRef:'ret-1',extendDays:5},{token:approver.fixture.token})).status,400);
 assert.equal((await call('retention/preview',{caseId:'case-1',decision:'purge',decisionRef:'ret-1'},{token:approver.fixture.token})).status,400);checks++;
 await refused(()=>preview(reviewer,{caseId:'case-1',decision:'release',decisionRef:'ret-1'}),'missing_role');
 await refused(()=>preview(auditor,{caseId:'case-1',decision:'release',decisionRef:'ret-1'}),'missing_role');
 // Preview writes nothing; apply needs the exact digest of the same decision.
 const reviewed=await preview(approver,{caseId:'case-1',decision:'release',decisionRef:'ret-1'});
 assert.equal(reviewed.releasable,true);assert.equal(reviewed.evidence.length,3);assert.match(reviewed.reviewSha256,/^[0-9a-f]{64}$/);assert.equal(await count('safety_retention_decisions'),0);checks++;
 await refused(()=>apply(approver,{caseId:'case-1',decision:'release',decisionRef:'ret-1',reviewSha256:'f'.repeat(64)}),'conflict');
 await refused(()=>apply(approver,{caseId:'case-1',decision:'release',decisionRef:'ret-other',reviewSha256:reviewed.reviewSha256}),'conflict');
 await refused(()=>apply(approver,{caseId:'case-1',decision:'extend',extendDays:30,decisionRef:'ret-1',reviewSha256:reviewed.reviewSha256}),'conflict');
 await refused(()=>apply(reviewer,{caseId:'case-1',decision:'release',decisionRef:'ret-1',reviewSha256:reviewed.reviewSha256}),'missing_role');
 r=await call('retention/apply',{caseId:'case-1',decision:'release',decisionRef:'ret-1',reviewSha256:reviewed.reviewSha256},{token:approver.fixture.token});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.result.decision,'release');
 assert.deepEqual(await apply(approver,{caseId:'case-1',decision:'release',decisionRef:'ret-1',reviewSha256:reviewed.reviewSha256}),{caseId:'case-1',decision:'release',seq:1,nextDueAt:null},'Exact retry is idempotent');
 assert.equal(await count('safety_retention_decisions',"case_id='case-1'"),1);checks++;
 // Release is final and deletes nothing itself; disposal stays the separate audited operation.
 await refused(()=>preview(approver,{caseId:'case-1',decision:'extend',extendDays:30,decisionRef:'ret-2'}),'conflict');
 assert.equal(await exists(restricted),true);due=(await queue(approver)).find(i=>i.caseId==='case-1');assert.equal(due.status,'released_pending_disposal');assert.equal(due.releasable,false);checks++;
 r=await call('evidence/dispose',{objectId:'ev-1',caseId:'case-1',disposeRef:'dispose-1'},{token:approver.fixture.token});assert.equal(r.status,200);
 await c.disposeSafetyEvidence({DB:db,FILES},approver.p,{objectId:'ev-1',caseId:'case-1',disposeRef:'dispose-1'});
 assert.equal(await exists(restricted),false);assert.equal(await exists('restricted/safety-evidence/case-1/ev-2'),true);checks++;
 const viewed=await c.readSafetyCase(db,auditor.p,{caseId:'case-1'});assert.equal(viewed.retention.released,true);assert.equal(viewed.retention.decisions[0].reviewSha256,reviewed.reviewSha256);checks++;
 for(const sql of ["UPDATE safety_retention_decisions SET decision='extend'","DELETE FROM safety_retention_decisions","UPDATE safety_cases SET retention_due_at=retention_due_at+1 WHERE id='case-1'"])await assert.rejects(()=>run(sql),/safety_case_immutable/);checks++;
 // Any active hold on the subject (here from another case) blocks release, and so blocks disposal.
 await c.openSafetyCase(db,reviewer.p,{caseId:'case-r1',subjectUserId:other.account,intakeRef:'intake-r1'});await c.closeSafetyCase(db,reviewer.p,{caseId:'case-r1',closeRef:'close-r1'});
 await c.openSafetyCase(db,reviewer.p,{caseId:'case-r2',subjectUserId:other.account,intakeRef:'intake-r2'});
 await c.placePreservationHold(db,approver.p,{holdId:'h-r2',caseId:'case-r2',legalBasisRef:'basis-r2',reviewDays:30});
 await age('case-r1');
 assert.ok(!(await queue(approver)).some(i=>i.caseId==='case-r2'),'A case within its term is not listed');
 due=(await queue(approver)).find(i=>i.caseId==='case-r1');assert.equal(due.activeHolds,1);assert.equal(due.releasable,false);checks++;
 const held=await preview(approver,{caseId:'case-r1',decision:'release',decisionRef:'ret-r1'});assert.equal(held.releasable,false);assert.equal(held.activeHolds,1);
 await refused(()=>apply(approver,{caseId:'case-r1',decision:'release',decisionRef:'ret-r1',reviewSha256:held.reviewSha256}),'active_hold');
 await c.releasePreservationHold(db,approver.p,{holdId:'h-r2',caseId:'case-r2',releaseRef:'release-r2'});
 assert.equal((await apply(approver,{caseId:'case-r1',decision:'release',decisionRef:'ret-r1',reviewSha256:held.reviewSha256})).decision,'release');checks++;
 // An open case cannot be released; the operator extends it instead (1-366 days from the decision).
 await age('case-r2');
 const open=await preview(approver,{caseId:'case-r2',decision:'release',decisionRef:'ret-r2'});assert.equal(open.releasable,false);
 await refused(()=>apply(approver,{caseId:'case-r2',decision:'release',decisionRef:'ret-r2',reviewSha256:open.reviewSha256}),'conflict');
 for(const extendDays of [0,367,1.5,undefined])await refused(()=>preview(approver,{caseId:'case-r2',decision:'extend',decisionRef:'ret-r2x',...(extendDays===undefined?{}:{extendDays})}),'invalid_input');
 const longer=await preview(approver,{caseId:'case-r2',decision:'extend',extendDays:30,decisionRef:'ret-r2x'});
 const extended=await apply(approver,{caseId:'case-r2',decision:'extend',extendDays:30,decisionRef:'ret-r2x',reviewSha256:longer.reviewSha256});
 assert.equal(extended.seq,1);assert.ok(Math.abs(extended.nextDueAt-(Date.now()/1000+30*86400))<120);
 assert.ok(!(await queue(approver)).some(i=>i.caseId==='case-r2'),'An extended case leaves the queue until its new due date');
 await refused(()=>preview(approver,{caseId:'case-r2',decision:'release',decisionRef:'ret-r2y'}),'conflict');checks++;
 await c.closeSafetyCase(db,reviewer.p,{caseId:'case-r2',closeRef:'close-r2'});
 // The queue never lists a case about the operator themself.
 await age('case-op');
 assert.ok((await queue(approver)).some(i=>i.caseId==='case-op'));assert.ok(!(await queue(auditor)).some(i=>i.caseId==='case-op'));checks++;

 // ---- Audit: every role-verified attempt is in the privileged audit; identity, input and role failures are only in the
 // bounded denied-attempt log. Identifiers only; no raw material in case storage or responses.
 const audit=await c.readSafetyCaseAudit(db,auditor.p,{caseId:'case-1'}),seen=new Set(audit.map(e=>e.action+':'+e.outcome+':'+e.reason));
 for(const expected of ['open_case:allowed:ok','place_hold:rejected:not_found',
  'capture_evidence:allowed:ok','capture_evidence:rejected:conflict','approve_disclosure:rejected:conflict','approve_disclosure:allowed:ok','record_disclosure:allowed:ok',
  'cancel_disclosure:allowed:ok','read_disclosure:allowed:ok','dispose_evidence:rejected:conflict','dispose_evidence:allowed:ok','preview_retention:rejected:conflict','preview_retention:allowed:ok','decide_retention:rejected:conflict','decide_retention:allowed:ok','close_case:rejected:active_hold','close_case:allowed:ok'])
  {assert.ok(seen.has(expected),expected);checks++;}
 assert.ok(audit.every(e=>!['unauthenticated','missing_role','invalid_input'].includes(e.reason)));checks++;
 const deniedSeen=new Set((await all('SELECT action,outcome,reason FROM safety_case_denied_attempts')).map(e=>e.action+':'+e.outcome+':'+e.reason));
 for(const expected of ['open_case:denied:unauthenticated','open_case:denied:missing_role','place_hold:rejected:invalid_input','capture_evidence:denied:missing_role','request_disclosure:rejected:invalid_input',
  'preview_retention:denied:missing_role','decide_retention:denied:missing_role','read_case:denied:unauthenticated'])
  {assert.ok(deniedSeen.has(expected),expected);checks++;}
 const everything=JSON.stringify([await all('SELECT * FROM safety_case_audit'),await all('SELECT * FROM safety_case_denied_attempts'),await all('SELECT * FROM safety_cases'),await all('SELECT * FROM safety_preservation_holds'),await all('SELECT * FROM safety_evidence_objects'),await all('SELECT * FROM safety_disclosures'),audit,manifest]);
 assert.doesNotMatch(everything,new RegExp(MARK+'|example\\.invalid|raw'));checks++;
 assert.equal(network,0);
 console.log(`Safety case operations passed (${d1?'local D1 + local R2':'SQLite + in-memory R2'}): ${checks} checks. One-year retention review (not due, due queue without self-cases, exact preview digest -> apply, release or 1-366 day extension, final release, holds on the subject and open cases blocking release, disposal only after release), Authenticated fresh-passkey HTTP surface (declared/stale/revoked/foreign-origin refused), project/object/account holds over photo, version, visitor, project, owner, account, contact, traffic and R2 cleanup paths, invisible preservation of profile photos, app document overwrites and cleared recovery-point copies, 50,000 preserved-record capacity failing closed, restricted evidence capture/resume/disposal, two-person manifest-only disclosure, restore suppression, conflict-of-interest non-disclosure, release and the ${inventory.sites}-site deletion inventory. Synthetic placeholders only; nothing transmitted.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
