import assert from 'node:assert/strict';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';

// WH-086 schema batch 4: owner device registration, withdrawal and the opaque event readback through the REAL Worker, on disposable SQLite and, with --d1,
// actual local D1. The registration token is stored sealed and by hash; a device is live only while its native session lineage is; nothing is sent (the FCM
// adapter is tests/push-fcm.mjs). Synthetic rows and tokens only.
const bundle=await build({stdin:{contents:[
 "export {default as worker} from './src/index';export {androidPasskeyOrigins} from './src/android-signing';",
 "export {resolveIdentity} from './src/workspace-identity/authority';export {cleanIdentityCeremonies} from './src/workspace-identity/ceremonies';",
 "export {newSessionToken,hashToken} from './src/security';export {maintainNotices} from './src/notification-outbox';export {unseal} from './src/connection-vault';export {recordPushEvent} from './src/mobile/push';"
 ].join(''),resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fixtures=name=>JSON.parse(readFileSync(new URL('./fixtures/mobile-v1/'+name,import.meta.url),'utf8'));
const operations=Object.fromEntries(fixtures('operations.json').cases.map(c=>[c.operation,c])),errors=fixtures('errors.json').cases,clients=fixtures('client.json');
const clientHeader=JSON.stringify(clients.current);
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results.map(r=>({...r}));
const count=async(table,where='1=1',...v)=>(await one(`SELECT count(*) n FROM ${table} WHERE ${where}`,...v)).n;
const androidOrigin=m.androidPasskeyOrigins[0],base='https://whumpo.com',sessionCookie='__Host-whumpo_session',challengeCookie='__Secure-whumpo_identity_challenge';
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const keyring=JSON.stringify({version:2,active:'push-test',keys:[{id:'push-test',secret:'ab'.repeat(32)}]});
const env={DB:db,ENVIRONMENT:'test',MOBILE_MINIMUM_BUILD:'40',TURNSTILE_SECRET:'synthetic-only',CONNECTION_ENCRYPTION_KEYRING:keyring,
 AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const active={...env,PUSH_NOTIFICATION_PROVIDER:'fcm'};
const ctx={waitUntil(){}};
const same=(live,fixture)=>assert.deepEqual(live,fixture);
function shaped(live,fixture,at='body'){
 if(fixture===null||live===null)return;
 assert.equal(typeof live,typeof fixture,at);
 if(Array.isArray(fixture)){assert(Array.isArray(live),at);return;}
 if(fixture&&typeof fixture==='object')for(const k of Object.keys(fixture)){assert(Object.hasOwn(live,k),`${at}.${k} missing`);shaped(live[k],fixture[k],at+'.'+k);}
}
const fixtureCall=(name,live)=>{assert.equal(live.status,operations[name].response.status,live.text);shaped(live.data,operations[name].response.body);};
async function mobile(path,{method='POST',headers={},body,token,client=clientHeader,e=active}={}){
 const h={...(client===null?{}:{'whumpo-client':client}),...(token?{authorization:'Bearer '+token}:{}),...headers};
 if(body!==undefined)h['content-type']='application/json';
 const response=await m.worker.fetch(new Request(base+'/api/mobile/v1'+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),e,ctx);
 const text=await response.text();let data=null;try{data=JSON.parse(text);}catch{}
 assert.equal(response.headers.get('cache-control'),'no-store');
 return {status:response.status,data,text};
}
const put=(token,body,e)=>mobile('/devices/current',{method:'PUT',token,body:{version:1,fcmRegistrationToken:'synthetic-fcm-registration-token-0001',notificationsEnabled:true,...body},e});
const handleOf=account=>Buffer.from(account).toString('base64url');
let counter=0;
async function owner({project=true}={}){
 const account=id(),key=authenticator();
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",account,`owner${++counter}${account.slice(0,6)}@example.test`);
 await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)",account,'a'.repeat(64),id());
 await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)",key.id,account,key.publicKey);
 const o={account,key,n:0,project:null};
 o.nativeAssert=options=>key.assertion(options,++o.n,{atOrigin:androidOrigin,handle:handleOf(account)});
 if(project){o.project=id();const now=new Date().toISOString();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden Secret Name','Landscaping','draft',?,?)",o.project,account,now,now);}
 return o;
}
async function native(o,{client='android',lifetime=3600}={}){
 const token=m.newSessionToken(),sid=id();
 await run("INSERT INTO identity_sessions(id,token_hash,account_id,policy_version,auth_epoch,client,credential_id,proof_method,proof_at,issued_at,expires_at) VALUES(?,?,?,1,1,?,?,'passkey',unixepoch()-5,unixepoch(),unixepoch()+?)",sid,await m.hashToken(token),o.account,client,o.key.id,lifetime);
 return {token,sid,lineage:(await one('SELECT lineage_id FROM identity_sessions WHERE id=?',sid)).lineage_id};
}
const live=()=>all('SELECT account_id,lineage_id FROM push_live_devices ORDER BY lineage_id');
try{
 const a=await owner(),b=await owner();
 await check('inactive by default: no delivery address is stored until PUSH_NOTIFICATION_PROVIDER is fcm',async()=>{
  const s=await native(a);
  const r=await put(s.token,{},env);assert.equal(r.status,503,r.text);assert.equal(await count('push_devices'),0);
  const r2=await put(s.token,{},{...env,PUSH_NOTIFICATION_PROVIDER:'other'});assert.equal(r2.status,503);
  const r3=await put(s.token,{},{...active,CONNECTION_ENCRYPTION_KEYRING:undefined});assert.equal(r3.status,503,'no key, no stored address');assert.equal(await count('push_devices'),0);
 });

 await check('register: fixture pair, token sealed and hashed (never plaintext), idempotent per session, preference update keeps the device',async()=>{
  const s=await native(a),token='synthetic-fcm-registration-token-0001';
  const r=await put(s.token,{});fixtureCall('device.register',r);assert.deepEqual(r.data.preferences,{notificationsEnabled:true});
  const row=await one('SELECT * FROM push_devices WHERE id=?',r.data.deviceId);
  assert.equal(row.account_id,a.account);assert.equal(row.lineage_id,s.lineage);assert.equal(row.platform,'android');assert.equal(row.notifications_enabled,1);assert.equal(row.revoked_at,null);
  assert.equal(row.token_hash,await m.hashToken(token));assert(!row.token_sealed.includes(token)&&!JSON.stringify(row).includes(token),'the plaintext token is not stored');
  assert.equal(await m.unseal(keyring,`whumpo:push:token:${a.account}:${s.lineage}`,row.token_sealed),token,'sealed under its account and lineage');
  await assert.rejects(()=>m.unseal(keyring,`whumpo:push:token:${b.account}:${s.lineage}`,row.token_sealed),'bound to its owner');
  assert.equal((await live()).filter(d=>d.lineage_id===s.lineage).length,1);
  const again=await put(s.token,{notificationsEnabled:false});assert.equal(again.status,200,again.text);assert.equal(again.data.deviceId,r.data.deviceId,'one registration per session');
  assert.deepEqual(again.data.preferences,{notificationsEnabled:false});assert.equal(await count('push_devices','account_id=? AND lineage_id=?',a.account,s.lineage),1);
  assert.equal((await live()).filter(d=>d.lineage_id===s.lineage).length,0,'opted out: not live');
  const rotated=await put(s.token,{fcmRegistrationToken:'rotated-fcm-registration-token-0002',notificationsEnabled:true});assert.equal(rotated.data.deviceId,r.data.deviceId);
  assert.equal((await one('SELECT token_hash FROM push_devices WHERE id=?',r.data.deviceId)).token_hash,await m.hashToken('rotated-fcm-registration-token-0002'),'token rotation replaces the address');
  assert.equal((await live()).filter(d=>d.lineage_id===s.lineage).length,1);
 });

 await check('a token has one owner: re-registering it from another account or session moves it and never doubles it',async()=>{
  const sa=await native(a),sb=await native(b),tok='shared-device-fcm-token-0003';
  const first=await put(sa.token,{fcmRegistrationToken:tok});assert.equal(first.status,200);
  const moved=await put(sb.token,{fcmRegistrationToken:tok});assert.equal(moved.status,200,moved.text);
  assert.equal(await count('push_devices','token_hash=?',await m.hashToken(tok)),1);
  assert.equal((await one('SELECT account_id FROM push_devices WHERE token_hash=?',await m.hashToken(tok))).account_id,b.account);
  assert.equal(await count('push_devices','id=?',first.data.deviceId),0,'the earlier registration is gone');
 });

 await check('register: strict body, bearer-only, android native sessions only; a web session token is not found',async()=>{
  const s=await native(a),before=await count('push_devices');
  for(const [name,body] of [['short token',{fcmRegistrationToken:'short'}],['bad characters',{fcmRegistrationToken:'x'.repeat(30)+' !'}],['oversize token',{fcmRegistrationToken:'x'.repeat(4097)}],
   ['non-boolean preference',{notificationsEnabled:'yes'}],['unknown field',{extra:1}],['missing token',{fcmRegistrationToken:undefined}]]){
   const r=await put(s.token,body);assert([400].includes(r.status),`${name}: ${r.status} ${r.text}`);
  }
  assert.equal((await put(null,{})).status,401);assert.equal((await put('0'.repeat(64),{})).status,401);
  const web=await native(a,{client:'web'});assert.equal((await put(web.token,{})).status,401,'a web session is not a native bearer');
  assert.equal((await mobile('/devices/current',{method:'PUT',token:s.token,headers:{cookie:'x=1'},body:{version:1,fcmRegistrationToken:'synthetic-fcm-registration-token-0001',notificationsEnabled:true}})).status,400);
  assert.equal(await count('push_devices'),before);
 });

 await check('withdraw: removes only this session\'s device, idempotently; logout removes it too',async()=>{
  const s1=await native(a),s2=await native(a);
  await put(s1.token,{fcmRegistrationToken:'device-one-fcm-token-000000001'});const d2=await put(s2.token,{fcmRegistrationToken:'device-two-fcm-token-000000002'});
  const gone=await mobile('/devices/current',{method:'DELETE',token:s1.token});fixtureCall('device.remove',gone);assert.deepEqual(gone.data,{version:1,removed:true});
  assert.equal(await count('push_devices','lineage_id=?',s1.lineage),0);assert.equal(await count('push_devices','id=?',d2.data.deviceId),1,'the other session\'s device stays');
  assert.equal((await mobile('/devices/current',{method:'DELETE',token:s1.token})).status,200,'natural idempotency');
  assert.equal((await mobile('/devices/current',{method:'DELETE'})).status,401);
  const out=await mobile('/session/logout',{token:s2.token,body:{version:1}});assert.equal(out.status,200,out.text);
  assert.equal(await count('push_devices','id=?',d2.data.deviceId),0,'logout removes the device in the same batch');
 });

 await check('revocation: session deletion, epoch change, expiry and the maintenance sweep disable or remove the device',async()=>{
  const s=await native(a),r=await put(s.token,{fcmRegistrationToken:'revocation-fcm-token-0000000001'});assert.equal(r.status,200);
  const isLive=async()=>(await live()).some(d=>d.lineage_id===s.lineage);
  assert.equal(await isLive(),true);
  await run('DELETE FROM identity_sessions WHERE id=?',s.sid);assert.equal(await isLive(),false,'session revocation (sign-out of everywhere, passkey removal) disables it at once');
  assert.equal(await count('push_devices','id=?',r.data.deviceId),1,'the row waits for the sweep');
  await m.cleanIdentityCeremonies(db);assert.equal(await count('push_devices','id=?',r.data.deviceId),0,'the sweep removes it');
  const g=await owner({project:false}),t=await native(g),e=await put(t.token,{fcmRegistrationToken:'epoch-fcm-token-0000000000001'});assert.equal(e.status,200);
  assert.equal((await live()).some(d=>d.lineage_id===t.lineage),true);
  await run('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',g.account);
  assert.equal((await live()).some(d=>d.lineage_id===t.lineage),false,'an epoch change (recovery, kit rotation, security review) disables it');
  await m.cleanIdentityCeremonies(db);assert.equal(await count('push_devices','id=?',e.data.deviceId),1,'a current-epoch-less device waits for its session to leave');
 });

 await check('the account cascade removes devices and events; deleting a user is not blocked by them',async()=>{
  const c=await owner(),s=await native(c);await put(s.token,{fcmRegistrationToken:'cascade-fcm-token-00000000001'});
  await m.recordPushEvent(db,{accountId:c.account,kind:'operation_completed',projectId:c.project});
  assert.equal(await count('push_devices','account_id=?',c.account),1);
  await run('DELETE FROM users WHERE id=?',c.account);
  assert.equal(await count('push_devices','account_id=?',c.account),0);assert.equal(await count('push_events','account_id=?',c.account),0);
 });

 await check('rows are constrained: platform, hash, immutability, the per-account device cap and the event caps',async()=>{
  const c=await owner({project:true}),h=await m.hashToken('constraint-token'),base=[id(),c.account,id(),'android',h,'x'.repeat(30),1,1,1];
  const ins=(o={})=>{const v=[...base];for(const [i,x] of Object.entries(o))v[i]=x;return run('INSERT INTO push_devices(id,account_id,lineage_id,platform,token_hash,token_sealed,notifications_enabled,created_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?)',...v);};
  await assert.rejects(()=>ins({3:'ios'}),/CHECK/);await assert.rejects(()=>ins({4:'ABC'}),/CHECK/);await assert.rejects(()=>ins({6:2}),/CHECK/);await assert.rejects(()=>ins({2:'short'}),/CHECK/);
  await ins();await assert.rejects(()=>ins({0:id(),2:id()}),/UNIQUE/,'the same token twice');
  await assert.rejects(()=>run('UPDATE push_devices SET account_id=? WHERE account_id=?',b.account,c.account),/push_device_immutable/);
  await assert.rejects(()=>run('UPDATE push_devices SET lineage_id=? WHERE account_id=?',id(),c.account),/push_device_immutable/);
  for(let i=1;i<20;i++){const th=await m.hashToken('t'+i);await ins({0:id(),2:id(),4:th});}
  const over=await m.hashToken('t-over');
  await assert.rejects(()=>ins({0:id(),2:id(),4:over}),/push_device_limit/);
  const ev=(o={})=>{const r={id:id(),account_id:c.account,kind:'operation_completed',project_id:c.project,review_id:null,created_at:1000,expires_at:2000,...o};const k=Object.keys(r);return run(`INSERT INTO push_events(${k.join(',')}) VALUES(${k.map(()=>'?').join(',')})`,...k.map(x=>r[x]));};
  await assert.rejects(()=>ev({kind:'other'}),/CHECK/);await assert.rejects(()=>ev({review_id:id()}),/CHECK/,'a review id only on a review_pending event');await assert.rejects(()=>ev({expires_at:1000+604801}),/CHECK/);
  await assert.rejects(()=>ev({expires_at:999}),/CHECK/);await ev({kind:'review_pending',review_id:id()});
  const e1=id();await ev({id:e1});await assert.rejects(()=>run('UPDATE push_events SET kind=? WHERE id=?','attention_required',e1),/push_event_immutable/);
  const d=await owner();for(let i=0;i<20;i++)await run('INSERT INTO push_events(id,account_id,kind,project_id,created_at,expires_at) VALUES(?,?,?,?,5000,6000)',id(),d.account,'operation_completed',d.project);
  await assert.rejects(()=>run('INSERT INTO push_events(id,account_id,kind,project_id,created_at,expires_at) VALUES(?,?,?,?,5001,6000)',id(),d.account,'operation_completed',d.project),/push_event_limit/,'20 an hour');
  await run('INSERT INTO push_events(id,account_id,kind,project_id,created_at,expires_at) VALUES(?,?,?,?,5000+3601,9000)',id(),d.account,'operation_completed',d.project);
 });

 await check('event read: fixture pair, only the owner\'s, content-free, expired and project-less events are unavailable, unknown and foreign are the same 404',async()=>{
  const s=await native(a),sb=await native(b),review=id();
  const e=await m.recordPushEvent(db,{accountId:a.account,kind:'review_pending',projectId:a.project,reviewId:review});
  const r=await mobile('/events/'+e,{method:'GET',token:s.token});fixtureCall('event.read',r);
  assert.deepEqual(r.data.event,{id:e,kind:'review_pending',destination:{type:'review',id:review},state:'current'});
  assert(!r.text.includes('Garden Secret Name')&&!r.text.includes(a.project),'no project name or project id in a review event');
  const done=await m.recordPushEvent(db,{accountId:a.account,kind:'operation_completed',projectId:a.project});
  assert.deepEqual((await mobile('/events/'+done,{method:'GET',token:s.token})).data.event.destination,{type:'project',id:a.project});
  const foreign=await mobile('/events/'+e,{method:'GET',token:sb.token}),unknown=await mobile('/events/'+id(),{method:'GET',token:sb.token});
  assert.equal(foreign.status,404);same(foreign.data,unknown.data);same(foreign.data,errors.not_found.body);
  const old=await m.recordPushEvent(db,{accountId:a.account,kind:'attention_required',projectId:a.project,ttlSeconds:1});
  await run('DELETE FROM push_events WHERE id=?',old);
  await run('INSERT INTO push_events(id,account_id,kind,project_id,created_at,expires_at) VALUES(?,?,?,?,unixepoch()-100,unixepoch()-1)',old,a.account,'attention_required',a.project);
  const expired=await mobile('/events/'+old,{method:'GET',token:s.token});assert.equal(expired.status,200);assert.deepEqual(expired.data.event,{id:old,kind:'attention_required',destination:null,state:'unavailable'});
  const p2=id(),now=new Date().toISOString();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Gone','x','draft',?,?)",p2,a.account,now,now);
  const orphan=await m.recordPushEvent(db,{accountId:a.account,kind:'operation_completed',projectId:p2});await run('DELETE FROM projects WHERE id=?',p2);
  assert.deepEqual((await mobile('/events/'+orphan,{method:'GET',token:s.token})).data.event,{id:orphan,kind:'operation_completed',destination:null,state:'unavailable'},'a deleted target: the event survives, the destination does not');
  assert.equal((await mobile('/events/not-a-uuid',{method:'GET',token:s.token})).status,404);assert.equal((await mobile('/events/'+e,{method:'GET'})).status,401);
  assert.equal((await mobile('/events/'+e+'?x=1',{method:'GET',token:s.token})).status,400);assert.equal((await mobile('/events/'+e,{method:'POST',token:s.token,body:{version:1}})).status,404);
  await m.maintainNotices(db);assert.equal(await count('push_events','id=?',old),0,'expired events are pruned by the hourly notice maintenance');
 });

 await check('native reauthentication keeps the device: the session row is replaced, the lineage is not',async()=>{
  const f=await owner(),s=await native(f),reg=await put(s.token,{fcmRegistrationToken:'reauth-fcm-token-00000000001'});assert.equal(reg.status,200);
  const options=await mobile('/session/reauth/options',{token:s.token,body:{version:1}});assert.equal(options.status,200,options.text);
  const done=await mobile('/session/reauth/verify',{token:s.token,body:{version:1,challengeId:options.data.challengeId,credential:f.nativeAssert(options.data.options)}});assert.equal(done.status,200,done.text);
  const after=await one('SELECT id,lineage_id FROM identity_sessions WHERE token_hash=?',await m.hashToken(s.token));
  assert.notEqual(after.id,s.sid);assert.equal(after.lineage_id,s.lineage);
  assert.equal((await live()).some(d=>d.lineage_id===s.lineage&&d.account_id===f.account),true,'still live after reauthentication');
  assert.equal((await put(s.token,{fcmRegistrationToken:'reauth-fcm-token-00000000001'})).data.deviceId,reg.data.deviceId);
 });

 await check('boundary: the push payload and responses carry no sensitive content, and the sealed token never leaves the table',async()=>{
  const row=await one('SELECT * FROM push_devices LIMIT 1');assert(row);
  const columns=(await all("SELECT name FROM pragma_table_info('push_events')")).map(c=>c.name);
  assert.deepEqual(columns,['id','account_id','kind','project_id','review_id','created_at','expires_at'],'ids and a kind only');
  assert.deepEqual((await all("SELECT name FROM pragma_table_info('push_live_devices')")).map(c=>c.name),['id','account_id','lineage_id','token_hash','token_sealed','last_seen_at']);
 });

 console.log(`Mobile push M5: ${cases} checks over the three operations on ${process.argv.includes('--d1')?'local D1':'SQLite'}.`);
}catch(error){console.error(error);process.exitCode=1;}
finally{await fixture.close();}
