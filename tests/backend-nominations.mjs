import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());return authority;}
const {prepareNomination,readNomination,consentNomination,withdrawNomination}=m.backendNominations,{saveBackend}=m.backend,{backendAction}=m.backendChat,{sendChat,chatState}=m;
try{
 const id=()=>crypto.randomUUID(),owner=id(),other=id(),project=id(),foreign=id(),version=id(),now=new Date().toISOString();
 for(const [u,p]of[[owner,project],[other,foreign]]){await accountAuthority(u);await db.prepare("INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,'Synthetic',?,?)").bind(p,u,now,now).run();await chatState(scope(u),u);}
 const source='export default input => input; // PRIVATE_SOURCE_CANARY';await saveBackend(scope(owner),owner,project,version,source);const review=id();await assert.rejects(prepareNomination(scope(other),other,id(),version),e=>e.status===404);
 const prepared=await prepareNomination(scope(owner),owner,review,version);assert.equal(prepared.state,'review');assert.equal((await prepareNomination(scope(owner),owner,review,version)).id,review);await assert.rejects(prepareNomination(scope(owner),owner,id(),version),e=>e.status===409);await assert.rejects(readNomination(scope(other),other,review),e=>e.status===404);await assert.rejects(consentNomination(scope(owner),owner,review,'nominate'),e=>e.status===400);
 await assert.rejects(db.prepare("UPDATE backend_nominations SET digest=? WHERE id=?").bind('0'.repeat(64),review).run(),/nomination_immutable/);
 const concurrent=await Promise.all([consentNomination(scope(owner),owner,review,'NOMINATE'),consentNomination(scope(owner),owner,review,'NOMINATE')]);assert.ok(concurrent.every(r=>r.state==='nominated'));assert.equal(concurrent[0].consent_at,concurrent[1].consent_at);
 await assert.rejects(withdrawNomination(scope(other),other,review),e=>e.status===404);await withdrawNomination(scope(owner),owner,review);assert.equal((await withdrawNomination(scope(owner),owner,review)).state,'withdrawn');await assert.rejects(consentNomination(scope(owner),owner,review,'NOMINATE'),e=>e.status===409);await assert.rejects(db.prepare("UPDATE backend_nominations SET state='nominated',withdrawn_at=NULL WHERE id=?").bind(review).run(),/nomination_transition/);
 const expired=id();await db.prepare('INSERT INTO backend_nominations(id,user_id,version_id,digest,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(expired,owner,version,prepared.digest,now,'2000-01-01T00:00:00.000Z').run();await assert.rejects(consentNomination(scope(owner),owner,expired,'NOMINATE'),e=>e.status===409);
 async function chat(content,u=owner){const state=await chatState(scope(u),u),request={id:id(),revision:state.revision,content};assert.equal((await sendChat(scope(u),u,request)).status,200);const saved=await db.prepare('SELECT assistant_text,mode FROM chat_turns WHERE id=?').bind(request.id).first();assert.equal(saved.mode,'guided');assert.ok(!saved.assistant_text.includes('PRIVATE_SOURCE_CANARY'));return {request,text:saved.assistant_text};}
 const c=await chat('/nominate-backend '+version);assert.match(c.text,/permission to review/);assert.equal((await readNomination(scope(owner),owner,c.request.id)).state,'review');await chat('/confirm-backend-nomination '+c.request.id+' NOMINATE');assert.equal((await readNomination(scope(owner),owner,c.request.id)).state,'nominated');await chat('/withdraw-backend-nomination '+c.request.id);assert.equal((await readNomination(scope(owner),owner,c.request.id)).state,'withdrawn');assert.equal((await sendChat(scope(owner),owner,c.request)).status,200);assert.equal((await readNomination(scope(owner),owner,c.request.id)).state,'withdrawn');assert.ok(!(await chat('/backend-nominations',other)).text.includes(version));
 await assert.rejects(backendAction(scope(owner),owner,id(),{type:'backend',operation:'nominate',versionId:version}),/Unsupported|Unknown|Invalid|supported/i);

 // A lost write response must recover the same record, never create a second consent.
 const loseAck=await owners.get(owner).scope(interceptDatabase(db,/^(INSERT INTO backend_nominations|UPDATE backend_nominations)/,async()=>{},async()=>{throw Error('synthetic lost acknowledgment');}));
 const recovered=id();await prepareNomination(loseAck,owner,recovered,version);assert.equal((await consentNomination(loseAck,owner,recovered,'NOMINATE')).state,'nominated');assert.equal((await withdrawNomination(loseAck,owner,recovered)).state,'withdrawn');
 assert.match((await chat('/backend-nominations '+review)).text,/operator-managed/);
 // The database, not a racy application count, admits at most five open records.
 const candidates=[];
 for(let i=0;i<6;i++){const v=id();await saveBackend(scope(other),other,foreign,v,'export default input => input; // '+i);candidates.push(v);}
 for(let i=0;i<4;i++)await prepareNomination(scope(other),other,id(),candidates[i]);
 const competing=await Promise.allSettled(candidates.slice(4).map(v=>prepareNomination(scope(other),other,id(),v)));
 assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(competing.filter(x=>x.status==='rejected'&&x.reason.status===409).length,1);
 // Retained-record bound also applies to closed/expired reviews.
 let retained=(await db.prepare('SELECT COUNT(*) n FROM backend_nominations WHERE user_id=?').bind(owner).first()).n;
 while(retained++<20)await db.prepare('INSERT INTO backend_nominations(id,user_id,version_id,digest,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id(),owner,version,prepared.digest,'1999-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z').run();
 await assert.rejects(prepareNomination(scope(owner),owner,id(),version),e=>e.status===409);
 assert.equal((await db.prepare('SELECT source FROM backend_versions WHERE id=?').bind(version).first()).source,source);assert.equal((await db.prepare('SELECT COUNT(*) n FROM backend_runs').first()).n,0);assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='usage_operations'").first(),null);
 await db.prepare('DELETE FROM projects WHERE id=?').bind(project).run();assert.equal((await db.prepare('SELECT COUNT(*) n FROM backend_nominations WHERE user_id=?').bind(owner).first()).n,0);
 console.log('Private nominations passed: exact-version consent, tenant refusal, immutable digest, expiry, concurrent consent/capacity, lost write acknowledgments, withdrawal/replay, guided Chat privacy, model denial, no execution/spend and deletion cascade.');
}finally{await store.close();}
