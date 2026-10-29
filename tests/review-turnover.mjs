// WH-182 review turnover: sealing and deleting eligible review rows at admission and in the daily pass. Offline: disposable
// SQLite (or `--d1` local D1), synthetic owners and projects, no network or credentials.
//
// Proves: every family's generated statements compile and bind; eligible rows leave only with a verified receipt and a bounded
// batch; held, referenced, pending and in-flight rows survive; the deleting statement re-checks holds itself after an earlier
// read; a retry inside the replay horizon returns the original outcome and never creates a second review; a tampered receipt
// fails closed; the daily pass compacts idle projects and removes receipts past the horizon but not inside a hold.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),raw=store.db,id=()=>crypto.randomUUID(),T=m.reviewTurnover;
const run=(sql,...bind)=>raw.prepare(sql).bind(...bind).run(),one=(sql,...bind)=>raw.prepare(sql).bind(...bind).first(),count=async(sql,...bind)=>(await one(sql,...bind)).n;
const hex=c=>c.repeat(64),now=()=>new Date().toISOString(),future=()=>new Date(Date.now()+600000).toISOString(),past='2000-01-01T00:00:00.000Z';
const present=async(table,rid)=>(await count(`SELECT count(*) n FROM ${table} WHERE id=?`,rid))===1;
const receipt=(family,rid)=>one('SELECT * FROM review_receipts WHERE family=? AND id=?',family,rid);
const seal=async(t,project,statementsOnly=false)=>{const s=await T.turnoverStatements(raw,t.family,{user:t.user,project});if(statementsOnly)return s;if(s.length)await raw.batch(s);return Math.max(0,s.length-1);};
async function owner(){const user=id();await workspaceFixture(raw,m,user);return user;}
async function project(user){
 const p=id(),at=now();
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Synthetic','Synthetic turnover fixture','draft',?,?)",p,user,at,at);
 await run('INSERT INTO directories(project_id) VALUES(?)',p);
 return p;
}
let revision=0;
/** One directory review row; `applied` rows get their own confirming id and fire the real apply trigger. */
async function review(user,p,kind,{status='applied',expires=past}={}){
 const rid=id(),turn='turn-'+rid;
 await run("INSERT INTO directory_reviews(id,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at) VALUES(?,?,?,?,'[]',?,?,0,?)",rid,user,p,kind,hex('a'),++revision,expires);
 if(status==='applied')await run("UPDATE directory_reviews SET status='applied',confirmed_by=? WHERE id=?",turn,rid);
 return {id:rid,family:'directory_reviews',user,project:p,kind};
}
const hold=async(user,p)=>{const hid='hold-'+id(),caseId='case-'+id();
 await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",caseId,user);
 await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",hid,caseId,user,p);
 return ()=>run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?",hid);};
const fail=async(promise,pattern,label)=>{try{await promise;}catch(error){assert.match(String(error.message),pattern,label);return error;}assert.fail(label+': expected a rejection');};
try{
 // Test-only: the confirm trigger needs a Chat turn and a published site per row; tests/directories.mjs covers that path.
 await run('DROP TRIGGER directory_review_confirm');

 // Every family: the generated read, receipt insert and guarded delete compile and bind (15 / 15 / 2 parameters) and touch nothing.
 assert.equal(T.reviewFamilyNames.length,21);
 for(const name of T.reviewFamilyNames){
  const sql=T.turnoverSql(name);
  assert.deepEqual((await raw.prepare(sql.read).bind('absent',1).all()).results,[],name);
  assert.equal((await raw.prepare(sql.insert).bind(name,'x','u','p','change','t','applied',hex('a'),hex('b'),null,'c',now(),hex('c'),'x','applied').run()).meta.changes,0,name+' insert');
  assert.equal((await raw.prepare(sql.remove).bind('absent',name).run()).meta.changes,0,name+' delete');
 }

 // Eligible rows leave with verified receipts; everything else survives.
 const a=await owner(),b=await owner(),pa=await project(a),pb=await project(b);
 const pub=await review(a,pa,'publish');                                   // live snapshot: referenced
 const applied=[];for(let n=0;n<28;n++)applied.push(await review(a,pa,'edit'));
 const stale=[await review(a,pa,'edit',{status:'pending',expires:past}),await review(a,pa,'edit',{status:'pending',expires:past})];
 const pending=[await review(a,pa,'edit',{status:'pending',expires:future()}),await review(a,pa,'edit',{status:'pending',expires:future()})];
 const w1=await review(a,pa,'unpublish',{status:'pending',expires:new Date(Date.now()+590000).toISOString()}),w2=await review(a,pa,'unpublish',{status:'pending',expires:future()}); // superseded: no grace
 const other=await review(b,pb,'edit',{status:'pending',expires:past}); // another owner's row is outside this scope
 assert.equal((await one('SELECT live_review_id FROM directories WHERE project_id=?',pa)).live_review_id,pub.id);
 const sealed=await seal({family:'directory_reviews',user:a},pa);
 // 29 applied non-withdrawal rows: the newest 25 stay in the window, the live publish row stays, so 3 leave, plus 2 expired and 1 superseded withdrawal.
 assert.equal(sealed,3+2+1);
 for(const r of applied.slice(0,3))assert.equal(await present('directory_reviews',r.id),false,'oldest applied rows are compacted');
 assert.equal(await present('directory_reviews',pub.id),true,'the live snapshot survives');
 for(const r of applied.slice(3))assert.equal(await present('directory_reviews',r.id),true,'the newest 25 survive');
 for(const r of pending)assert.equal(await present('directory_reviews',r.id),true,'pending rows survive');
 assert.equal(await present('directory_reviews',w2.id),true,'the newest withdrawal survives');
 assert.equal(await present('directory_reviews',other.id),true,'another owner is not touched by this scope');
 for(const [r,outcome] of [[stale[0],'expired'],[stale[1],'expired'],[w1,'superseded']]){
  assert.equal(await present('directory_reviews',r.id),false);
  const verified=await T.readReviewReceipt(raw,'directory_reviews',r.id,a);
  assert.equal(verified.outcome,outcome);assert.equal(verified.projectId,pa);
 }
 assert.equal((await T.readReviewReceipt(raw,'directory_reviews',applied[0].id,a)).outcome,'applied');
 assert.equal(await T.readReviewReceipt(raw,'directory_reviews',applied[0].id,b),null,'a receipt answers only its owner');
 assert.equal(await seal({family:'directory_reviews',user:a},pa),0,'a second pass finds nothing');

 // The batch is bounded: 230 eligible rows leave 200 at a time.
 const c=await owner(),pc=await project(c);
 for(let n=0;n<230;n++)await review(c,pc,'edit',{status:'pending',expires:past});
 assert.equal(await seal({family:'directory_reviews',user:c},pc),T.turnoverPolicy.turnoverBatch);
 assert.equal(await count('SELECT count(*) n FROM directory_reviews WHERE project_id=?',pc),30);
 assert.equal(await seal({family:'directory_reviews',user:c},pc),30);
 assert.equal(await count('SELECT count(*) n FROM review_receipts WHERE project_id=?',pc),230);

 // The deleting statement re-checks holds itself: a hold placed after the candidates were read keeps every row and writes no receipt.
 const d=await owner(),pd=await project(d),rows=[];
 for(let n=0;n<3;n++)rows.push(await review(d,pd,'edit',{status:'pending',expires:past}));
 const statements=await seal({family:'directory_reviews',user:d},pd,true);
 assert.equal(statements.length,4);
 const release=await hold(d,pd);
 await raw.batch(statements);
 for(const r of rows)assert.equal(await present('directory_reviews',r.id),true,'a held row survives a stale read');
 assert.equal(await count('SELECT count(*) n FROM review_receipts WHERE project_id=?',pd),0,'and no receipt is written for it');
 assert.equal(await seal({family:'directory_reviews',user:d},pd),0,'a held project is never selected');
 await T.maintainReviews(raw);
 for(const r of rows)assert.equal(await present('directory_reviews',r.id),true,'the daily pass leaves it too');
 await release();
 assert.equal(await seal({family:'directory_reviews',user:d},pd),3,'release restores ordinary compaction');

 // The daily pass compacts idle projects without any admission, and a bounded 200 per scope per run.
 const e=await owner(),pe=await project(e),idle=[];
 for(let n=0;n<205;n++)idle.push(await review(e,pe,'edit',{status:'pending',expires:past}));
 const survivor=await review(e,pe,'edit',{status:'pending',expires:future()});
 await T.maintainReviews(raw);
 assert.equal(await count('SELECT count(*) n FROM directory_reviews WHERE project_id=?',pe),6,'one pass compacts a batch of 200');
 await T.maintainReviews(raw);
 assert.equal(await count('SELECT count(*) n FROM directory_reviews WHERE project_id=?',pe),1);
 assert.equal(await present('directory_reviews',survivor.id),true);

 // A tampered receipt fails closed instead of answering a retry (SQLite only shape-checks the seal).
 const sample=applied[0];
 assert.ok((await T.compactedReview(raw,'directory_reviews',sample.id,a,(s,msg)=>Object.assign(Error(msg),{status:s}))).message.includes('already applied'));
 const mismatch=await T.compactedReview(raw,'directory_reviews',sample.id,a,(s,msg)=>Object.assign(Error(msg),{status:s}),hex('9'));
 assert.equal(mismatch.status,409);assert.match(mismatch.message,/different request/);
 await run('DROP TRIGGER review_receipt_immutable');
 await run('UPDATE review_receipts SET payload_digest=? WHERE family=? AND id=?',hex('9'),'directory_reviews',sample.id);
 const tampered=await T.compactedReview(raw,'directory_reviews',sample.id,a,(s,msg)=>Object.assign(Error(msg),{status:s}));
 assert.equal(tampered.status,503);assert.match(tampered.message,/integrity/);
 await fail(T.readReviewReceipt(raw,'directory_reviews',sample.id,a),/integrity/);
 await run('UPDATE review_receipts SET payload_digest=? WHERE family=? AND id=?',hex('a'),'directory_reviews',sample.id);
 await run('UPDATE review_receipts SET seal=? WHERE family=? AND id=?',hex('9'),'directory_reviews',sample.id);
 await fail(T.readReviewReceipt(raw,'directory_reviews',sample.id,a),/integrity/);

 // Receipts leave after the replay horizon, never inside it and never inside a safety hold.
 await run('DROP TRIGGER review_receipt_bind');
 const oldAt=new Date(Date.now()-31*86400000).toISOString(),recentAt=new Date(Date.now()-29*86400000).toISOString();
 const base=(rid,p,u,at)=>run("INSERT INTO review_receipts(family,id,owner_user_id,project_id,kind,target,outcome,payload_digest,request_hash,confirmed_by,applied_at,lifecycle_class,sealed_at,seal) VALUES('directory_reviews',?,?,?,'change',?,'expired',?,?,NULL,NULL,'directories',?,?)",rid,u,p,p,hex('a'),hex('b'),at,hex('c'));
 const g=await owner(),pg=await project(g),h=await owner(),ph=await project(h);
 const oldA=id(),oldB=id(),recent=id(),heldOld=id();
 await base(oldA,pg,g,oldAt);await base(oldB,pg,g,oldAt);await base(recent,pg,g,recentAt);await base(heldOld,ph,h,oldAt);
 const releaseHeld=await hold(h,ph);
 await T.maintainReviews(raw);
 assert.equal(await count("SELECT count(*) n FROM review_receipts WHERE id IN (?,?)",oldA,oldB),0,'receipts past the horizon leave');
 assert.equal(await count('SELECT count(*) n FROM review_receipts WHERE id=?',recent),1,'inside the horizon they stay');
 assert.equal(await count('SELECT count(*) n FROM review_receipts WHERE id=?',heldOld),1,'inside a hold they stay');
 await releaseHeld();await T.maintainReviews(raw);
 assert.equal(await count('SELECT count(*) n FROM review_receipts WHERE id=?',heldOld),0,'after release they go');
 assert.equal(await T.readReviewReceipt(raw,'directory_reviews',recent,g).catch(()=>'integrity'),'integrity','a receipt with a bad seal never answers');
 assert.equal(await count("SELECT count(*) n FROM review_receipts WHERE id=?",stale[0].id),1,'receipts of this run are still inside the horizon');

 // A real admission seals the caller's eligible rows in its own batch, and a retry returns the original outcome.
 const owner1=await (async()=>{const user=id(),authority=await workspaceFixture(raw,m,user);return {user,scope:await authority.scope()};})();
 await paidPlan(raw,owner1.user,'business-pro');
 const service={fetch:async(_url,init)=>Response.json({ok:true,value:JSON.parse(init.body).input})};
 const config={title:'Estimate your order',description:'Try a quantity.',buttonLabel:'Calculate',fields:[{key:'quantity',label:'Quantity',type:'number'}]};
 const {sendChat,readChat}=m,{saveBackend,testBackend}=m.backend,{prepareBackendPublication,confirmBackendPublication}=m.backendPublication,{prepareBackendForm:prepare,confirmBackendForm:confirm}=m.backendForms;
 const chat=async content=>{const state=await readChat(owner1.scope,owner1.user),turn=id(),result=await sendChat(owner1.scope,owner1.user,{id:turn,revision:state.state.revision,content},undefined,{backendRuntime:service});assert.equal(result.status,200,JSON.stringify(result));return turn;};
 const {project:formProject,version}=await createFixtureProject(owner1.scope,owner1.user,'Synthetic','Synthetic turnover fixture');
 await chat('/confirm '+await chat('/publish '+version));
 const backend=id(),testRun=id();
 await saveBackend(owner1.scope,owner1.user,formProject,backend,'export default x=>x');await testBackend(owner1.scope,service,owner1.user,formProject,backend,testRun,{});
 const publication=id();await prepareBackendPublication(owner1.scope,owner1.user,formProject,publication,'publish',backend,testRun);await confirmBackendPublication(owner1.scope,owner1.user,publication);
 // Test-only: the immutability trigger forbids moving expiry. Applied reviews are aged past the one-hour grace, oldest first, so they
 // leave the 25-row history window in order.
 await run('DROP TRIGGER backend_form_immutable');
 const applyAged=async n=>{const next=id();await prepare(owner1.scope,owner1.user,formProject,next,config);await confirm(owner1.scope,owner1.user,next);await run('UPDATE backend_form_reviews SET expires_at=? WHERE id=?',new Date(Date.parse(past)+n*1000).toISOString(),next);return next;};
 const first=await applyAged(0);
 for(let n=1;n<=26;n++)await applyAged(n);
 // Each admission already sealed what the previous ones pushed out of the 25-row window, so the oldest applied review is gone.
 assert.equal(await present('backend_form_reviews',first),false,'admissions compact the caller\'s own aged-out applied review');
 assert.equal((await receipt('backend_form_reviews',first)).outcome,'applied');
 // An expired pending review is the second retry case.
 const lapsed=id();await prepare(owner1.scope,owner1.user,formProject,lapsed,config);
 await run('UPDATE backend_form_reviews SET expires_at=? WHERE id=?',past,lapsed);
 const before=await count('SELECT count(*) n FROM review_receipts WHERE family=?','backend_form_reviews');
 const admitted=id();await prepare(owner1.scope,owner1.user,formProject,admitted,config);
 assert.equal(await present('backend_form_reviews',admitted),true,'the admitted review exists');
 assert.equal(await present('backend_form_reviews',lapsed),false,'and the expired one');
 assert.equal(await count('SELECT count(*) n FROM review_receipts WHERE family=?','backend_form_reviews'),before+1);
 assert.equal((await receipt('backend_form_reviews',lapsed)).outcome,'expired');
 // Retries inside the replay horizon: the original outcome, and no new review row is created.
 const confirmed=await fail(confirm(owner1.scope,owner1.user,first),/already applied/,'a retried confirmation reports the original outcome');assert.equal(confirmed.status,409);
 await fail(confirm(owner1.scope,owner1.user,lapsed),/expired/,'an expired review stays expired');
 await fail(prepare(owner1.scope,owner1.user,formProject,first,config),/already applied/,'a retried prepare does not make a second review');
 assert.equal(await present('backend_form_reviews',first),false);
 assert.equal((await count("SELECT count(*) n FROM backend_form_reviews WHERE id=? OR id=?",first,lapsed)),0);
 // A review applied moments ago keeps its row through the next admissions (one-hour grace), so a retried confirmation is still idempotent.
 const justApplied=id();await prepare(owner1.scope,owner1.user,formProject,justApplied,config);await confirm(owner1.scope,owner1.user,justApplied);
 await prepare(owner1.scope,owner1.user,formProject,id(),config);
 assert.equal((await confirm(owner1.scope,owner1.user,justApplied)).status,'applied');
 assert.equal(await present('backend_form_reviews',justApplied),true);
 // The window keeps the 25 newest applied reviews, the just-applied one among them.
 assert.equal(await count("SELECT count(*) n FROM backend_form_reviews WHERE project_id=? AND status='applied'",formProject),25);

 // A family with Unix-second expiry and its own request hash: the receipt carries the source hash and a Worker-derived payload digest.
 {
  const turn=await chat('/projects'),requestHash=hex('d');
  await run('DROP TRIGGER composition_plan_admit'); // Test-only: admission needs a pending AI turn; tests/capability-planning covers that path.
  await run("INSERT INTO composition_plans(id,user_id,project_id,request_hash,catalog_digest,plan_json,details_revision,backend_count,backend_revision,extension_scope,expires_at) VALUES(?,?,?,?,?,'{}',0,0,0,'none',unixepoch()-7200)",turn,owner1.user,formProject,requestHash,hex('e'));
  assert.equal(await seal({family:'composition_plans',user:owner1.user},formProject),1);
  const verified=await T.readReviewReceipt(raw,'composition_plans',turn,owner1.user);
  assert.equal(verified.outcome,'expired');assert.equal(verified.requestHash,requestHash);assert.match(verified.payloadDigest,/^[0-9a-f]{64}$/);assert.notEqual(verified.payloadDigest,requestHash);
  const replay=await T.compactedReview(raw,'composition_plans',turn,owner1.user,(status,message)=>Object.assign(Error(message),{status}),requestHash);
  assert.equal(replay.status,409);assert.match(replay.message,/expired/);
  assert.match((await T.compactedReview(raw,'composition_plans',turn,owner1.user,(status,message)=>Object.assign(Error(message),{status}),hex('f'))).message,/different request/);
 }

 // In-flight consent survives: a nomination the owner has consented to is never compacted, even once expired.
 {
  const u=await owner(),p=await project(u),nid=id(),version=id();
  await run("INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,'export default x=>x',?,?)",version,p,hex('a'),now());
  await run('INSERT INTO backend_nominations(id,user_id,version_id,digest,created_at,expires_at) VALUES(?,?,?,?,?,?)',nid,u,version,hex('a'),now(),future());
  await run("UPDATE backend_nominations SET state='nominated',consent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",nid);
  const lapsedNomination=id(),v2=id();
  await run("INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,'export default y=>y',?,?)",v2,p,hex('a'),now());
  await run('INSERT INTO backend_nominations(id,user_id,version_id,digest,created_at,expires_at) VALUES(?,?,?,?,?,?)',lapsedNomination,u,v2,hex('a'),now(),past);
  assert.equal(await seal({family:'backend_nominations',user:u},null),1,'only the lapsed review leaves');
  assert.equal(await present('backend_nominations',nid),true,'live consent is in flight');
  assert.equal((await T.readReviewReceipt(raw,'backend_nominations',lapsedNomination,u)).outcome,'expired');
  await T.maintainReviews(raw);
  assert.equal(await present('backend_nominations',nid),true);
 }
 console.log('Review turnover passed: 21 families compile, bounded sealed turnover (200 per batch), held/referenced/pending/in-flight rows survive, stale reads cannot delete, retries inside the replay horizon return the original outcome, tampered receipts fail closed, daily pass compacts idle projects and ages receipts out.');
}catch(error){console.error(error.stack??error.message);process.exitCode=1;}
finally{await store.close?.();}
