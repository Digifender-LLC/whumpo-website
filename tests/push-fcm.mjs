import assert from 'node:assert/strict';
import {createPublicKey,createVerify,generateKeyPairSync} from 'node:crypto';
import {build} from 'esbuild';

// WH-086 FCM HTTP v1 sender: the RS256 service-account JWT, the OAuth exchange, the send request, the exact data payload and the outcome mapping, against a FAKE
// transport and a SYNTHETIC RSA key generated here. No network, no real credential; nothing in the Worker wires the sender (PUSH_NOTIFICATION_PROVIDER is unset).
const bundle=await build({stdin:{contents:"export * from './src/push-fcm';export * from './src/push-provider';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const account=(over={})=>JSON.stringify({type:'service_account',project_id:'whumpo-18331',client_email:'fcm-sender@whumpo-18331.iam.gserviceaccount.com',private_key:privateKey,...over});
const eventId='11111111-1111-4111-8111-111111111111',message={token:'synthetic-fcm-registration-token-0001',eventId,kind:'review_pending'};
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const b64=v=>Buffer.from(v,'base64url');
function transportFor(script){
 const calls=[];
 const fn=async(url,init)=>{calls.push({url,init});const r=script(url,init,calls.length);if(r instanceof Error)throw r;return r;};
 fn.calls=calls;return fn;
}
const tokenReply=()=>Response.json({access_token:'ya29.synthetic-access-token',expires_in:3600});
const ok=(url)=>url.startsWith('https://oauth2.googleapis.com/')?tokenReply():Response.json({name:'projects/whumpo-18331/messages/0:synthetic'});

await check('mints an RS256 JWT for the send scope, exchanges it, then posts the exact data-only message to the whumpo-18331 URL',async()=>{
 const t=transportFor(ok),sender=m.fcmSender(account(),t,()=>1_800_000_000_000);
 assert.deepEqual(await sender.send(message),{result:'accepted',status:200});
 assert.equal(t.calls.length,2);
 const [auth,send]=t.calls;
 assert.equal(auth.url,'https://oauth2.googleapis.com/token');assert.equal(auth.init.method,'POST');assert.equal(auth.init.headers['content-type'],'application/x-www-form-urlencoded');
 const form=new URLSearchParams(String(auth.init.body));assert.equal(form.get('grant_type'),'urn:ietf:params:oauth:grant-type:jwt-bearer');
 const [h,c,s]=form.get('assertion').split('.');
 assert.deepEqual(JSON.parse(b64(h)),{alg:'RS256',typ:'JWT'});
 assert.deepEqual(JSON.parse(b64(c)),{iss:'fcm-sender@whumpo-18331.iam.gserviceaccount.com',scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:1_800_000_000,exp:1_800_003_600});
 const verify=createVerify('RSA-SHA256');verify.update(h+'.'+c);assert.equal(verify.verify(createPublicKey(publicKey),b64(s)),true,'signed with the service-account key');
 assert.equal(send.url,'https://fcm.googleapis.com/v1/projects/whumpo-18331/messages:send');assert.equal(send.init.method,'POST');
 assert.equal(send.init.headers.authorization,'Bearer ya29.synthetic-access-token');
 const body=JSON.parse(send.init.body);
 assert.deepEqual(Object.keys(body),['message']);assert.deepEqual(body.message.data,{v:'1',eventId,kind:'review_pending'},'the data payload is exactly {v,eventId,kind}');
 assert.equal(body.message.token,message.token);assert.equal(body.message.notification,undefined,'data-only: the app builds the private notification');
 assert.deepEqual(body.message.android,{priority:'HIGH',ttl:'86400s'});
 const normal=transportFor(ok);await m.fcmSender(account(),normal).send({...message,kind:'operation_completed'});
 assert.equal(JSON.parse(normal.calls[1].init.body).message.android.priority,'NORMAL');
 assert(send.init.signal instanceof AbortSignal,'every call is time-bounded');
});

await check('the access token is reused until shortly before it expires, then minted again; a 401 drops it',async()=>{
 let clock=1_800_000_000_000;const t=transportFor(ok),sender=m.fcmSender(account(),t,()=>clock);
 await sender.send(message);await sender.send(message);assert.equal(t.calls.filter(c=>c.url.includes('oauth2')).length,1);
 clock+=3600_000;await sender.send(message);assert.equal(t.calls.filter(c=>c.url.includes('oauth2')).length,2);
 const u=transportFor((url,_i,n)=>url.includes('oauth2')?tokenReply():n===2?new Response('{}',{status:401}):Response.json({}));
 const s2=m.fcmSender(account(),u,()=>clock);assert.deepEqual(await s2.send(message),{result:'retry',status:401});assert.equal((await s2.send(message)).result,'accepted');
 assert.equal(u.calls.filter(c=>c.url.includes('oauth2')).length,2,'re-minted after the 401');
});

await check('outcomes: accepted; a dead registration is invalid-token; refusals retry; a send with no answer is uncertain and never retried blind; a failed token exchange sends nothing',async()=>{
 const reply=status=>transportFor(url=>url.includes('oauth2')?tokenReply():new Response('{"error":{"status":"X"}}',{status}));
 for(const [status,result] of [[200,'accepted'],[429,'retry'],[500,'retry'],[503,'retry'],[403,'retry'],[401,'retry']])
  assert.equal((await m.fcmSender(account(),reply(status)).send(message)).result,result,String(status));
 // Classified by the FCM error code, not the HTTP status.
 const coded=(status,errorStatus,errorCode,msg='x')=>transportFor(url=>url.includes('oauth2')?tokenReply():Response.json({error:{code:status,message:msg,status:errorStatus,...(errorCode?{details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode}]}:{})}},{status}));
 const outcome=async t=>(await m.fcmSender(account(),t).send(message)).result;
 assert.equal(await outcome(coded(404,'NOT_FOUND','UNREGISTERED')),'invalid-token','UNREGISTERED');
 assert.equal(await outcome(coded(404,'NOT_FOUND')),'invalid-token','a bare 404 NOT_FOUND');
 assert.equal(await outcome(coded(400,'INVALID_ARGUMENT','INVALID_ARGUMENT','The registration token is not a valid FCM registration token')),'invalid-token','INVALID_ARGUMENT about the registration token');
 assert.equal(await outcome(coded(403,'PERMISSION_DENIED','SENDER_ID_MISMATCH','SenderId mismatch')),'config-error','SENDER_ID_MISMATCH is a permanent configuration error');
 assert.equal(await outcome(coded(400,'INVALID_ARGUMENT','INVALID_ARGUMENT','Invalid JSON payload received. Unknown name "x"')),'payload-error','INVALID_ARGUMENT about the payload is not a token problem');
 assert.equal(await outcome(coded(400,'INVALID_ARGUMENT',null,'bad request')),'payload-error','any other 400');
 assert.equal(await outcome(transportFor(url=>url.includes('oauth2')?tokenReply():new Response('not json',{status:400}))),'payload-error','an unreadable 400 body');
 assert.equal(await outcome(coded(503,'UNAVAILABLE','UNAVAILABLE')),'retry');assert.equal(await outcome(coded(429,'RESOURCE_EXHAUSTED','QUOTA_EXCEEDED')),'retry');
 const lost=transportFor(url=>url.includes('oauth2')?tokenReply():new Error('timeout'));
 assert.deepEqual(await m.fcmSender(account(),lost).send(message),{result:'uncertain'});
 const noToken=transportFor(()=>new Response('{"error":"invalid_grant"}',{status:400}));
 assert.deepEqual(await m.fcmSender(account(),noToken).send(message),{result:'retry'});assert.equal(noToken.calls.length,1,'no FCM request without a token');
 const bad=transportFor(()=>Response.json({access_token:''}));assert.equal((await m.fcmSender(account(),bad).send(message)).result,'retry');
 const down=transportFor(()=>new Error('offline'));assert.equal((await m.fcmSender(account(),down).send(message)).result,'retry','a failed exchange is a certain non-send');
});

await check('credential validation: other project, missing fields, bad JSON, non-PEM key are refused at construction',async()=>{
 const t=transportFor(ok);
 for(const bad of [account({project_id:'other-project'}),account({client_email:undefined}),account({private_key:'nope'}),account({private_key:undefined}),'{not json','null'])
  assert.throws(()=>m.fcmSender(bad,t),/push_credential/);
 assert.equal(t.calls.length,0);
 const garbage=m.fcmSender(account({private_key:'-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'}),t);
 assert.equal((await garbage.send(message)).result,'retry','an unusable key fails the exchange before anything is sent');assert.equal(t.calls.length,0);
});

await check('activation: no sender unless PUSH_NOTIFICATION_PROVIDER is exactly fcm and the secret exists; nothing is called to decide',async()=>{
 const t=transportFor(ok),json=account();
 assert.equal(m.pushSender({FCM_SERVICE_ACCOUNT_JSON:json},t),null);assert.equal(m.pushSender({PUSH_NOTIFICATION_PROVIDER:'FCM',FCM_SERVICE_ACCOUNT_JSON:json},t),null);
 assert.equal(m.pushSender({PUSH_NOTIFICATION_PROVIDER:'fcm'},t),null);assert.equal(m.pushSender({PUSH_NOTIFICATION_PROVIDER:'',FCM_SERVICE_ACCOUNT_JSON:json},t),null);
 assert.equal(typeof m.pushSender({PUSH_NOTIFICATION_PROVIDER:'fcm',FCM_SERVICE_ACCOUNT_JSON:json},t).send,'function');assert.equal(t.calls.length,0);
});

await check('the source is unwired and holds no credential: nothing outside the adapter and tests references the sender, and no real key is in the repository sources',async()=>{
 const {readFile,readdir}=await import('node:fs/promises');
 const files=(await readdir('src',{recursive:true})).filter(f=>f.endsWith('.ts')).map(f=>'src/'+f);
 const users=[];for(const f of files){const t=await readFile(f,'utf8');if(/push-fcm|push-provider|pushSender|fcmSender/.test(t))users.push(f);}
 assert.deepEqual(users.sort(),['src/push-fcm.ts','src/push-provider.ts'],'only the adapter and its activation seam; no Worker path calls it');
 for(const f of [...files,'tests/push-fcm.mjs'])assert(!/BEGIN (?:RSA )?PRIVATE KEY-----\s*[A-Za-z0-9+/]{40}/.test(await readFile(f,'utf8')),f+' holds no key');
});

console.log(`Push FCM adapter: ${cases} checks against a fake transport and a synthetic key.`);
