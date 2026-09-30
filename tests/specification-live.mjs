// Explicit opt-in: real test deployment + configured Muse, synthetic private work only.
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {build} from 'esbuild';
import {cloudflareClient,remoteD1} from '../tools/cms-cloudflare.mjs';
if(process.env.RUN_LIVE_SPECIFICATION!=='1')throw Error('Set RUN_LIVE_SPECIFICATION=1 for the private live specification check');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));assert.equal(config.vars.ENVIRONMENT,'test');
const db=remoteD1(cloudflareClient(config.account_id),config.d1_databases.find(d=>d.binding==='DB').database_id);
assert.ok(await db.prepare("SELECT name FROM d1_migrations WHERE name='0111_specification_account_cleanup.sql'").first());
const bundle=await build({entryPoints:['src/components.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {siteConfig,renderSite}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const base='https://whumpo.com',id=crypto.randomUUID(),email='specification-fixture-'+id+'@example.test',credentialID=randomBytes(32).toString('base64url');
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'});
const cose=Buffer.concat([Buffer.from([0xa5,1,2,3,0x26,0x20,1,0x21,0x58,0x20]),Buffer.from(jwk.x,'base64url'),Buffer.from([0x22,0x58,0x20]),Buffer.from(jwk.y,'base64url')]).toString('base64url');
const now=()=>new Date().toISOString(),sha=v=>createHash('sha256').update(v).digest(),b64=v=>Buffer.from(v).toString('base64url'),cookies=new Map();
async function call(path,method='GET',data){const r=await fetch(base+path,{method,headers:{origin:base,'content-type':'application/json',cookie:[...cookies].map(([k,v])=>k+'='+v).join('; ')},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(90000),redirect:'error'});for(const c of r.headers.getSetCookie()){const pair=c.split(';')[0],at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1));if(pair.startsWith('tellumo_session='))assert.ok(c.includes('Secure')&&c.includes('HttpOnly'));}return r;}
async function json(path,method='GET',data){const r=await call(path,method,data);assert.equal(r.status,200,'Unexpected status for '+method+' '+path);return r.json();}
async function chat(content){const state=await json('/api/chat'),input={id:crypto.randomUUID(),revision:state.state.revision,content};const out=await json('/api/chat','POST',input),turn=out.turns.find(t=>t.id===input.id);assert.equal(turn?.status,'completed','Live interpretation did not complete');assert.ok(turn.specification_review,'Live interpretation did not prepare a specification review');return turn.specification_review;}
async function approve(q){const state=await json('/api/chat'),input={id:crypto.randomUUID(),revision:state.state.revision,action:{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposalDigest,expectedRevision:q.expectedRevision}};await json('/api/chat/actions','POST',input);await json('/api/chat/actions','POST',input);return input.id;}
async function preview(version){const r=await call('/api/site-versions/'+version+'/preview');assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private/);return r.text();}
let project,success=false,originalFailure;
const cleanupFile='.secrets/specification-live-account.json';
try{await readFile(cleanupFile);throw Error('Resolve the previous specification fixture cleanup before a new run');}catch(error){if(error.code!=='ENOENT')throw error;}
await writeFile(cleanupFile,JSON.stringify({id,email}),{mode:0o600});
try{
 await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,'00','passkey-only',?)").bind(id,email,now()).run();
 await db.prepare('INSERT INTO passkeys(id,user_id,public_key,counter,name,created_at) VALUES(?,?,?,0,?,?)').bind(credentialID,id,cose,'Ephemeral specification fixture',now()).run();
 const options=await json('/api/auth/passkeys/login/options','POST',{});assert.equal(options.options.rpId,'whumpo.com');
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:options.options.challenge,origin:base})),auth=Buffer.concat([sha('whumpo.com'),Buffer.from([5,0,0,0,1])]);
 const credential={id:credentialID,rawId:credentialID,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client),authenticatorData:b64(auth),signature:b64(sign('sha256',Buffer.concat([auth,sha(client)]),privateKey)),userHandle:b64(id)}};
 assert.equal((await json('/api/auth/passkeys/login/verify','POST',{credential})).user.id,id);
 await json('/api/profile','PATCH',{revision:0,name:'River',avatar_id:'sun',about_me:'',share_context:false});await json('/api/onboarding');
 await json('/api/onboarding','PUT',{revision:0,stage:'review',project_name:'Example Garden',idea:'A synthetic landscaping website for private deployment verification.',audience:'Neighbors',preferred_theme:'forest'});await json('/api/onboarding/complete','POST',{revision:1});
 project=(await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(id).first()).id;
 const original=crypto.randomUUID(),page=siteConfig({name:'Example Garden',description:'Local landscaping.',headline:'A greener neighborhood',theme:'forest',aboutTitle:'Our work',aboutText:'Garden care.',sections:[{heading:'Hours',text:'Monday through Friday'}]}),html=renderSite(page);
 await db.prepare("INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at) VALUES(?,?,'site-page@1',?,?,?,?)").bind(original,project,JSON.stringify(page),html,sha(html).toString('hex'),now()).run();
 const q=await chat('Prepare a review to use my saved homepage '+original+' in project '+project+' for structured website editing. Keep its words and theme exactly the same. Do not publish.');
 const privatePath='/api/specification-reviews/'+q.id+'/preview';assert.equal((await fetch(base+privatePath)).status,401);const proposed=await call(privatePath);assert.equal(proposed.status,200);assert.equal(await proposed.text(),html);
 const v1=await approve(q);assert.equal(await preview(v1),html);assert.equal((await call(privatePath)).status,409);
 const change=await chat('Change only my Hours section to “Monday through Saturday” in the saved website configuration for project '+project+'. Inspect its current specification first and prepare the exact private review. Do not publish.');
 const diff=await call('/api/specification-reviews/'+change.id+'/diff');assert.equal(diff.status,200);assert.match(await diff.text(),/Monday through Saturday/);
 const v2=await approve(change);assert.match(await preview(v2),/Monday through Saturday/);assert.equal(await preview(v1),html);
 const restore=await chat('Prepare a private configuration restore to saved version '+v1+' in project '+project+'. Save it as a new forward version only after I approve the review; do not publish.');
 const v3=await approve(restore);assert.equal(await preview(v3),html);
 const head=await db.prepare('SELECT revision,version_id FROM project_spec_heads WHERE project_id=?').bind(project).first();assert.equal(head.revision,3);assert.equal(head.version_id,v3);
 assert.equal((await db.prepare('SELECT count(*) n FROM project_spec_applies WHERE project_id=?').bind(project).first()).n,3);
 assert.equal((await db.prepare('SELECT count(*) n FROM publications WHERE project_id=? AND version_id IS NOT NULL').bind(project).first()).n,0);
 assert.equal((await fetch('https://'+project+'.whumpo.site/')).status,404);
 const billing=await json('/api/billing');assert.equal(billing.quota.spent,0);assert.equal(billing.quota.reserved,0);
 await json('/api/auth/logout','POST',{});assert.equal((await call('/api/me')).status,401);success=true;
}catch(error){originalFailure=error;throw error;}finally{
 // Only this fixture identity is eligible for cleanup; no customer publications/resources exist.
 try{await db.prepare('DELETE FROM users WHERE id=? AND email=?').bind(id,email).run();}catch{await writeFile('.secrets/specification-live-evidence.json',JSON.stringify({at:now(),success:false,cleanupVerified:false,originalFailure:originalFailure?.message??null}),{mode:0o600});throw Error('Synthetic fixture cleanup failed; preserve its identity file and inspect the recorded original outcome.');}
 assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind(id).first(),null);
 if(project)assert.equal(await db.prepare('SELECT id FROM projects WHERE id=?').bind(project).first(),null);
 await rm(cleanupFile);
 const evidence={at:now(),success,...(originalFailure?{failure:originalFailure.message}:{}),scope:'Real test Workers/D1, signed synthetic passkey login, configured model interpretation, private specification import/change/preview/apply/forward restore and exact retries; no public content, provider activation or CMS work.',cleanupVerified:true};
 await writeFile('.secrets/specification-live-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(evidence));
}
