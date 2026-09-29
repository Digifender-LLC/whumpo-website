import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendChat,readChat}=await module('src/chat.ts'),{activeContact,saveContact,contactInbox,deleteContact,cleanupContacts}=await module('src/contacts.ts'),{contactPage}=await module('src/contact-page.ts'),{default:host}=await module('src/site-host.ts'),{prepareSiteAction,siteContext}=await module('src/site-agent.ts');
const dir=await mkdtemp('/tmp/whumpo-contacts-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const now=()=>new Date().toISOString();
async function account(){const id=crypto.randomUUID(),project=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'fixture',?)").bind(id,id+'@example.com','00',now()).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden fixture','Testing','draft',?,?)").bind(project,id,now(),now()).run();await readChat(db,id);return {id,project};}
async function chat(a,content,database=db){const state=await readChat(db,a.id),input={id:crypto.randomUUID(),revision:state.state.revision,content};return {id:input.id,input,result:await sendChat(database,a.id,input)};}
async function publish(a){const v=await chat(a,'/build ocean '+a.project),r=await chat(a,'/publish '+v.id);assert.equal((await chat(a,'/confirm '+r.id)).result.status,200);return v.id;}
async function enable(a){const r=await chat(a,'/contact-on '+a.project);assert.equal((await chat(a,'/confirm-contact '+r.id)).result.status,200);return (await activeContact(db,a.project)).revision;}
const msg=()=>({id:crypto.randomUUID(),name:'Visitor <script>',email:'visitor@example.com',message:'Private message: do not send this to AI.'});
try{
 const a=await account(),b=await account();await chat(a,'/contact-on '+a.project);assert.equal(await activeContact(db,a.project),null);await publish(a);
 const review=await chat(a,'/contact-on '+a.project);assert.equal(await activeContact(db,a.project),null);await chat(b,'/confirm-contact '+review.id);assert.equal(await activeContact(db,a.project),null);
 const confirmation=await chat(a,'/confirm-contact '+review.id);assert.equal(confirmation.result.status,200);const revision=(await activeContact(db,a.project)).revision;
 assert.equal((await sendChat(db,a.id,confirmation.input)).status,200);assert.equal((await activeContact(db,a.project)).revision,revision);
 const m=msg();await Promise.all([saveContact(db,a.project,revision,m),saveContact(db,a.project,revision,m)]);assert.equal((await contactInbox(db,a.id,a.project)).messages.length,1);
 await assert.rejects(contactInbox(db,b.id,a.project),e=>e.status===404);await deleteContact(db,b.id,m.id);assert.equal((await contactInbox(db,a.id,a.project)).messages.length,1);
 await assert.rejects(saveContact(db,a.project,revision,{...m,message:'other'}),e=>e.status===409);
 await deleteContact(db,a.id,m.id);await saveContact(db,a.project,revision,m);assert.equal((await contactInbox(db,a.id,a.project)).messages.length,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM contact_receipts WHERE id=?').bind(m.id).first()).n,1);
 const request=new Request('https://sites.digifender.com/s/'+a.project),page=await host.fetch(request,proxy.env);assert.match(await page.text(),new RegExp('https://digifender.com/contact/'+a.project));assert.match(page.headers.get('content-security-policy'),/allow-popups-to-escape-sandbox/);
 const env={...proxy.env,ENVIRONMENT:'test',TURNSTILE_SECRET:'fixture',TURNSTILE_SITE_KEY:'fixture',API_LIMITER:{limit:async()=>({success:true})}};
 const url='https://digifender.com/contact/'+a.project;
 const form=await contactPage(new Request(url),env,a.project);assert.equal(form.status,200);const formHTML=await form.text();assert.match(formHTML,/data-action="contact"/);if(process.env.WHUMPO_FORM_FIXTURE)await writeFile(process.env.WHUMPO_FORM_FIXTURE,formHTML);assert.ok(!formHTML.includes('Private message:'));
 const payload={...msg(),revision:String(revision),'cf-turnstile-response':'fixture'};
 const post=(data=payload,origin='https://digifender.com')=>new Request(url,{method:'POST',headers:{origin},body:new URLSearchParams(data)});
 let calls=0;const good=async(_url,options)=>{if(options)assert.equal(options.redirect,'manual');calls++;return Response.json({success:true,hostname:'digifender.com',action:'contact',cdata:a.project});};
 assert.equal((await contactPage(post(payload,'https://evil.example'),env,a.project,good)).status,403);assert.equal(calls,0);
 for(const invalid of [{success:false},{success:true,hostname:'evil.example',action:'contact',cdata:a.project},{success:true,hostname:'digifender.com',action:'register',cdata:a.project},{success:true,hostname:'digifender.com',action:'contact',cdata:b.project}])assert.equal((await contactPage(post(),env,a.project,async()=>Response.json(invalid))).status,400);
 assert.equal((await contactPage(post({...payload,message:'x'.repeat(40000)}),env,a.project,good)).status,413);
 assert.equal((await contactPage(post(),env,a.project,async()=>new Response('x'.repeat(9000)))).status,503);
 assert.equal((await contactPage(post(),env,a.project,async()=>new Response(null,{status:302,headers:{location:'https://example.org'}}))).status,503);
 assert.equal((await contactPage(post(),env,a.project,good)).status,200);assert.equal((await contactInbox(db,a.id,a.project)).messages.length,1);
 const history=JSON.stringify(await readChat(db,a.id)),context=JSON.stringify(await siteContext(db,a.id));assert.ok(!history.includes(payload.message));assert.ok(!context.includes(payload.message));
 if(process.env.WHUMPO_INBOX_FIXTURE)await writeFile(process.env.WHUMPO_INBOX_FIXTURE,JSON.stringify({inbox:await contactInbox(db,a.id,a.project),chat:await readChat(db,a.id),project:a.project}));
 // Publication changes revoke both visible link and intake, including an in-flight verified request.
 const stale=msg();await publish(a);assert.equal(await activeContact(db,a.project),null);await assert.rejects(saveContact(db,a.project,revision,stale),e=>e.status===409);assert.equal((await contactPage(new Request(url),env,a.project)).status,404);assert.ok(!(await (await host.fetch(request,proxy.env)).text()).includes('/contact/'));
 // Stale publication review cannot enable a newer publication.
 const staleReview=await chat(a,'/contact-on '+a.project);await publish(a);assert.equal((await chat(a,'/confirm-contact '+staleReview.id)).result.status,409);assert.equal(await activeContact(db,a.project),null);
 const newer=await enable(a);const disabling=await chat(a,'/contact-off '+a.project);const inflight=post({...msg(),revision:String(newer),'cf-turnstile-response':'fixture'});
 const stopDuringVerification=async()=>{await chat(a,'/confirm-contact '+disabling.id);return good();};assert.equal((await contactPage(inflight,env,a.project,stopDuringVerification)).status,409);
 // Per-project hour cap is atomic and deletion does not recycle it.
 const rev=await enable(a);const accepted=await db.prepare('SELECT COUNT(*) n FROM contact_receipts WHERE project_id=?').bind(a.project).first();for(let i=accepted.n;i<19;i++)await saveContact(db,a.project,rev,msg());
 const racing=await Promise.allSettled([saveContact(db,a.project,rev,msg()),saveContact(db,a.project,rev,msg())]);assert.equal(racing.filter(r=>r.status==='fulfilled').length,1);assert.equal(racing.find(r=>r.status==='rejected').reason.status,429);
 const all=await contactInbox(db,a.id,a.project);await deleteContact(db,a.id,all.messages[0].id);await assert.rejects(saveContact(db,a.project,rev,msg()),e=>e.status===429);
 // Model can prepare a review, not enable a form or read visitor content.
 const ctx=await siteContext(db,a.id);const proposal=await prepareSiteAction(db,a.id,crypto.randomUUID(),JSON.stringify({reply:'Enabled!',action:{kind:'contactReview',projectId:a.project,enabled:false}}),ctx);assert.match(proposal.reply,/Nothing changes/);
 for(const action of [{kind:'contactReview',projectId:a.project,enabled:true,confirm:true},{kind:'confirmContact',reviewId:review.id},{kind:'readInbox',projectId:a.project}])await assert.rejects(prepareSiteAction(db,a.id,crypto.randomUUID(),JSON.stringify({reply:'Done',action}),ctx));
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
 const expiryDB=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{await target.prepare('DROP TRIGGER contact_review_identity').run();await target.prepare("UPDATE contact_reviews SET expires_at='2000-01-01' WHERE id=?").bind(expiryReview.id).run();return target.batch(statements);};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 assert.equal((await chat(a,'/confirm-contact '+expiryReview.id,expiryDB)).result.status,409);assert.ok(await activeContact(db,a.project));
 // Time-based visibility and physical cleanup, without putting submitted content into logs.
 await db.prepare('DROP TRIGGER contact_submission_immutable').run();await db.prepare('DROP TRIGGER contact_receipt_immutable').run();await db.prepare("UPDATE contact_submissions SET expires_at='2000-01-01' WHERE project_id=?").bind(a.project).run();await db.prepare("UPDATE contact_receipts SET expires_at='2000-01-01' WHERE project_id=?").bind(a.project).run();assert.equal((await contactInbox(db,a.id,a.project)).messages.length,0);await cleanupContacts(db);assert.equal((await db.prepare('SELECT COUNT(*) n FROM contact_submissions').first()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM contact_receipts').first()).n,0);
 await db.prepare('DELETE FROM users WHERE id=?').bind(a.id).run();assert.equal(await activeContact(db,a.project),null);
 console.log('Contact checks passed: reviews, tenant boundaries, duplicate/deleted-message replay, public link, Origin/Turnstile/size checks, publication and disable races, atomic rate cap, private inbox isolation, AI restrictions and retention.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
