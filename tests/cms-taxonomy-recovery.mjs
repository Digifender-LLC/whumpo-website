import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const b=await build({stdin:{contents:"export * from './src/cms-bridge';export * from './src/cms-taxonomy-shape';export * from './src/cms-taxonomy-recovery';export * from './src/cms-gateway';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {signCMSRequest,verifyCMSRequest,cmsGateway,cmsTaxonomyDefinition,cmsTaxonomyTerm,taxonomyIntent,matchesTaxonomyIntent}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-taxonomy-recovery-');let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB,id=()=>crypto.randomUUID(),config={projectId:id(),ownerId:id(),secret:'local-taxonomy-recovery-'.repeat(4),origin:'https://cms.test'},env={DB:db,WHUMPO_CMS_PROJECT_ID:config.projectId,WHUMPO_CMS_OWNER_ID:config.ownerId,WHUMPO_CMS_BRIDGE_KEY:config.secret,WHUMPO_CMS_ORIGIN:config.origin};
 const objects=new Map();let posts=0,gets=0,drop=false,missing=false;
 const dispatch=async request=>{const verified=await verifyCMSRequest(request,config);if(request.method==='GET'){gets++;return objects.has(verified.path)?Response.json(objects.get(verified.path)):Response.json({error:'missing'},{status:404});}
  posts++;const intent=taxonomyIntent(verified.path,verified.body);assert.ok(intent);if(objects.has(intent.readPath))return Response.json({success:false,error:'exists'},{status:409});
  const item={id:'01ARZ3NDEKTSV4RRFFQ69G5FAV',name:intent.name,...intent.body,...(intent.kind==='term'?{parentId:null}:{})},payload={success:true,data:{[intent.kind==='term'?'term':'taxonomy']:item}};
  if(!missing)objects.set(intent.readPath,payload);if(drop)throw Error('Lost response after native dispatch');return Response.json(payload,{status:201});
 };
 const run=async(path,body,request=id(),environment=env)=>cmsGateway(await signCMSRequest(config,path,request,body),environment,dispatch);
 for(const [path,body] of [['/_emdash/api/taxonomies',cmsTaxonomyDefinition('categories')],['/_emdash/api/taxonomies/categories/terms',cmsTaxonomyTerm('studio','Studio')]]){
  const request=id(),before=posts;drop=true;assert.equal((await run(path,body,request)).status,409);drop=false;const recovered=await run(path,body,request);assert.equal(recovered.status,200);const payload=await recovered.json();assert.equal(payload.data.reconciled,true);assert.equal(posts,before+1);assert.deepEqual(await(await run(path,body,request)).json(),payload);
  const existingIntent=taxonomyIntent(path,JSON.stringify(body));assert.ok(matchesTaxonomyIntent(payload,existingIntent));
  const key=existingIntent.kind==='term'?'term':'taxonomy';for(const changed of existingIntent.kind==='term'?[{label:'Changed'},{locale:'fr'},{parentId:'parent'},{description:'Different purpose'},{slug:'other'}]:[{labelSingular:'Other'},{collections:['pages']},{hierarchical:false},{locale:'fr'}])assert.equal(matchesTaxonomyIntent({...payload,data:{[key]:{...payload.data[key],...changed}}},existingIntent),false);
 }
 const termPath='/_emdash/api/taxonomies/categories/terms',body=cmsTaxonomyTerm('studio','Studio');const conflict=id(),before=posts;
 assert.equal((await run(termPath,body,conflict)).status,409);assert.equal((await run(termPath,body,conflict)).status,200);assert.equal(posts,before+1); // Existing exact state, never a second create.
 assert.equal((await run(termPath,cmsTaxonomyTerm('studio','Changed'),conflict)).status,409);
 const changed=id(),changedBody=cmsTaxonomyTerm('studio','Not the same label');assert.equal((await run(termPath,changedBody,changed)).status,409);const beforeChanged=posts;assert.equal((await run(termPath,changedBody,changed)).status,409);assert.equal(posts,beforeChanged);
 drop=true;missing=true;const absent=id(),absentBody=cmsTaxonomyTerm('absent','Absent');assert.equal((await run(termPath,absentBody,absent)).status,409);drop=false;missing=false;const beforeAbsent=posts;assert.equal((await run(termPath,absentBody,absent)).status,409);assert.equal(posts,beforeAbsent);
 const legacy=id(),request=await signCMSRequest(config,termPath,legacy,body),v=await verifyCMSRequest(request,config);await db.prepare('INSERT INTO _whumpo_requests(id,request_hash) VALUES(?,?)').bind(legacy,v.requestHash).run();const beforeGets=gets;assert.equal((await run(termPath,body,legacy)).status,409);assert.equal(gets,beforeGets);
 // Prove the identity insert and ordinary reservation roll back together.
 await db.prepare("CREATE TRIGGER reject_taxonomy_fixture BEFORE INSERT ON _whumpo_taxonomy_intents BEGIN SELECT RAISE(ABORT,'fixture rejection'); END").run();const rejected=id(),beforeReject=posts;assert.equal((await run(termPath,cmsTaxonomyTerm('rejected','Rejected'),rejected)).status,503);assert.equal(await db.prepare('SELECT id FROM _whumpo_requests WHERE id=?').bind(rejected).first(),null);assert.equal(posts,beforeReject);await db.prepare('DROP TRIGGER reject_taxonomy_fixture').run();
 const lostBatch=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{await target.batch(statements);throw Error('Lost reservation acknowledgement');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});const lost=id(),beforeLost=posts;assert.equal((await run(termPath,cmsTaxonomyTerm('lost','Lost'),lost,{...env,DB:lostBatch})).status,409);assert.equal(posts,beforeLost);
 const race=id(),raceBody=cmsTaxonomyTerm('race','Race'),raceBefore=posts;const raced=await Promise.all(Array.from({length:5},()=>run(termPath,raceBody,race)));assert.ok(raced.every(r=>[200,201,409].includes(r.status)));assert.ok([200,201].includes((await run(termPath,raceBody,race)).status));assert.equal(posts,raceBefore+1);
 assert.equal((await run(termPath,body,conflict,{...env,WHUMPO_CMS_OWNER_ID:id()})).status,403);
 console.log('Taxonomy recovery passed: atomic intent/receipt reservation, exact definition and term readback, existing-state reconciliation, no duplicate create under retries/races, changed/missing/legacy refusal, lost acknowledgement and owner isolation.');
}finally{if(proxy)await proxy.dispose();await rm(dir,{recursive:true,force:true});}
