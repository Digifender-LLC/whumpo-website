// Owner-deferred acceptance; only fixture initialization is aligned here.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
const b=await build({stdin:{contents:"export * from './src/cms-bridge';export * from './src/cms-draft-identity';export * from './src/cms-gateway';export {cmsDraftBody} from './src/cms-content-shape';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {signCMSRequest,verifyCMSRequest,cmsGateway,nativeDraftIdentityAllowed,cmsDraftBody}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-native-identity-');let store;
try{

 store=await databaseFixture({d1:true,r2:true});const db=store.db,id=()=>crypto.randomUUID(),config={projectId:id(),ownerId:id(),secret:'local-identity-fixture-'.repeat(4),origin:'https://cms.test'},env={DB:db,TOWNHELLO_CMS_PROJECT_ID:config.projectId,TOWNHELLO_CMS_OWNER_ID:config.ownerId,TOWNHELLO_CMS_BRIDGE_KEY:config.secret,TOWNHELLO_CMS_ORIGIN:config.origin};
 const path='/_emdash/api/content/posts',body=cmsDraftBody('Private article','The exact requested body.'),items=new Map();let writes=0,reads=0,drop=false,omit=false,mutate=false;
 const dispatch=async request=>{const v=await verifyCMSRequest(request,config);assert.ok(nativeDraftIdentityAllowed(request.method,v.path,v.body,v.id));
  if(request.method==='GET'){reads++;const payload=items.get(v.path.split('/').at(-1));return payload?Response.json(mutate?{...payload,data:{...payload.data,item:{...payload.data.item,data:{...payload.data.item.data,title:'Edited elsewhere'}}}}:payload):Response.json({error:'missing'},{status:404});}
  writes++;const value=JSON.parse(v.body),payload={success:true,data:{_rev:'rev1',item:{id:'01ARZ3NDEKTSV4RRFFQ69G5FAV',slug:value.slug,status:'draft',version:1,data:value.data}}};if(!omit)items.set(value.slug,payload);if(drop)throw Error('Lost native response');return Response.json(payload,{status:201});
 };
 const run=async(requestId,data=body,environment=env)=>cmsGateway(await signCMSRequest(config,path,requestId,data),environment,dispatch);
 const first=id();drop=true;assert.equal((await run(first)).status,409);assert.equal(writes,1);drop=false;const recovered=await run(first);assert.equal(recovered.status,201);assert.equal((await recovered.json()).data.item.slug,'whumpo-draft-'+first);assert.equal(writes,1);assert.equal(reads,1);
 assert.equal((await run(first)).status,201);assert.equal(reads,1);assert.equal((await run(first,cmsDraftBody('Changed','Other'))).status,409);
 assert.equal((await run(id(),{...body,slug:'whumpo-draft-'+id()})).status,403);
 const missing=id();drop=true;omit=true;assert.equal((await run(missing)).status,409);drop=false;omit=false;const count=writes;assert.equal((await run(missing)).status,409);assert.equal(writes,count);
 const changed=id();drop=true;assert.equal((await run(changed)).status,409);drop=false;mutate=true;assert.equal((await run(changed)).status,409);mutate=false;
 // Successful recovery persisted even when its acknowledgement was lost.
 const lostRecovery=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.startsWith('UPDATE _townhello_requests SET status=201'))return statement;return {bind(...args){const bound=statement.bind(...args);return {async run(){await bound.run();throw Error('Lost recovery acknowledgement');}};}};};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 assert.equal((await run(changed,body,{...env,DB:lostRecovery})).status,201);
 // A committed identity reservation with lost acknowledgement cannot dispatch.
 const lostBatch=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{await target.batch(statements);throw Error('Lost reservation acknowledgement');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const lost=id(),before=writes;assert.equal((await run(lost,body,{...env,DB:lostBatch})).status,409);assert.equal(writes,before);assert.equal((await run(lost)).status,409);assert.equal(writes,before);
 // Incomplete receipts have no trustworthy stable identity; refuse recovery.
 const incomplete=id(),verified=await verifyCMSRequest(await signCMSRequest(config,path,incomplete,body),config);await db.prepare('INSERT INTO _townhello_requests(id,request_hash) VALUES(?,?)').bind(incomplete,verified.requestHash).run();const beforeReads=reads;assert.equal((await run(incomplete)).status,409);assert.equal(reads,beforeReads);
 const race=id(),raceBefore=writes;const results=await Promise.all(Array.from({length:5},()=>run(race)));assert.ok(results.every(r=>[201,409].includes(r.status)));assert.equal((await run(race)).status,201);assert.equal(writes,raceBefore+1);
 const foreign={...env,TOWNHELLO_CMS_OWNER_ID:id()};assert.equal((await run(first,body,foreign)).status,403);
 console.log('Draft identity passed: atomic reservation, signed internal identity, read-only lost-response recovery, one dispatch under races, lost reservation/recovery acknowledgements, changed/missing draft refusal, incomplete isolation and owner boundary.');
}finally{if(store)await store.close();await rm(dir,{recursive:true,force:true});}
