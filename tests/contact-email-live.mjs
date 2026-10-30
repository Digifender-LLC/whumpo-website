// Explicit opt-in WH-036 canary: sends at most 2 real emails (one verification code, one new-message notice) to CANARY_EMAIL.
// Phases (CANARY_PHASE): send-verify | confirm (CANARY_CODE) | cleanup. The address is read only from the environment
// and is never written to a file, evidence or log; output shows it redacted. Live writes touch only the synthetic account.
import assert from 'node:assert/strict';
import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {liveWorkspaceBrowser,requireCurrentProbeSchema,seedCurrentProbeIdentity} from './helpers/live-workspace.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
import {cloudflareClient,remoteD1} from '../tools/cms-cloudflare.mjs';
if(process.env.RUN_LIVE_CONTACT_EMAIL!=='1')throw Error('Set RUN_LIVE_CONTACT_EMAIL=1 for the live contact email canary');
const phase=process.env.CANARY_PHASE,file='.secrets/contact-email-live-account.json',base='https://whumpo.com';
assert.ok(['send-verify','confirm','cleanup'].includes(phase),'CANARY_PHASE must be send-verify, confirm or cleanup');
const address=(process.env.CANARY_EMAIL??'').trim().toLowerCase();
const redacted=address.replace(/^(.)[^@]*@/,'$1***@');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));assert.equal(config.vars.ENVIRONMENT,'test');
const db=remoteD1(cloudflareClient(config.account_id),config.d1_databases.find(d=>d.binding==='DB').database_id);
const emailFor=id=>'contactemail-fixture-'+id+'@example.test';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const saved=async()=>JSON.parse(await readFile(file,'utf8'));
const templateOf={verification:'owner.destination-verification@1',new_message:'contact.new-message@1'};
const outbox=(project,kind)=>db.prepare('SELECT state,reason AS last_error,attempts,provider_ref FROM notification_notices WHERE project_id=? AND template=? ORDER BY created_at DESC LIMIT 1').bind(project,templateOf[kind]).first();
const label=r=>!r?'none':r.state==='accepted'||r.state==='delivered'?'sent':r.state==='unknown-outcome'?'uncertain':['queued','dispatching','deferred'].includes(r.state)?'queued':'failed';
async function wait(project,kind,minutes=5){
 const start=Date.now();let row;
 while(Date.now()-start<minutes*60000){row=await outbox(project,kind);if(row&&!['queued','dispatching','deferred'].includes(row.state))break;await sleep(10000);}
 return {state:label(row),detail:row&&{state:row.state,last_error:row.last_error,attempts:row.attempts,provider_ref:row.provider_ref},seconds:Math.round((Date.now()-start)/1000)};
}
async function cleanup({id,project}){
 await db.prepare('DELETE FROM users WHERE id=? AND email=?').bind(id,emailFor(id)).run();
 for(const t of ['users WHERE id','identity_accounts WHERE account_id','identity_sessions WHERE account_id','identity_credentials WHERE account_id','projects WHERE owner_user_id'])assert.equal(await db.prepare('SELECT 1 FROM '+t+'=?').bind(id).first(),null,'Cleanup left rows in '+t.split(' ')[0]);
 for(const t of ['contact_notification_destinations','notification_notices','contact_settings'])assert.equal(await db.prepare('SELECT 1 FROM '+t+' WHERE project_id=?').bind(project).first(),null,'Cleanup left rows in '+t);
 await rm(file,{force:true});console.log(JSON.stringify({cleanup:'verified'}));
}
await requireCurrentProbeSchema(db);
if(phase==='cleanup')await cleanup(await saved());
else if(phase==='send-verify'){
 assert.match(address,/^[^\s@]+@[^\s@]+\.[^\s@]+$/,'Set CANARY_EMAIL');
 try{await readFile(file);throw Error('A canary account already exists; run the cleanup phase first');}catch(e){if(e.code!=='ENOENT')throw e;}
 const id=crypto.randomUUID(),project=crypto.randomUUID(),version=crypto.randomUUID(),email=emailFor(id);
 await mkdir('.secrets',{recursive:true});await writeFile(file,JSON.stringify({id,project}),{mode:0o600});
 const [key]=await seedCurrentProbeIdentity(db,id,email),now="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
 await db.prepare("INSERT INTO user_profiles(user_id,name) VALUES(?,'Canary')").bind(id).run();
 await db.prepare(`INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,'Canary',${now},${now})`).bind(project,id).run();
 await db.prepare(`INSERT INTO welcome_onboarding(user_id,stage,prompt,project_id,project_name,idea,completed_at) VALUES(?,'complete','review',?,'Canary','Canary',${now})`).bind(id,project).run();
 await db.prepare(`INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at) VALUES(?,?,'site-page@1','{}','<p>canary</p>','canary',${now})`).bind(version,project).run();
 await db.prepare('INSERT INTO publications(project_id,revision,version_id) VALUES(?,0,?)').bind(project,version).run();
 await db.prepare('INSERT INTO contact_settings(project_id,revision,enabled,publication_revision) VALUES(?,0,1,0)').bind(project).run();
 const browser=liveWorkspaceBrowser(base);await browser.login(key,id);
 const path='/api/projects/'+project+'/contact-notifications';
 await browser.json(path,'PUT',{address}); // the real Dashboard control route
 const started=Date.now(),requested=await browser.json(path+'/verification','POST');
 console.log(JSON.stringify({destination:redacted,verificationRequest:requested}));
 assert.equal(requested.status,'queued','Delivery is not active on the deployment; nothing was queued');
 const result=await wait(project,'verification');
 await browser.logout();
 console.log(JSON.stringify({phase,destination:redacted,verification:result,totalSeconds:Math.round((Date.now()-started)/1000),account:'kept for confirm/cleanup'}));
}else{
 const {id,project}=await saved(),code=process.env.CANARY_CODE??'';assert.match(code,/^[A-Za-z0-9]{8}$/,'Set CANARY_CODE');
 // Only the account handle and project id are saved, so add a fresh synthetic passkey to the same account to sign in.
 const key=authenticator(),hex=Buffer.from(key.publicKey).toString('hex');assert.match(hex,/^[a-f0-9]+$/);
 await db.prepare(`INSERT INTO identity_credentials(id,account_id,public_key,counter,name,status,created_at) VALUES(?,?,X'${hex}',0,'Synthetic canary key 3','active',unixepoch())`).bind(key.id,id).run();
 const browser=liveWorkspaceBrowser(base);await browser.login(key,id);
 const confirmed=await browser.json('/api/projects/'+project+'/contact-notifications/confirm','POST',{code});
 console.log(JSON.stringify({confirmed:confirmed.destination?.state}));
 await browser.logout();
 // Step 2 needs a visitor POST to /contact/<project>, which in a non-local environment requires a real Turnstile token.
 // No live test has a bypass, so stop here instead of inventing one. Account is kept; run cleanup when done.
 throw Error('Stopped: no Turnstile bypass exists in the live tests, so the visitor message cannot be submitted. Run the cleanup phase.');
}
