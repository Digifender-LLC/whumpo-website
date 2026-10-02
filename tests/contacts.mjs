import {currentSiteFixtureHandlers,createFixtureWebsite,changeFixtureWebsite} from './current-site-fixture.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());return authority;}
const {sendChat,readChat,contactPage,host,prepareSiteAction,siteContext}=m,{activeContact,saveContact,contactInbox,deleteContact,cleanupContacts}=m.contacts;
const now=()=>new Date().toISOString();
async function account(){const id=crypto.randomUUID(),project=crypto.randomUUID();await accountAuthority(id);await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden fixture','Testing','draft',?,?)").bind(project,id,now(),now()).run();await readChat(scope(id),id);return {id,project};}
async function chat(a,content,database=scope(a.id)){const state=await readChat(scope(a.id),a.id),input={id:crypto.randomUUID(),revision:state.state.revision,content};return {id:input.id,input,result:await sendChat(database,a.id,input)};}
async function publish(a){const head=await db.prepare('SELECT revision FROM project_spec_heads WHERE project_id=?').bind(a.project).first();const v={id:head?await changeFixtureWebsite(scope(a.id),a.id,a.project,[{type:'content.replace',contentId:'headline',text:'Garden revision '+(head.revision+1)}]):await createFixtureWebsite(scope(a.id),a.id,a.project,{name:'Garden',headline:'Garden',description:'Testing',theme:'ocean',aboutTitle:'About',aboutText:'Testing',sections:[],photos:[]})},r=await chat(a,'/publish '+v.id);assert.equal((await chat(a,'/confirm '+r.id)).result.status,200);return v.id;}
async function enable(a){const r=await chat(a,'/contact-on '+a.project);assert.equal((await chat(a,'/confirm-contact '+r.id)).result.status,200);return (await activeContact(db,a.project)).revision;}
const msg=()=>({id:crypto.randomUUID(),name:'Visitor <script>',email:'visitor@example.com',message:'Private message: do not send this to AI.'});
try{
 const a=await account(),b=await account();await chat(a,'/contact-on '+a.project);assert.equal(await activeContact(db,a.project),null);await publish(a);
 const review=await chat(a,'/contact-on '+a.project);assert.equal(await activeContact(db,a.project),null);await chat(b,'/confirm-contact '+review.id);assert.equal(await activeContact(db,a.project),null);
 const confirmation=await chat(a,'/confirm-contact '+review.id);assert.equal(confirmation.result.status,200);const revision=(await activeContact(db,a.project)).revision;
 assert.equal((await sendChat(scope(a.id),a.id,confirmation.input)).status,200);assert.equal((await activeContact(db,a.project)).revision,revision);
 const m=msg();await Promise.all([saveContact(db,a.project,revision,m),saveContact(db,a.project,revision,m)]);assert.equal((await contactInbox(scope(a.id),a.id,a.project)).messages.length,1);
 await assert.rejects(contactInbox(scope(b.id),b.id,a.project),e=>e.status===404);await deleteContact(scope(b.id),b.id,m.id);assert.equal((await contactInbox(scope(a.id),a.id,a.project)).messages.length,1);
 await assert.rejects(saveContact(db,a.project,revision,{...m,message:'other'}),e=>e.status===409);
 await deleteContact(scope(a.id),a.id,m.id);await saveContact(db,a.project,revision,m);assert.equal((await contactInbox(scope(a.id),a.id,a.project)).messages.length,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM contact_receipts WHERE id=?').bind(m.id).first()).n,1);
 const request=new Request('https://'+a.project+'.whumpo.site'),page=await host.fetch(request,store.env);assert.match(await page.text(),new RegExp('https://whumpo.com/contact/'+a.project));assert.match(page.headers.get('content-security-policy'),/allow-popups-to-escape-sandbox/);
 const env={...store.env,ENVIRONMENT:'test',TURNSTILE_SECRET:'fixture',TURNSTILE_SITE_KEY:'fixture',API_LIMITER:{limit:async()=>({success:true})}};
 const url='https://whumpo.com/contact/'+a.project;
 const form=await contactPage(new Request(url),env,a.project);assert.equal(form.status,200);const formHTML=await form.text();assert.match(formHTML,/data-action="contact"/);if(process.env.WHUMPO_FORM_FIXTURE)await writeFile(process.env.WHUMPO_FORM_FIXTURE,formHTML);assert.ok(!formHTML.includes('Private message:'));
 const payload={...msg(),revision:String(revision),'cf-turnstile-response':'fixture'};
 const post=(data=payload,origin='https://whumpo.com')=>new Request(url,{method:'POST',headers:{origin},body:new URLSearchParams(data)});
 let calls=0;const good=async(_url,options)=>{if(options)assert.equal(options.redirect,'manual');calls++;return Response.json({success:true,hostname:'whumpo.com',action:'contact',cdata:a.project});};
 assert.equal((await contactPage(post(payload,'https://evil.example'),env,a.project,good)).status,403);assert.equal(calls,0);
 for(const invalid of [{success:false},{success:true,hostname:'evil.example',action:'contact',cdata:a.project},{success:true,hostname:'whumpo.com',action:'register',cdata:a.project},{success:true,hostname:'whumpo.com',action:'contact',cdata:b.project}])assert.equal((await contactPage(post(),env,a.project,async()=>Response.json(invalid))).status,400);
 assert.equal((await contactPage(post({...payload,message:'x'.repeat(40000)}),env,a.project,good)).status,413);
 assert.equal((await contactPage(post(),env,a.project,async()=>new Response('x'.repeat(9000)))).status,503);
 assert.equal((await contactPage(post(),env,a.project,async()=>new Response(null,{status:302,headers:{location:'https://example.org'}}))).status,503);
 assert.equal((await contactPage(post(),env,a.project,good)).status,200);assert.equal((await contactInbox(scope(a.id),a.id,a.project)).messages.length,1);
 const history=JSON.stringify(await readChat(scope(a.id),a.id)),context=JSON.stringify(await siteContext(scope(a.id),a.id));assert.ok(!history.includes(payload.message));assert.ok(!context.includes(payload.message));
 if(process.env.WHUMPO_INBOX_FIXTURE)await writeFile(process.env.WHUMPO_INBOX_FIXTURE,JSON.stringify({inbox:await contactInbox(scope(a.id),a.id,a.project),chat:await readChat(scope(a.id),a.id),project:a.project}));
 // Publication changes revoke both visible link and intake, including an in-flight verified request.
 const stale=msg();await publish(a);assert.equal(await activeContact(db,a.project),null);await assert.rejects(saveContact(db,a.project,revision,stale),e=>e.status===409);assert.equal((await contactPage(new Request(url),env,a.project)).status,404);assert.ok(!(await (await host.fetch(request,store.env)).text()).includes('/contact/'));
 // Stale publication review cannot enable a newer publication.
 const staleReview=await chat(a,'/contact-on '+a.project);await publish(a);assert.equal((await chat(a,'/confirm-contact '+staleReview.id)).result.status,409);assert.equal(await activeContact(db,a.project),null);
 const newer=await enable(a);const disabling=await chat(a,'/contact-off '+a.project);const inflight=post({...msg(),revision:String(newer),'cf-turnstile-response':'fixture'});
 const stopDuringVerification=async()=>{await chat(a,'/confirm-contact '+disabling.id);return good();};assert.equal((await contactPage(inflight,env,a.project,stopDuringVerification)).status,409);
 // Per-project hour cap is atomic and deletion does not recycle it.
 const rev=await enable(a);const accepted=await db.prepare('SELECT COUNT(*) n FROM contact_receipts WHERE project_id=?').bind(a.project).first();for(let i=accepted.n;i<19;i++)await saveContact(db,a.project,rev,msg());
 const racing=await Promise.allSettled([saveContact(db,a.project,rev,msg()),saveContact(db,a.project,rev,msg())]);assert.equal(racing.filter(r=>r.status==='fulfilled').length,1);assert.equal(racing.find(r=>r.status==='rejected').reason.status,429);
 const all=await contactInbox(scope(a.id),a.id,a.project);await deleteContact(scope(a.id),a.id,all.messages[0].id);await assert.rejects(saveContact(db,a.project,rev,msg()),e=>e.status===429);
 // Model can prepare a review, not enable a form or read visitor content.
 const ctx=await siteContext(scope(a.id),a.id);const proposal=await prepareSiteAction(scope(a.id),a.id,crypto.randomUUID(),JSON.stringify({reply:'Enabled!',action:{kind:'contactReview',projectId:a.project,enabled:false}}),ctx);assert.match(proposal.reply,/Nothing changes/);
 for(const action of [{kind:'contactReview',projectId:a.project,enabled:true,confirm:true},{kind:'confirmContact',reviewId:review.id},{kind:'readInbox',projectId:a.project}])await assert.rejects(prepareSiteAction(scope(a.id),a.id,crypto.randomUUID(),JSON.stringify({reply:'Done',action}),ctx));
 // Quotas use receipt capacity, including deleted messages, and cover the whole platform.
 const cap=await account();await publish(cap);const caprev=await enable(cap);
 async function receipt(project){return db.prepare('INSERT INTO contact_receipts(id,project_id,request_hash,created_at,expires_at) VALUES(?,?,?, ?,?)').bind(crypto.randomUUID(),project,'fixture','2026-01-01',new Date(Date.now()+86400000).toISOString());}
 await db.batch(await Promise.all(Array.from({length:100},()=>receipt(cap.project))));await assert.rejects(saveContact(db,cap.project,caprev,msg()),e=>e.status===429);
 const count=(await db.prepare('SELECT COUNT(*) n FROM contact_receipts').first()).n;
 for(let n=count;n<1000;n+=50)await db.batch(await Promise.all(Array.from({length:Math.min(50,1000-n)},()=>receipt(b.project))));
 await publish(b);const brev=await enable(b);await assert.rejects(saveContact(db,b.project,brev,msg()),e=>e.status===429);
 await db.prepare('DELETE FROM users WHERE id=?').bind(cap.id).run();await db.prepare('DELETE FROM contact_receipts WHERE project_id=?').bind(b.project).run();
 // An expired review cannot be confirmed even if it was fresh during the initial read.
 const expiryReview=await chat(a,'/contact-off '+a.project);
 let expired=false;const expiryDB=await owners.get(a.id).scope(interceptDatabase(db,/^UPDATE contact_reviews SET/,async()=>{if(expired)return;expired=true;await db.prepare('DROP TRIGGER contact_review_identity').run();await db.prepare("UPDATE contact_reviews SET expires_at='2000-01-01' WHERE id=?").bind(expiryReview.id).run();}));
 assert.equal((await chat(a,'/confirm-contact '+expiryReview.id,expiryDB)).result.status,409);assert.ok(expired);assert.ok(await activeContact(db,a.project));
 // Time-based visibility and physical cleanup, without putting submitted content into logs.
 await db.prepare('DROP TRIGGER contact_submission_immutable').run();await db.prepare('DROP TRIGGER contact_receipt_immutable').run();await db.prepare("UPDATE contact_submissions SET expires_at='2000-01-01' WHERE project_id=?").bind(a.project).run();await db.prepare("UPDATE contact_receipts SET expires_at='2000-01-01' WHERE project_id=?").bind(a.project).run();assert.equal((await contactInbox(scope(a.id),a.id,a.project)).messages.length,0);await cleanupContacts(db);assert.equal((await db.prepare('SELECT COUNT(*) n FROM contact_submissions').first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM contact_receipts').first()).n,0);
 await db.prepare('DELETE FROM users WHERE id=?').bind(a.id).run();assert.equal(await activeContact(db,a.project),null);
 console.log('Contact checks passed: reviews, tenant boundaries, duplicate/deleted-message replay, public link, Origin/Turnstile/size checks, publication and disable races, atomic rate cap, private inbox isolation, AI restrictions and retention.');
}finally{await store.close();}
