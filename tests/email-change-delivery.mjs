import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

// WH-202: account and support notices through the shared outbox, over the current schema on SQLite and, with --d1, actual local D1. The REAL trusted
// address-change adapter, store, outbox and cloudflare sender run; the ONLY provider is a function in this file that records what it was asked to send.
// No network, no credential, no live mail: every address is under .test and globalThis.fetch is closed.
const bundle=await build({stdin:{contents:[
 "export {accountEmailRoute,emailChangeDelivery} from './src/email-change/http';export {queueAccountNotices,queueSecurityNotices,accountDeliveryLane} from './src/email-change/notices';",
 "export {runNotificationDelivery,enqueueNotice} from './src/notification-outbox';export {dispatchJobs} from './src/job-dispatcher';export {contactDelivery} from './src/contact-email';",
 "export {supportDelivery,supportDeliveryLane} from './src/support-delivery';export {maintainEmailChanges} from './src/email-change/maintenance';",
 "export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';export {newSessionToken,hashToken} from './src/security';export {addressKey} from './src/email-change/change';",
 ].join(''),resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture(),db=fixture.db;
let network=0;globalThis.fetch=async()=>{network++;throw Error('No network call is permitted');};
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results.map(r=>({...r})),one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const count=async(sql,...v)=>(await one(`SELECT count(*) n FROM ${sql}`,...v)).n;
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const origin='https://whumpo.com',minute=60000,hour=3600000;
let limited=false;const authEnv={AUTH_LIMITER:{limit:async()=>({success:!limited})}};

/** The simulated provider (a `send_email` binding). `mode` is what the next call does; every call is recorded. */
const sent=[];let mode='up';
const binding={send:async message=>{
 sent.push(message);
 const fail=code=>Object.assign(Error('PRIVATE-PROVIDER-ERROR'),{code});
 if(mode==='down')throw fail('E_RATE_LIMIT_EXCEEDED');
 if(mode==='reject')throw fail('E_VALIDATION_ERROR');
 if(mode==='throw')throw Error('PRIVATE-PROVIDER-ERROR');
 if(mode==='lost')return new Promise(()=>{});
 return {messageId:'ref-'+sent.length};
}};
const active={DB:db,CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'review-1',CONTACT_EMAIL:binding};
const delivery=m.emailChangeDelivery(active),live=m.contactDelivery(active);
assert.ok(delivery&&live,'configured delivery is active');
/** One drain through the shared outbox (what the account lane does after its queue step). */
const drain=(at=Date.now(),settings=live.settings)=>m.runNotificationDelivery(db,settings,live.sender,{now:new Date(at),timeoutMs:50});
const owner=async()=>{const o=await workspaceFixture(db,m,id(),-5);o.email=(await one('SELECT email FROM users WHERE id=?',o.account)).email;return o;};
const addr=name=>`${name}-${id().slice(0,8)}@example.test`;
async function call(o,action,body,{method='POST',d=delivery}={}){
 const request=new Request(`${origin}/api/account/email${action?'/'+action:''}`,{method,headers:{origin,'content-type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)});
 const principal=await m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:o.token}),scoped=m.admitWorkspace(db,principal);
 const response=await m.accountEmailRoute(request,authEnv,scoped,principal,{delivery:d});assert.ok(response);
 return {status:response.status,data:await response.json()};
}
const request=(o,address,d=delivery)=>call(o,'change',{version:1,requestId:id(),newAddress:address},{d});
const to=address=>sent.filter(s=>s.to===address);
const tokenOf=message=>message.text.match(/code is ([A-Za-z0-9_-]{43})\n/)?.[1];
const notices=userId=>all('SELECT * FROM notification_notices WHERE user_id=? ORDER BY created_at,template',userId);
const changeRow=changeId=>one('SELECT * FROM owner_email_changes WHERE change_id=?',changeId);
/** Request, deliver and confirm a change so the account holds `address` as a VERIFIED email (the only way verification happens). */
async function verifyAddress(o,address){
 const {data}=await request(o,address),before=sent.length;await drain();
 const message=sent.slice(before).find(s=>s.to===address);assert.ok(message,'the confirmation reached the new address');
 const confirmed=await call(o,'confirm',{version:1,token:tokenOf(message)});assert.equal(confirmed.data.status,'confirmed');
 return data.changeId;
}

try{
 await check('inactive provider: no vars or no binding gives delivery_unavailable and stores nothing',async()=>{
  const a=await owner();
  const cases=[['no binding',{DB:db,CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r'}],['no vars',{DB:db,CONTACT_EMAIL:binding}],['binding without send',{DB:db,CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r',CONTACT_EMAIL:{}}],['unknown provider',{DB:db,CONTACT_NOTIFICATION_PROVIDER:'other',CONTACT_NOTIFICATION_REVIEW:'r',CONTACT_EMAIL:binding}]];
  for(const [name,env] of cases){
   assert.equal(m.emailChangeDelivery(env),null,name);
   const before=[await count('owner_email_changes'),await count('owner_email_change_limits'),await count('notification_notices')];
   const r=await request(a,addr('inactive'),m.emailChangeDelivery(env));
   assert.deepEqual([r.status,r.data],[200,{version:1,status:'delivery_unavailable'}],name);
   assert.deepEqual([await count('owner_email_changes'),await count('owner_email_change_limits'),await count('notification_notices')],before,name);
  }
  assert.equal(sent.length,0,'nothing reached the provider');
  // The support adapter is inactive on its own variables.
  assert.equal(m.supportDelivery({CONTACT_EMAIL:binding}),null);
  assert.equal(m.supportDelivery({SUPPORT_NOTIFICATION_PROVIDER:'cloudflare-email',SUPPORT_NOTIFICATION_REVIEW:'r'}),null,'no binding');
  assert.equal(m.supportDelivery({SUPPORT_NOTIFICATION_PROVIDER:'nope',SUPPORT_NOTIFICATION_REVIEW:'r',CONTACT_EMAIL:binding}),null);
  assert.ok(m.supportDelivery({SUPPORT_NOTIFICATION_PROVIDER:'cloudflare-email',SUPPORT_NOTIFICATION_REVIEW:'r',CONTACT_EMAIL:binding}));
 });

 await check('confirm and undo sends: the new address gets a code, an unverified old address gets nothing, and the token exists only in the provider call',async()=>{
  const a=await owner(),x=addr('new');
  const {status,data}=await request(a,x);assert.equal(status,200);assert.equal(data.status,'pending-confirmation');
  // Queued by the adapter on the shared outbox: only the confirmation. The "requested" notice is for the account's own address, which is unverified.
  const queued=await notices(a.account);assert.equal(queued.length,1);
  const [row]=queued;
  assert.deepEqual([row.scope,row.template,row.event_ref,row.state,row.project_id,row.destination_id],['account-email','account.email-confirm@1',data.changeId,'queued',null,null]);
  assert.equal(row.recipient_ref,await m.addressKey(x),'the recipient is an address hash');
  assert.ok(!JSON.stringify(row).includes(x)&&!(await all('SELECT envelope_json FROM job_journal WHERE id=?',row.job_id)).some(j=>j.envelope_json.includes(x)),'no address in the outbox or journal');
  assert.equal((await changeRow(data.changeId)).token_verifier,null,'no token exists before the attempt commits');
  const r=await drain();assert.equal(r.accepted,1);
  assert.equal(sent.length,1);assert.equal(sent[0].to,x);assert.equal(sent[0].from.email,'notify@whumpo.com');assert.equal(sent[0].subject,'Confirm your new Whumpo account email');
  const token=tokenOf(sent[0]);assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.equal((await changeRow(data.changeId)).token_verifier,await m.hashToken(token),'only the SHA-256 verifier is stored');
  assert.equal((await notices(a.account))[0].state,'accepted');
  // The token is nowhere in any table.
  const tables=(await all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'")).map(t=>t.name);
  for(const table of tables)assert.ok(!JSON.stringify(await all(`SELECT * FROM ${table}`)).includes(token),`the token is not stored in ${table}`);
  // A redelivery pass sends nothing more.
  await drain(Date.now()+minute);assert.equal(sent.length,1);
  // Confirm, then undo. The old address was never verified, so it is told nothing; the new (verified) address is told of the undo.
  const confirmed=await call(a,'confirm',{version:1,token});assert.equal(confirmed.data.status,'confirmed');
  assert.equal((await notices(a.account)).length,1,'no completed notice for an unverified previous address');
  const undone=await call(a,'undo',{version:1,changeId:data.changeId});assert.equal(undone.data.status,'undone');
  const after=await notices(a.account);assert.deepEqual(after.map(n=>n.template).sort(),['account.email-change-undone@1','account.email-confirm@1']);
  await drain();
  assert.equal(to(a.email).length,0,'the unverified old address received nothing');
  assert.deepEqual(to(x).map(s=>s.subject),['Confirm your new Whumpo account email','A Whumpo account email change was undone']);
  assert.ok(sent.every(s=>!s.text.includes(token)||s.subject.startsWith('Confirm')),'only the confirmation carries the code');
 });

 await check('a verified old address is told: requested, completed and undone go to it, and the new address gets the confirmation and the undo',async()=>{
  const b=await owner(),y1=addr('first'),y2=addr('second');
  await verifyAddress(b,y1);
  const start=sent.length;
  const {data}=await request(b,y2);
  assert.deepEqual((await notices(b.account)).filter(n=>n.event_ref===data.changeId).map(n=>[n.template,n.recipient_ref===null?'account':'ref']).sort(),[['account.email-change-requested@1','account'],['account.email-confirm@1','ref']]);
  await drain();
  assert.deepEqual(sent.slice(start).map(s=>[s.to,s.subject]).sort(),[[y1,'A change to your Whumpo account email was requested'],[y2,'Confirm your new Whumpo account email']]);
  const token=tokenOf(sent.slice(start).find(s=>s.to===y2));
  assert.ok(!sent.slice(start).find(s=>s.to===y1).text.includes(token)&&!sent.slice(start).find(s=>s.to===y1).text.includes(y2),'the old address sees no token and no new address');
  const mark=sent.length;
  await call(b,'confirm',{version:1,token});await drain();
  assert.deepEqual(sent.slice(mark).map(s=>[s.to,s.subject]),[[y1,'Your Whumpo account email was changed']]);
  const mark2=sent.length;
  await call(b,'undo',{version:1,changeId:data.changeId});await drain();
  assert.deepEqual(sent.slice(mark2).map(s=>s.to).sort(),[y1,y2].sort());
  assert.ok(sent.slice(mark2).every(s=>s.subject==='A Whumpo account email change was undone'));
  // A replay of the same event queues nothing new (one notice per template, event and recipient).
  const rows=await count('notification_notices WHERE user_id=?',b.account);
  await m.queueAccountNotices(db,[{kind:'change-undone',changeId:data.changeId,to:y1}],{accountId:b.account,eventRef:data.changeId,now:Date.now()});
  assert.equal(await count('notification_notices WHERE user_id=?',b.account),rows);
 });

 await check('a lost reply never double-sends: the confirmation becomes unknown-outcome and is not resent',async()=>{
  const a=await owner(),x=addr('lost');
  const {data}=await request(a,x);mode='lost';const before=sent.length;
  try{const r=await drain();assert.equal(r.failed,1);}finally{mode='up';}
  assert.equal(sent.length-before,1);
  const [n]=await notices(a.account);assert.deepEqual([n.state,n.reason],['unknown-outcome','uncertain']);
  const verifier=(await changeRow(data.changeId)).token_verifier;assert.match(verifier,/^[0-9a-f]{64}$/,'the minted verifier stays: the code may have arrived');
  for(const at of [Date.now()+minute,Date.now()+hour,Date.now()+2*hour])await drain(at);
  assert.equal(sent.length-before,1,'no blind retry on any later pass');
  assert.equal((await notices(a.account))[0].state,'unknown-outcome');
  // A thrown error is held the same way.
  const b=await owner();await request(b,addr('throws'));mode='throw';const mark=sent.length;
  try{await drain();await drain(Date.now()+10*minute);}finally{mode='up';}
  assert.equal(sent.length-mark,1);assert.equal((await notices(b.account))[0].state,'unknown-outcome');
 });

 await check('a definite refusal closes the change as undeliverable; a not-taken refusal clears the verifier and the retry mints a NEW token',async()=>{
  const a=await owner(),x=addr('refused');
  const {data}=await request(a,x);mode='reject';
  try{const r=await drain();assert.equal(r.failed,1);}finally{mode='up';}
  const closed=await changeRow(data.changeId);assert.deepEqual([closed.state,closed.token_verifier],['undeliverable',null]);
  assert.equal(JSON.parse(closed.history).at(-1),'undeliverable:rejected');
  assert.deepEqual([(await notices(a.account))[0].state,(await notices(a.account))[0].reason],['failed','rejected']);
  const b=await owner(),y=addr('deferred'),pending=await request(b,y),first=sent.length;mode='down';
  try{const r=await drain();assert.equal(r.retried,1);}finally{mode='up';}
  const token1=tokenOf(sent[first]);assert.ok(token1);
  const waiting=await changeRow(pending.data.changeId);assert.deepEqual([waiting.state,waiting.token_verifier],['pending',null],'a not-taken attempt keeps no verifier');
  await drain(Date.now()+10*minute);
  const retry=sent.slice(first).filter(s=>s.to===y);assert.equal(retry.length,2);
  const token2=tokenOf(retry[1]);assert.notEqual(token2,token1);
  assert.equal((await changeRow(pending.data.changeId)).token_verifier,await m.hashToken(token2));
  assert.equal((await call(b,'confirm',{version:1,token:token1})).data.code,'invalid_token','the first token is dead');
  assert.equal((await call(b,'confirm',{version:1,token:token2})).data.status,'confirmed');
 });

 await check('a superseded, cancelled or expired change is never sent a code',async()=>{
  const a=await owner(),x1=addr('one'),x2=addr('two'),first=await request(a,x1),second=await request(a,x2);
  await drain();
  assert.equal(to(x1).length,0,'the superseded confirmation was cancelled unsent');assert.equal(to(x2).length,1);
  const cancelled=await notices(a.account);assert.deepEqual(cancelled.filter(n=>n.event_ref===first.data.changeId).map(n=>[n.state,n.reason]),[['cancelled','record-removed']]);
  const b=await owner(),y=addr('cancel'),c=await request(b,y);await call(b,'cancel',{version:1,changeId:c.data.changeId});await drain();assert.equal(to(y).length,0);
 });

 await check('record isolation between accounts: a notice reaches only its own change addresses and tokens do not cross accounts',async()=>{
  const a=await owner(),b=await owner(),xa=addr('iso-a'),xb=addr('iso-b');
  const ca=await request(a,xa),cb=await request(b,xb);await drain();
  assert.equal(to(xa).length,1);assert.equal(to(xb).length,1);
  const ta=tokenOf(to(xa)[0]),tb=tokenOf(to(xb)[0]);assert.notEqual(ta,tb);
  assert.equal((await call(b,'confirm',{version:1,token:ta})).data.code,'invalid_token');
  assert.equal((await changeRow(ca.data.changeId)).state,'pending');
  assert.equal(await count('notification_notices n JOIN owner_email_changes c ON c.change_id=n.event_ref WHERE n.user_id!=c.account_id'),0);
  const keyB=await m.addressKey(xb);assert.ok((await notices(a.account)).every(n=>n.user_id===a.account&&n.recipient_ref!==keyB));
  assert.equal((await call(a,'confirm',{version:1,token:ta})).data.status,'confirmed');
  assert.equal((await changeRow(cb.data.changeId)).state,'pending');
 });

 // Verification is only reachable through a confirmed change, so the remaining cases set it directly, as the outbox and support suites do.
 await run('DROP TRIGGER users_email_lockstep');
 const verify=(userId,at=Date.now())=>run("UPDATE users SET email_verified_at=?,email_verified_via='notify@whumpo.com' WHERE id=?",at,userId);

 await check('security events: a verified address is told of each event once; an unverified address is skipped silently',async()=>{
  const v=await owner(),u=await owner();await verify(v.account);
  const hex='a'.repeat(64);
  const effect=(o,kind)=>run('INSERT INTO identity_effect_receipts(id,execution_nonce,account_id,kind,request_hash,created_at) VALUES(?,?,?,?,?,unixepoch())',id(),id(),o.account,kind,hex);
  const ids={};
  for(const o of [v,u]){
   for(const kind of ['passkey_remove','recovery_start','recovery_complete','kit_rotate'])await effect(o,kind);
   await run("INSERT INTO identity_ceremony_receipts(id,execution_nonce,account_id,kind,request_hash,credential_id,created_at) VALUES(?,?,?,'add',?,?,unixepoch())",id(),id(),o.account,hex,id());
  }
  assert.equal(await m.queueSecurityNotices(db,Date.now(),25),5,'five events, one verified account');
  assert.equal(await m.queueSecurityNotices(db,Date.now(),25),0,'a second pass finds nothing new');
  assert.equal(await count('notification_notices WHERE user_id=?',u.account),0,'the unverified account has nothing queued');
  assert.deepEqual((await notices(v.account)).map(n=>n.template).sort(),['account.kit-rotated@1','account.passkey-added@1','account.passkey-removed@1','account.recovery-secured@1','account.recovery-started@1']);
  assert.ok((await notices(v.account)).every(n=>n.scope==='account-email'&&n.recipient_ref===null));
  const before=sent.length;for(let i=0;i<3;i++)await drain(); // the dispatcher admits two jobs per owner per pass
  const mine=sent.slice(before).filter(s=>s.to===v.email);assert.equal(mine.length,5);assert.equal(sent.slice(before).filter(s=>s.to===u.email).length,0);
  assert.ok(mine.every(s=>!/[A-Za-z0-9_-]{43}/.test(s.text)),'security notices carry no token');
  // The address is checked again at send time: an address that stops being verified between queue and send gets nothing.
  const w=await owner();await verify(w.account);
  await m.enqueueNotice(db,{userId:w.account,scope:'account-email',template:'account.passkey-added@1',eventRef:'evt-revoked',now:Date.now()});
  await run('UPDATE users SET email_verified_at=NULL,email_verified_via=NULL WHERE id=?',w.account);
  const mark=sent.length;await drain();assert.equal(sent.length,mark);
  assert.deepEqual((await notices(w.account)).map(n=>[n.state,n.reason]),[['cancelled','recipient-revoked']]);
  // The security review notice follows the same rule.
  const review=id();
  assert.equal(await m.queueAccountNotices(db,[{kind:'security-review-completed',changeId:null,to:u.email}],{accountId:u.account,eventRef:review,now:Date.now()}),0);
  assert.equal(await m.queueAccountNotices(db,[{kind:'security-review-completed',changeId:null,to:v.email}],{accountId:v.account,eventRef:review,now:Date.now()}),1);
  const m2=sent.length;await drain();assert.deepEqual(sent.slice(m2).map(s=>[s.to,s.subject]),[[v.email,'Your Whumpo security review was completed']]);
  void ids;
 });

 await check('caps, the shared ceiling and suppression apply across contact and account notices',async()=>{
  const F=Date.parse('2032-05-10T12:00:00.000Z');
  const plain=async(shared=false)=>{const user=id(),project=id(),dest=id(),email=`${user}@example.test`;
   await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-30')",user,email);await verify(user,F);
   await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Fixture','Testing','draft','2026-10-30','2026-10-30')",project,user);
   await run("INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,?,'2026-10-30')",dest,user,project,shared?email:`dest-${user}@example.test`);
   return {user,project,dest,email};};
  const contactNotice=(a,at)=>{const code='ABCD2345';return run('UPDATE contact_notification_destinations SET verification_code=?,verification_expires_at=? WHERE id=?',code,new Date(at+hour).toISOString(),a.dest)
   .then(()=>m.enqueueNotice(db,{userId:a.user,scope:'owner-destination',projectId:a.project,destinationId:a.dest,template:'owner.destination-verification@1',eventRef:'verify:'+a.dest+':'+code,now:at}));};
  const accountNotice=(a,event,at,template='account.passkey-added@1')=>m.enqueueNotice(db,{userId:a.user,scope:'account-email',template,eventRef:event,now:at});
  // Caps: 10 an hour per recipient, then 50 a day.
  const c=await plain();
  for(let i=0;i<10;i++)assert.equal((await accountNotice(c,'cap-'+i,F+i)).queued,true);
  assert.deepEqual(await accountNotice(c,'cap-over',F+11),{queued:false,duplicate:false});
  assert.equal((await accountNotice(c,'cap-0',F+12)).duplicate,true,'a repeat event is a duplicate, not a second notice');
  assert.equal((await contactNotice(c,F+13)).queued,true,'the destination is a different recipient with its own caps');
  // The ceiling is one ledger across kinds: 2 calls allowed, the third (a contact notice) is refused before any call.
  const d=await plain(),e=await plain(),G=F+3*86400000,tight={...live.settings,sendCeiling:2};
  await accountNotice(d,'ceil-a',G);await accountNotice(e,'ceil-b',G);await contactNotice(d,G);
  const before=sent.length,r=await drain(G+1,tight);
  assert.equal(r.accepted,2);assert.equal(r.refused,1);assert.equal(sent.length-before,2);
  assert.equal(await count("notification_notices WHERE reason='ceiling' AND user_id=?",d.user)+await count("notification_notices WHERE reason='ceiling' AND user_id=?",e.user),1);
  // Suppression: one list per account stops the account notice and the contact notice to the same address.
  const s=await plain(true),H=F+10*86400000;
  const qa=await accountNotice(s,'sup-a',H),qc=await contactNotice(s,H);
  await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,'bounce','2026-10-30')",s.user,s.email);
  const mark=sent.length;await drain(H+1);assert.equal(sent.length,mark);
  const states=await all('SELECT id,state,reason FROM notification_notices WHERE user_id=?',s.user);
  assert.deepEqual(states.map(n=>[n.state,n.reason]),[['cancelled','suppressed'],['cancelled','suppressed']]);void qa;void qc;
  // A suppressed new address is refused at send time too, so the confirmation never goes out.
  const f=await owner(),x=addr('suppressed'),mark2=sent.length;
  await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,'bounce','2026-10-30')",f.account,x);
  await request(f,x);await drain();assert.equal(sent.length,mark2);
  assert.equal((await notices(f.account))[0].reason,'suppressed');
 });

 await check('the support notice: verified accounts only, unread answers only, inactive unless the support variables are set',async()=>{
  const answered=async(verified)=>{
   const o=await owner();if(verified)await verify(o.account);
   const rid=id();await run("INSERT INTO usage_review_requests(id,user_id,kind,source,reference,statement) VALUES(?,?,'help','support','ref','Please help')",rid,o.account);
   await run("UPDATE usage_review_requests SET state='answered',public_response='Done.',answered_by='operator',answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",rid);
   return {o,rid};
  };
  const v=await answered(true),u=await answered(false);
  const env={...active,SUPPORT_NOTIFICATION_PROVIDER:'cloudflare-email',SUPPORT_NOTIFICATION_REVIEW:'review-2'};
  const support=m.supportDelivery(env);assert.ok(support);
  const before=sent.length;
  await m.dispatchJobs([m.supportDeliveryLane(db,{...support,now:Date.now})],{now:Date.now});
  const mine=sent.slice(before).filter(s=>s.to===v.o.email);assert.equal(mine.length,1);assert.equal(mine[0].subject,'A response to your Whumpo request is saved');
  assert.equal(sent.slice(before).filter(s=>s.to===u.o.email).length,0);assert.equal(await count('notification_notices WHERE user_id=?',u.o.account),0);
  const notice=(await notices(v.o.account))[0];assert.deepEqual([notice.scope,notice.template,notice.event_ref,notice.state],['account-email','support.response-saved@1',v.rid,'accepted']);
  // With the support variables unset nothing is queued even though the account lane's provider is configured.
  const w=await answered(true),mark=sent.length;
  assert.equal(m.supportDelivery(active),null);await drain();assert.equal(sent.length,mark);assert.equal(await count('notification_notices WHERE user_id=?',w.o.account),0);
 });

 await check('both lanes are registered on the every-minute trigger beside the contact lane',()=>{
  const source=readFileSync('src/index.ts','utf8');
  const line=source.split('\n').filter(l=>l.includes("_event.cron==='* * * * *'")||l.includes("type:'account_delivery'")||l.includes("type:'support_delivery'")).join('\n');
  for(const type of ['contact_delivery','account_delivery','support_delivery'])assert.ok(line.includes(`type:'${type}'`),type);
  assert.match(line,/accountDeliveryLane\(env\.DB/);assert.match(line,/supportDeliveryLane\(env\.DB/);
 });
 assert.equal(network,0,'no network call was made');
 console.log(`Email change delivery passed (${cases} cases, ${process.argv.includes('--d1')?'actual local D1':'in-memory SQLite'}): confirm and undo sends, unverified old address silent, security events verified-only, caps/ceiling/suppression across contact and account notices, lost reply held, inactive provider, tokens never stored, record isolation, support lane. Simulated provider only; no mail was sent.`);
}finally{await fixture.close();}
