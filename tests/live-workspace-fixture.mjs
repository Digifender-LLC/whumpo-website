// Local verification of the authority used by opt-in deployment probes.
import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {liveWorkspaceBrowser,seedCurrentProbeIdentity} from './helpers/live-workspace.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db;
const originalEqual=crypto.subtle.timingSafeEqual,originalFetch=globalThis.fetch;
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
globalThis.fetch=async()=>{throw Error('No provider transport is permitted in fixture verification');};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){throw Error('No background dispatch expected');}};
const browser=liveWorkspaceBrowser('https://whumpo.com',(url,init)=>m.worker.fetch(new Request(url,init),env,ctx));
const id=crypto.randomUUID(),email='specification-fixture-'+id+'@example.test';
try{
 // Occupied obsolete/drifted databases must be refused before any fixture row exists.
 await db.prepare('CREATE TABLE obsolete_probe_table (id TEXT)').run();
 await assert.rejects(()=>seedCurrentProbeIdentity(db,id,email),/exact current schema/);
 assert.equal((await db.prepare('SELECT count(*) n FROM users').first()).n,0);
 await db.prepare('DROP TABLE obsolete_probe_table').run();
 const keys=await seedCurrentProbeIdentity(db,id,email);
 assert.equal((await db.prepare('SELECT count(*) n FROM identity_credentials WHERE account_id=?').bind(id).first()).n,2);
 assert.equal((await browser.call('/api/profile')).status,401);
 await browser.login(keys[0],id);
 assert.equal((await browser.call('/api/chat')).status,409);
 await browser.json('/api/profile','PATCH',{revision:0,name:'River',avatar_id:'sun',about_me:'',share_context:false});
 await browser.json('/api/onboarding');
 await browser.json('/api/onboarding','PUT',{revision:0,stage:'review',prompt:'review',project_name:'Example Garden',idea:'A synthetic landscaping website for private deployment verification.',audience:'Neighbors',preferred_theme:'forest'});
 await browser.json('/api/onboarding/complete','POST',{revision:1});
 assert.equal((await browser.call('/api/chat')).status,200);
 assert.equal((await db.prepare('SELECT count(*) n FROM projects WHERE owner_user_id=?').bind(id).first()).n,1);
 await browser.logout();
 await browser.login(keys[1],id);
 assert.equal((await browser.call('/api/profile')).status,200);
 await browser.logout();
 assert.equal((await db.prepare('SELECT count(*) n FROM identity_sessions').first()).n,0);
 await db.prepare('DELETE FROM users WHERE id=? AND email=?').bind(id,email).run();
 for(const table of ['users','identity_accounts','identity_credentials','identity_sessions','projects','publications','inference_calls'])assert.equal((await db.prepare('SELECT count(*) n FROM '+table).first()).n,0,table+' must be empty after fixture cleanup');
 const processEnv={...process.env};for(const key of ['RUN_LIVE_MUSE','RUN_LIVE_SERVICE_CLIENTS','RUN_LIVE_SPECIFICATION'])delete processEnv[key];
 for(const name of ['agent-inspection','project-brief','workspace-shortcuts','welcome-ai','service-client','specification']){
  await assert.rejects(promisify(execFile)(process.execPath,['--stack-trace-limit=0','tests/'+name+'-live.mjs'],{env:processEnv,encoding:'utf8',timeout:30000}),error=>{assert.equal(error.killed,false);assert.equal(error.code,1);assert.match(error.stderr,/Set RUN_LIVE_/);assert.equal(error.stdout,'');return true;});
 }
 console.log('Live-probe fixture passed on current local D1: drift refusal before writes, two independently signed keys, current cookies/login/logout, exact welcome checkpoint, private workspace admission, scoped cleanup and all six explicit opt-in guards. No remote access, model call, enrollment or physical-device acceptance.');
}finally{globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await store.close();}
