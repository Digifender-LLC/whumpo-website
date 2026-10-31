import {timingSafeEqual} from 'node:crypto';
import {createServer} from 'node:http';
import {writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
import {createFixtureWebsite,proposeFixtureWebsite} from './current-site-fixture.mjs';

// WH-084 slice: the REAL Worker module (src/index) on disposable SQLite, served over plain HTTP on 127.0.0.1 so an Android emulator
// can reach it through `adb reverse tcp:8787 tcp:8787`. This is NOT `wrangler dev`/workerd, and nothing here is a bypass: every
// request goes through worker.fetch with the same env the node suites use (test environment, permissive limiters, no model, no Stripe,
// no provider, no secret). It seeds one synthetic owner with a ready account, one passkey the emulator test double signs for, one project
// and one pending specification review (fresh passkey required). It issues NO session: the app must sign in with an assertion.
//
// usage: SEED_FILE=<path> [PORT=8787] node tests/android-local-worker.mjs   (databaseFixture rejects extra argv, so env it is; prints "READY <port>" when listening; Ctrl-C or SIGTERM stops it)
const seedFile=process.env.SEED_FILE;
if(!seedFile){console.error('usage: SEED_FILE=<path> [PORT=8787] node tests/android-local-worker.mjs');process.exit(2);}
const port=Number(process.env.PORT??8787);
const bundle=await build({stdin:{contents:[
 "export {default as worker} from './src/index';export {androidPasskeyOrigins} from './src/android-signing';",
 "export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",
 "export {newSessionToken,hashToken} from './src/security';",
 "export {createWebsite,prepareSpecification,readSpecificationProposal} from './src/project-specification/store';export {readChat,sendChat,sendChatControl} from './src/chat';"
 ].join(''),resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run();
const env={DB:db,ENVIRONMENT:'test',MOBILE_MINIMUM_BUILD:'1',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const ctx={waitUntil(){}};

const account=id(),key=authenticator(),project=id(),now=new Date().toISOString();
await run("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",account,`owner${account.slice(0,6)}@example.test`);
await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)",account,'a'.repeat(64),id());
await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)",key.id,account,key.publicKey);
// Only used to read the seeded project through the same admission path the suites use; it is deleted before the server listens.
const setupToken=m.newSessionToken();
await run("INSERT INTO identity_sessions(id,token_hash,account_id,policy_version,auth_epoch,client,credential_id,proof_method,proof_at,issued_at,expires_at) VALUES(?,?,?,1,1,'android',?,'passkey',unixepoch(),unixepoch(),unixepoch()+600)",id(),await m.hashToken(setupToken),account,key.id);
const scope=async()=>m.admitWorkspace(db,await m.resolveIdentity(db,{version:1,client:'android',kind:'session',token:setupToken}));
await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',?,?)",project,account,now,now);
await createFixtureWebsite(await scope(),account,project,{name:'Garden',headline:'Neighborhood gardens',description:'Local gardening',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[],photos:[]},m);
await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','read','private-test-acceptance','synthetic android emulator journey',unixepoch()-1,unixepoch()+36000,unixepoch(),NULL)",id(),account,project);
const review=await proposeFixtureWebsite(await scope(),account,project,[{type:'content.replace',contentId:'headline',text:'Seasonal garden care'}],m);
await run('DELETE FROM identity_sessions WHERE account_id=?',account);

const credential=key.virtualCredential('whumpo.com',account);
writeFileSync(seedFile,JSON.stringify({
 note:'synthetic emulator fixture; the key signs only for this disposable database',
 accountHandle:Buffer.from(account).toString('base64url'),credentialId:key.id,privateKeyPkcs8:credential.privateKey,
 origin:m.androidPasskeyOrigins[0],project,reviewId:review.id,headline:'Seasonal garden care'
}),{mode:0o600});

const log=[];
const server=createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);
 const body=chunks.length?Buffer.concat(chunks):undefined;
 const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string'&&k!=='host'&&k!=='connection')headers.set(k,v);
 // The Worker sees its public origin; the emulator's 127.0.0.1:8787 is only the transport.
 const response=await m.worker.fetch(new Request('https://whumpo.com'+req.url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body}),env,ctx);
 const bytes=Buffer.from(await response.arrayBuffer());
 log.push(`${req.method} ${req.url.split('?')[0]} ${response.status}`);
 res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);
});
server.listen(port,'127.0.0.1',()=>console.log(`READY ${port}`));
const stop=async()=>{console.log('REQUESTS\n'+log.join('\n'));server.close();await fixture.close();process.exit(0);};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
