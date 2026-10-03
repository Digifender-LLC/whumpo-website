import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {runUsageReview,usageReviewInput} from '../tools/usage-review-input.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());return authority;}
const {sendAIChat,readChat,sendChat,usageReviews:service}=m;
try{
 async function account(){const id=crypto.randomUUID();await accountAuthority(id);await readChat(scope(id),id);await db.prepare("UPDATE workspace_state SET step='ready' WHERE user_id=?").bind(id).run();return id;}
 const user=await account(),other=await account(),id=crypto.randomUUID(),statement='PRIVATE-REVIEW-STATEMENT: I maintain several client websites.';
 const originalFetch=globalThis.fetch;let dispatches=0;globalThis.fetch=()=>{dispatches++;throw Error('Review must not invoke a model');};
 async function request(owner,content,key=crypto.randomUUID(),database=scope(owner)){const chat=await readChat(scope(owner),owner);return {input:{id:key,revision:chat.state.revision,content},result:await sendChat(database,owner,{id:key,revision:chat.state.revision,content},{baseURL:'https://invalid.test/v1',apiKey:'unused',model:'fixture'})};}
 try{
 const submitted=await request(user,'request a usage review: '+statement,id);assert.equal(submitted.result.status,200);assert.equal((await service.readUsageReviewRequest(scope(user),user,id)).statement,statement);assert.equal((await sendChat(scope(user),user,submitted.input)).status,200);assert.equal((await service.listUsageReviewRequests(scope(user),user)).length,1);
 assert.equal((await request(user,'/usage-review another explanation')).result.status,409);assert.equal(await service.readUsageReviewRequest(scope(other),other,id),null);assert.equal((await request(other,'/usage-reviews '+id)).result.status,404);
 assert.equal((await db.prepare('SELECT ai_context_allowed FROM chat_turns WHERE id=?').bind(id).first()).ai_context_allowed,0);await assert.rejects(()=>db.prepare('UPDATE chat_turns SET ai_context_allowed=1 WHERE id=?').bind(id).run(),/private_chat_context/);
 await assert.rejects(()=>db.prepare("UPDATE usage_review_requests SET statement='changed' WHERE id=?").bind(id).run(),/immutable/);
 const response='PRIVATE-OPERATOR-REPLY: This request does not change limits.',input={action:'answer',account:user,id,response,operator:'PRIVATE-OPERATOR-IDENTITY'};
 const preview=await runUsageReview(service,db,input);assert.equal(preview.preview,true);assert.equal((await service.readUsageReviewRequest(scope(user),user,id)).state,'open');await assert.rejects(()=>runUsageReview(service,db,{...input,response:'Changed reply'},preview.applyDigest));
 const outcomes=await Promise.allSettled([runUsageReview(service,db,input,preview.applyDigest),service.answerUsageReview(db,user,id,'Competing reply','other operator')]);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 const saved=await service.readUsageReviewRequest(scope(user),user,id);const winner=saved.public_response===response?input:{...input,response:'Competing reply',operator:'other operator'};const same=await service.answerUsageReview(db,user,id,winner.response,winner.operator);assert.equal(same.replayed,true);assert.ok(!JSON.stringify(saved).includes('answered_by'));assert.ok(!JSON.stringify(saved).includes('PRIVATE-OPERATOR-IDENTITY'));
 const status=await request(user,'show my usage reviews');assert.equal(status.result.status,200);assert.equal((await db.prepare('SELECT ai_context_allowed FROM chat_turns WHERE id=?').bind(status.input.id).first()).ai_context_allowed,0);
 const detail=await request(user,'/usage-reviews '+id);const visible=await db.prepare('SELECT assistant_text,ai_context_allowed FROM chat_turns WHERE id=?').bind(detail.input.id).first();assert.ok(visible.assistant_text.includes(winner.response));assert.ok(!visible.assistant_text.includes('PRIVATE-OPERATOR-IDENTITY'));assert.equal(visible.ai_context_allowed,0);
 assert.equal(dispatches,0);assert.equal((await db.prepare('SELECT requested_mode FROM fair_use_control WHERE id=1').first()).requested_mode,'monitor');assert.equal((await db.prepare('SELECT COUNT(*) n FROM inference_calls').first()).n,0);
 // A committed submission whose response is lost is recovered by exact replay.
 const next=crypto.randomUUID();let lost=false;const flaky=await owners.get(user).scope(interceptDatabase(db,/^INSERT INTO usage_review_requests/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Synthetic lost acknowledgment');}}));
 const before=await readChat(scope(user),user),retry={id:next,revision:before.state.revision,content:'/usage-review Follow-up private explanation'};assert.equal((await sendChat(flaky,user,retry)).status,200);assert.equal(lost,true);assert.equal((await sendChat(scope(user),user,retry)).status,200);assert.equal((await service.listUsageReviewRequests(scope(user),user)).length,2);
 }finally{globalThis.fetch=originalFetch;}
 // Actual AI transport must not receive the customer review or operator response.
 const chat=await readChat(scope(user),user);let calls=0;await sendAIChat(scope(user),user,crypto.randomUUID(),chat.state.revision,'Help plan my homepage',{baseURL:'https://provider.test/v1',apiKey:'synthetic',model:'fixture',protocol:'responses'},async(_url,init)=>{calls++;const body=JSON.stringify(JSON.parse(init.body));for(const secret of ['PRIVATE-REVIEW','PRIVATE-OPERATOR','Competing reply','Follow-up private explanation'])assert.ok(!body.includes(secret),secret);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'What should visitors find?',action:null})}]}],usage:{input_tokens:100,output_tokens:100}});});assert.equal(calls,1);
 assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='usage_operations'").first(),null);
 // No internal fair-use evidence or mode was edited; account deletion cascades.
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM fair_use_reviews').first()).n,0);await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();assert.equal((await service.listUsageReviewRequests(db,user)).length,0);
 for(const bad of [{action:'answer',account:other,id:crypto.randomUUID(),response:'x',operator:'y',private_note:'no'},{action:'list',account:[other]}])assert.throws(()=>usageReviewInput(JSON.stringify(bad)));
 console.log('Usage reviews passed: internal support submission/read, one-open bound, tenant isolation, immutable private context, no inference on support requests, preview-bound operator response, racing responses, replay/lost acknowledgment, provider-context exclusion, unchanged Monitor/billing/internal evidence and account-deletion cascade.');
}finally{await store.close();}
