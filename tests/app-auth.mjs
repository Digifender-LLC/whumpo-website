import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
import {authenticator} from './app-authenticator.mjs';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const auth=await module('src/app-auth.ts'),data=await module('src/app-data.ts'),{saveBackend,testBackend}=await module('src/backend-versions.ts'),{prepareApplication,confirmApplication}=await module('src/app-activation.ts');
const {applicationGateway}=await module('src/app-gateway.ts');
const dir=await mkdtemp('/tmp/townhello-app-auth-');
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
async function app(){
 const user=id(),project=id(),version=id(),test=id();
 await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now()).run();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'App auth fixture','','draft',?,?)").bind(project,user,now(),now()).run();
 await saveBackend(db,user,project,version,'export default ({state,input})=>({state:input,result:state})');
 await testBackend(db,{fetch:()=>Response.json({ok:true,value:{state:{},result:{}}})},user,project,version,test,{state:{},input:{}});
 const a={user,project,version,test};await configure(a,'enable');return a;
}
async function configure(a,operation){const review=id();await prepareApplication(db,a.user,a.project,review,operation,...(operation==='enable'?[a.version,a.test]:[null,null]));await confirmApplication(db,a.user,review);}
const begin=(a,kind='login',secret='')=>auth.appPasskeyOptions(db,a.project,kind,false,secret);
const verify=(a,kind,options,response,database=db,session='')=>auth.appPasskeyVerify(database,a.project,kind,options.challengeToken,response,false,session);
async function signup(a){const invite=await auth.createAppInvitation(db,a.user,a.project),opt=await begin(a,'signup',invite.code),key=authenticator(),result=await verify(a,'signup',opt,key.registration(opt.options));return {...result,key,invite};}
async function denied(promise,status){await assert.rejects(promise,e=>status?e.status===status:true);}
try {
 const a=await app(),b=await app();
 await denied(auth.createAppInvitation(db,b.user,a.project),404);
 await denied(begin(a,'signup','a'.repeat(64)),403);
 const invite=await auth.createAppInvitation(db,a.user,a.project),key=authenticator();
 await denied(begin(b,'signup',invite.code),403);
 let opt=await begin(a,'signup',invite.code);
 assert.equal(opt.options.authenticatorSelection.userVerification,'required');assert.equal(opt.options.authenticatorSelection.residentKey,'required');
 await denied(verify(a,'signup',opt,key.registration(opt.options,'https://digifender.com')),400);
 await denied(verify(a,'signup',opt,key.registration(opt.options)),400);
 opt=await begin(a,'signup',invite.code);
 await denied(auth.appPasskeyVerify(db,a.project,'signup','b'.repeat(64),key.registration(opt.options)),400);
 const registered=await verify(a,'signup',opt,key.registration(opt.options));
 await denied(begin(a,'signup',invite.code),403);
 assert.deepEqual(await data.readAppData(db,registered.session,a.project),{revision:0,state:{}});
 await denied(data.readAppData(db,registered.session,b.project),401);
 const other=await signup(a);
 opt=await begin(b);await denied(verify(b,'login',opt,key.assertion(opt.options)),401);
 opt=await begin(a);await denied(verify(a,'login',opt,key.assertion(opt.options,1,{uv:false})),401);
 opt=await begin(a);await denied(verify(a,'login',opt,key.assertion(opt.options,1,{handle:'wrong'})),401);
 opt=await begin(a);const signed=await verify(a,'login',opt,key.assertion(opt.options,1));
 assert.equal(signed.visitorId,registered.visitorId);
 await denied(verify(a,'login',opt,key.assertion(opt.options,2)),400);
 opt=await begin(a);await denied(verify(a,'login',opt,key.assertion(opt.options,1)),401);
 // Same invitation can have competing valid registration challenges: only one visitor commits.
 const raceInvite=await auth.createAppInvitation(db,a.user,a.project),raceOpts=await Promise.all([begin(a,'signup',raceInvite.code),begin(a,'signup',raceInvite.code)]);
 const race=await Promise.allSettled(raceOpts.map(o=>verify(a,'signup',o,authenticator().registration(o.options))));
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await db.prepare('SELECT count(*) n FROM app_visitors WHERE project_id=?').bind(a.project).first()).n,3);
 // Duplicate credential insertion rolls back the visitor and leaves its invite usable.
 const duplicateInvite=await auth.createAppInvitation(db,a.user,a.project);
 const duplicateKey=authenticator(),duplicateOptions=await begin(a,'signup',duplicateInvite.code);
 await verify(a,'signup',duplicateOptions,duplicateKey.registration(duplicateOptions.options));
 const retryInvite=await auth.createAppInvitation(db,a.user,a.project),retryOptions=await begin(a,'signup',retryInvite.code);
 await denied(verify(a,'signup',retryOptions,duplicateKey.registration(retryOptions.options)));
 assert.equal((await db.prepare('SELECT count(*) n FROM app_visitors WHERE project_id=?').bind(a.project).first()).n,4);
 assert.ok(await begin(a,'signup',retryInvite.code));
 // Lost commit acknowledgment does not lead to automatic enrollment replay.
 const lostInvite=await auth.createAppInvitation(db,a.user,a.project),lostOptions=await begin(a,'signup',lostInvite.code),lostKey=authenticator();
 const lossy=new Proxy(db,{get(target,name){if(name==='batch')return async statements=>{await target.batch(statements);throw Error('lost acknowledgment');};const value=target[name];return typeof value==='function'?value.bind(target):value;}});
 const lostResponse=lostKey.registration(lostOptions.options);
 await denied(verify(a,'signup',lostOptions,lostResponse,lossy));
 await denied(verify(a,'signup',lostOptions,lostResponse),400);
 opt=await begin(a);assert.ok((await verify(a,'login',opt,lostKey.assertion(opt.options))).session);
 // A configuration change invalidates even an otherwise valid signed assertion.
 opt=await begin(a);await configure(a,'enable');await denied(verify(a,'login',opt,key.assertion(opt.options,2)),409);
 const staleInvite=await auth.createAppInvitation(db,a.user,a.project);opt=await begin(a,'signup',staleInvite.code);await configure(a,'enable');await denied(verify(a,'signup',opt,authenticator().registration(opt.options)),409);
 // Recovery keeps the same private data and replaces every old credential/session.
 await data.transitionAppData(db,{fetch:()=>Response.json({ok:true,value:{state:{private:'saved'},result:true}})},signed.session,a.project,id(),0,{});
 await denied(auth.recoverAppVisitor(db,b.project,registered.recoveryCode),401);
 const recovered=await auth.recoverAppVisitor(db,a.project,registered.recoveryCode);
 assert.equal(recovered.visitorId,registered.visitorId);assert.notEqual(recovered.recoveryCode,registered.recoveryCode);
 await denied(auth.recoverAppVisitor(db,a.project,registered.recoveryCode),401);
 await denied(data.readAppData(db,signed.session,a.project),401);
 assert.deepEqual((await data.readAppData(db,recovered.session,a.project)).state,{private:'saved'});
 assert.deepEqual((await data.readAppData(db,other.session,a.project)).state,{});
 opt=await begin(a);await denied(verify(a,'login',opt,key.assertion(opt.options,2)),401);
 const replacement=authenticator();opt=await begin(a,'add',recovered.session);await denied(verify(a,'add',opt,replacement.registration(opt.options),db,other.session),401);
 opt=await begin(a,'add',recovered.session);await verify(a,'add',opt,replacement.registration(opt.options),db,recovered.session);
 opt=await begin(a);const restored=await verify(a,'login',opt,replacement.assertion(opt.options,1));assert.equal(restored.visitorId,registered.visitorId);
 // Recovery between cryptographic verification and session commit cannot revive an old key.
 opt=await begin(a);
 let raced=false;
 const recoveryRace=new Proxy(db,{get(target,name){if(name==='batch')return async statements=>{if(!raced){raced=true;await auth.recoverAppVisitor(db,a.project,recovered.recoveryCode);}return target.batch(statements);};const value=target[name];return typeof value==='function'?value.bind(target):value;}});
 await denied(verify(a,'login',opt,replacement.assertion(opt.options,2),recoveryRace),409);
 await denied(data.readAppData(db,restored.session,a.project),401);
 // Owner revocation clears keys, recovery and sessions; another owner's authority is rejected.
 await denied(auth.revokeAppVisitor(db,b.user,a.project,other.visitorId),404);
 await auth.revokeAppVisitor(db,a.user,a.project,other.visitorId);
 await denied(data.readAppData(db,other.session,a.project),401);
 await denied(auth.recoverAppVisitor(db,a.project,other.recoveryCode),401);
 assert.equal((await db.prepare('SELECT count(*) n FROM app_passkeys WHERE visitor_id=?').bind(other.visitorId).first()).n,0);
 // Expiration and disable/re-enable cannot replay old challenges or restore sessions.
 const exp=await begin(b);
 const expired=await db.prepare('DELETE FROM app_auth_challenges WHERE challenge=? RETURNING *').bind(exp.options.challenge).first();
 await db.prepare('INSERT INTO app_auth_challenges(token_hash,project_id,program_revision,challenge,kind,visitor_id,invite_hash,session_hash,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(expired.token_hash,expired.project_id,expired.program_revision,expired.challenge,expired.kind,expired.visitor_id,expired.invite_hash,expired.session_hash,'2000-01-01T00:00:00.000Z').run();
 await denied(verify(b,'login',exp,key.assertion(exp.options,3)),400);
 const disabled=await signup(b);opt=await begin(b);await configure(b,'disable');await denied(verify(b,'login',opt,disabled.key.assertion(opt.options)),404);await denied(data.readAppData(db,disabled.session,b.project),401);
 await configure(b,'enable');await denied(data.readAppData(db,disabled.session,b.project),401);
 // Counterless authenticators still use a database revision to serialize sign-ins.
 const zero=await signup(b),zeroOptions=await Promise.all([begin(b),begin(b)]);
 let arrived=0,release;const gate=new Promise(resolve=>release=resolve);
 const simultaneous=new Proxy(db,{get(target,name){if(name==='batch')return async statements=>{if(++arrived===2)release();await gate;return target.batch(statements);};const value=target[name];return typeof value==='function'?value.bind(target):value;}});
 const zeros=await Promise.allSettled(zeroOptions.map(o=>verify(b,'login',o,zero.key.assertion(o.options,0),simultaneous)));
 assert.equal(zeros.filter(r=>r.status==='fulfilled').length,1);
 // A transferred project cannot issue invitations or accept its prior visitor credentials.
 opt=await begin(b);await db.prepare('UPDATE projects SET owner_user_id=? WHERE id=?').bind(a.user,b.project).run();
 await denied(verify(b,'login',opt,zero.key.assertion(opt.options)),404);
 await denied(auth.createAppInvitation(db,b.user,b.project),404);
 const raw=JSON.stringify((await db.prepare('SELECT * FROM app_invitations').all()).results)+JSON.stringify((await db.prepare('SELECT * FROM app_sessions').all()).results)+JSON.stringify((await db.prepare('SELECT * FROM app_recovery_codes').all()).results);
 for(const secret of [invite.code,registered.session,registered.recoveryCode,recovered.session,recovered.recoveryCode])assert.ok(!raw.includes(secret));
 // Exercise the HTTP adapter with the same real D1 and signed credentials.
 const c=await app(),host='https://apps.digifender.com',jar=new Map();let executions=0;
 const env={...proxy.env,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:{fetch:async(_url,init)=>{executions++;const payload=JSON.parse(init.body).input;assert.deepEqual(Object.keys(payload),['state','input']);return Response.json({ok:true,value:{state:payload.input,result:'saved'}});}}};
 async function request(path,method='GET',payload,settings={}){
  const headers={'cf-connecting-ip':'192.0.2.9',...(!settings.noOrigin?{origin:settings.origin??host}:{}),'content-type':'application/json',cookie:settings.cookie??[...jar].map(([k,v])=>k+'='+v).join('; ')};
  const response=await applicationGateway(new Request((settings.host??host)+'/apps/'+c.project+'/'+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)}),settings.env??env);
  const cookies=response.headers.getSetCookie();if(!settings.noSave)for(const cookie of cookies){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
  const result=await response.json();assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('access-control-allow-origin'),null);return {response,result,cookies};
 }
 assert.equal((await request('data')).response.status,401);
 assert.equal((await request('data','GET',undefined,{host:'https://digifender.com'})).response.status,404);
 assert.equal((await request('auth/login/options','POST',{}, {noOrigin:true})).response.status,403);
 assert.equal((await request('auth/login/options','POST',{}, {origin:'https://foreign.example'})).response.status,403);
 assert.equal((await request('auth/login/options','POST',{large:'x'.repeat(17000)})).response.status,413);
 assert.equal((await request('auth/login/options','POST',[],{})).response.status,400);
 assert.equal((await request('auth/login/options','POST',{}, {env:{...env,AUTH_LIMITER:{limit:async()=>({success:false})}}})).response.status,429);
 const httpInvite=await auth.createAppInvitation(db,c.user,c.project),httpKey=authenticator();
 const httpOptions=await request('auth/signup/options','POST',{inviteCode:httpInvite.code});assert.equal(httpOptions.response.status,200);assert.deepEqual(Object.keys(httpOptions.result),['options']);
 for(const value of httpOptions.cookies){assert.match(value,/^__Host-/);assert.match(value,/; HttpOnly; SameSite=Strict;/);assert.match(value,/; Secure$/);assert.ok(!value.includes('Domain='));}
 const httpCredential=httpKey.registration(httpOptions.result.options);
 assert.equal((await request('auth/signup/verify','POST',{credential:httpCredential},{cookie:'',noSave:true})).response.status,400);
 const httpSignup=await request('auth/signup/verify','POST',{credential:httpCredential});assert.equal(httpSignup.response.status,200);assert.deepEqual(Object.keys(httpSignup.result).sort(),['authenticated','recoveryCode']);
 assert.equal((await request('data','GET',undefined,{cookie:'tellumo_session='+'a'.repeat(64)})).response.status,401);
 assert.deepEqual((await request('data')).result,{revision:0,state:{}});
 const operation=id();const saved=await request('data','POST',{id:operation,revision:0,input:{hello:'private'}});assert.equal(saved.response.status,200);assert.equal(saved.result.state,'complete');assert.equal(executions,1);
 assert.deepEqual((await request('receipts/'+operation)).result,saved.result);
 assert.deepEqual((await request('data','POST',{id:operation,revision:0,input:{hello:'private'}})).result,saved.result);assert.equal(executions,1);
 assert.equal((await request('receipts/'+id())).response.status,404);
 const foreign=await signup(c),name=[...jar.keys()].find(k=>k.includes('-session-'));
 assert.equal((await request('receipts/'+operation,'GET',undefined,{cookie:name+'='+foreign.session})).response.status,404);
 const oldCookie=[...jar].map(([k,v])=>k+'='+v).join('; '),httpRecovered=await request('auth/recover','POST',{code:httpSignup.result.recoveryCode});assert.equal(httpRecovered.response.status,200);assert.equal('session' in httpRecovered.result,false);
 assert.equal((await request('data','GET',undefined,{cookie:oldCookie})).response.status,401);
 assert.deepEqual((await request('data')).result.state,{hello:'private'});
 await request('auth/logout','POST',{});assert.equal((await request('data')).response.status,401);
 console.log('App visitor auth passed: real signed passkeys, origin/UV/project separation, single-use challenges/invites, concurrent enrollment, epoch guards, private data, recovery rotation, credential race, owner revocation, disabled-app denial and hashed secrets.');
 console.log('App gateway passed: host isolation, HttpOnly secure project cookies, browser challenge binding, bounded JSON, origin/rate checks, no CORS, private state/receipts, idempotent retry, recovery and logout. Gateway is not publicly mounted.');
} finally {await proxy.dispose();await rm(dir,{recursive:true,force:true});}
