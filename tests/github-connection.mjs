import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {startGitHub,cancelGitHub,finishGitHub,disconnectGitHub,connectionStatus,githubInstallations,cleanupGitHub}=await module('src/github-connection.ts');const {seal,unseal}=await module('src/connection-vault.ts');
const dir=await mkdtemp('/tmp/whumpo-github-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
const config={clientId:'Iv1.test',clientSecret:'synthetic-secret',appId:123,slug:'whumpo-test',key:'ab'.repeat(32)};
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();return id;}
const denied=async()=>{throw Error('No transport expected');};let calls=0,exchanges=0,revocations=[];
function provider(start,{token='ghu_synthetic',expires=28800,revokeStatus=204,userStatus=200,beforeUser}={}){return async(url,init={})=>{calls++;assert.equal(init.redirect,'manual');assert.ok(init.signal);const parsed=new URL(url);
 if(url==='https://github.com/login/oauth/access_token'){exchanges++;const body=JSON.parse(init.body);assert.equal(body.client_secret,config.clientSecret);assert.equal(body.redirect_uri,'https://whumpo.com/api/connections/github/callback');const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.code_verifier))).toString('base64url');assert.equal(digest,new URL(start.url).searchParams.get('code_challenge'));assert.equal(parsed.search,'');return Response.json({access_token:token,expires_in:expires,refresh_token:'discard-this-refresh-token'});}
 if(url==='https://api.github.com/user'){if(beforeUser)await beforeUser();return Response.json({id:44,login:'synthetic-user'},{status:userStatus});}
 if(url==='https://api.github.com/user/installations?per_page=100')return Response.json({total_count:3,installations:[{id:1,app_id:123,suspended_at:null,account:{login:'synthetic-org'},repository_selection:'selected'},{id:2,app_id:999,account:{login:'other-app'}},{id:3,app_id:123,suspended_at:'yesterday',account:{login:'suspended'}}]});
 if(url==='https://api.github.com/applications/Iv1.test/token'){assert.equal(init.method,'DELETE');assert.ok(init.headers.authorization.startsWith('Basic '));revocations.push(JSON.parse(init.body).access_token);return new Response(null,{status:revokeStatus});}throw Error('Unexpected URL '+url);
 };}
async function start(user,session='session-a'){return startGitHub(db,user,session,config);}
async function finish(user,s,transport,session='session-a'){return finishGitHub(db,user,session,new URL(s.url).searchParams.get('state'),'test-code',config,transport);}
try{
 const user=await account(),other=await account();
 assert.equal((await connectionStatus(db,user,undefined)).github.enabled,false);await assert.rejects(()=>startGitHub(db,user,'session',undefined));
 const ciphertext=await seal(config.key,'user-one','secret');assert.ok(!ciphertext.includes('secret'));assert.equal(await unseal(config.key,'user-one',ciphertext),'secret');await assert.rejects(()=>unseal(config.key,'user-two',ciphertext));await assert.rejects(()=>unseal('cd'.repeat(32),'user-one',ciphertext));
 const s=await start(user);assert.equal(new URL(s.url).origin,'https://github.com');assert.equal(new URL(s.url).searchParams.get('code_challenge_method'),'S256');assert.equal(new URL(s.url).searchParams.get('scope'),null);
 await assert.rejects(()=>finish(other,s,denied));await assert.rejects(()=>finish(user,s,denied,'different-session'));
 await finish(user,s,provider(s));let status=await connectionStatus(db,user,config);assert.equal(status.github.connected,true);assert.equal(status.github.login,'synthetic-user');assert.ok(!JSON.stringify(status).includes('ghu_'));assert.equal((await connectionStatus(db,other,config)).github.connected,false);
 const vault=await db.prepare('SELECT * FROM github_token_vault WHERE user_id=?').bind(user).first();assert.ok(!vault.ciphertext.includes('ghu_synthetic'));assert.ok(!JSON.stringify(vault).includes('discard-this-refresh-token'));
 const priorExchanges=exchanges;await assert.rejects(()=>finish(user,s,denied));assert.equal(exchanges,priorExchanges);
 const installations=await githubInstallations(db,user,config,provider(s));assert.deepEqual(installations.installations,[{id:1,account:'synthetic-org',repositorySelection:'selected'}]);await assert.rejects(()=>githubInstallations(db,other,config,denied));
 await assert.rejects(()=>db.prepare('INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES(?,?,?,?,?)').bind(other,'99','other',vault.id,new Date().toISOString()).run());
 await disconnectGitHub(db,user,config,provider(s,{revokeStatus:503}));status=await connectionStatus(db,user,config);assert.equal(status.github.connected,false);assert.equal(status.github.revocationPending,true);await assert.rejects(()=>githubInstallations(db,user,config,denied));
 await cleanupGitHub(db,config,provider(s));assert.equal((await connectionStatus(db,user,config)).github.revocationPending,false);assert.ok(revocations.includes('ghu_synthetic'));
 const old=await start(user);const fresh=await start(user);await assert.rejects(()=>finish(user,old,denied));await finish(user,fresh,provider(fresh,{token:'ghu_fresh'}));
 const reconnect=await start(user);await finish(user,reconnect,provider(reconnect,{token:'ghu_reconnect'}));assert.ok(revocations.includes('ghu_fresh'));assert.equal((await connectionStatus(db,user,config)).github.connected,true);
 const racing=await start(user);await assert.rejects(()=>finish(user,racing,provider(racing,{token:'ghu_racing',beforeUser:()=>disconnectGitHub(db,user,config,provider(racing))})));assert.equal((await connectionStatus(db,user,config)).github.connected,false);assert.ok(revocations.includes('ghu_racing'));
 const cancelled=await start(user);await cancelGitHub(db,user,'session-a',new URL(cancelled.url).searchParams.get('state'));await assert.rejects(()=>finish(user,cancelled,denied));
 const expired=await start(user);await db.prepare("UPDATE github_oauth_states SET expires_at='2000-01-01' WHERE user_id=?").bind(user).run();await assert.rejects(()=>finish(user,expired,denied));
 for(const options of [{token:'gho_wrong_app'},{token:'ghu_nonexpiring',expires:undefined},{token:'ghu_failed_user',userStatus:401}]){const flow=await start(user);const actual={...options};if(options.token==='ghu_nonexpiring')actual.expires=0;await assert.rejects(()=>finish(user,flow,provider(flow,actual)));assert.equal((await connectionStatus(db,user,config)).github.connected,false);assert.ok(revocations.includes(options.token));}
 const redirect=await start(user);await assert.rejects(()=>finish(user,redirect,async()=>new Response(null,{status:302,headers:{location:'https://evil.test'}})));await assert.rejects(()=>finish(user,redirect,denied));
 const oversized=await start(user);await assert.rejects(()=>finish(user,oversized,async()=>new Response('x'.repeat(524289))));
 const acknowledged=await start(user);let lost=false;
 const lossy=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{const result=await target.batch(statements);if(!lost&&statements.length===4){lost=true;throw Error('Lost commit acknowledgement');}return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const beforeLost=exchanges;await finishGitHub(lossy,user,'session-a',new URL(acknowledged.url).searchParams.get('state'),'test-code',config,provider(acknowledged,{token:'ghu_acknowledged'}));assert.equal(lost,true);assert.equal(exchanges,beforeLost+1);assert.equal((await connectionStatus(db,user,config)).github.connected,true);
 const final=await start(user);await finish(user,final,provider(final,{token:'ghu_expiring'}));await db.prepare("UPDATE github_token_vault SET expires_at='2000-01-01' WHERE user_id=?").bind(user).run();assert.equal((await connectionStatus(db,user,config)).github.connected,false);await assert.rejects(()=>githubInstallations(db,user,config,denied));await cleanupGitHub(db,config,denied);assert.equal((await db.prepare('SELECT COUNT(*) n FROM github_token_vault WHERE user_id=?').bind(user).first()).n,0);
 console.log('GitHub connection checks passed: PKCE, one-time session state, encrypted user-bound tokens, owner isolation, installation filtering, replacement, cancellation race, immediate disconnect, queued revocation, expiry and bounded provider failures. No real GitHub credentials were used.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
