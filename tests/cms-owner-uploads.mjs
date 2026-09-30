import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {deployCMS,connectCMS}=await module('src/cms-deploy.ts'),{prepareCMS,confirmCMS}=await module('src/cms-projects.ts'),{allocateCMSResources}=await module('src/cms-provision.ts'),{deriveCMSSecret,verifyCMSRequest}=await module('src/cms-bridge.ts');
const dir=await mkdtemp('/tmp/townhello-cms-deploy-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB,id=()=>crypto.randomUUID(),account='a'.repeat(32),master='local-master-fixture-'.repeat(4),digest='b'.repeat(64);
async function fixture(){const user=id(),project=id(),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Deploy fixture','','draft',?,?)").bind(project,user,now,now).run();const review=await prepareCMS(db,user,id(),project,'My CMS','Our updates');await confirmCMS(db,user,review.id);const resources=new Map();await allocateCMSResources(db,project,{accountId:account,find:async(k,n)=>resources.get(k+n)??null,create:async(k,n)=>resources.set(k+n,k==='database'?id():k==='session'?id().replaceAll('-',''):n)});const origin='https://townhello-cms-'+project.replaceAll('-','')+'.whumpo.site',config={projectId:project,ownerId:user,origin,secret:await deriveCMSSecret(master,project,user,origin)};return {user,project,review,config};}
function provider(a){let tag=null,version=null,initialized=false,setupId=null;const p={accountId:account,uploads:0,setups:0,owner:a.user,missingPages:false,unresolved:false,lostUpload:false,exists:async()=>version!==null,deploy:async(_name,t)=>{p.uploads++;if(p.unresolved)throw Error('unknown');tag=t;version=id();if(p.lostUpload)throw Error('lost upload acknowledgement');},activeVersion:async(_name,t)=>tag===t?version:null,replaceVersion:()=>{version=id();},service:{fetch:async request=>{const verified=await verifyCMSRequest(request,a.config);let data;
 if(verified.path==='/_emdash/api/setup/status')data={needsSetup:!initialized};
 else if(verified.path==='/_emdash/api/setup'){assert.deepEqual(JSON.parse(verified.body),{title:'My CMS',tagline:'Our updates',includeContent:false});if(setupId&&setupId!==verified.id)throw Error('unexpected setup ID');if(!initialized)p.setups++;initialized=true;setupId=verified.id;data={setupComplete:true,seedComplete:true};}
 else if(verified.path==='/_emdash/api/auth/me')data={email:p.owner+'@owners.townhello.invalid',role:50};
 else if(verified.path==='/_emdash/api/schema/collections')data={items:p.missingPages?[{slug:'posts'}]:[{slug:'posts'},{slug:'pages'}]};
 else throw Error('unexpected path');return Response.json({success:true,data});}}};return p;}
const {cmsGateway}=await module('src/cms-gateway.ts');
const {uploadCMSMedia,readCMSUploads}=await module('src/cms-media-uploads.ts'),{cleanPhoto}=await module('src/files.ts');
try{
 const a=await fixture(),p=provider(a);await deployCMS(db,a.project,digest,a.config,p);await connectCMS(db,a.project,id());
 execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1])",dir+'/photo.jpg']);
 const bytes=new Uint8Array(await readFile(dir+'/photo.jpg')),photo=cleanPhoto(bytes);
 const nativeEnv={DB:db,TOWNHELLO_CMS_PROJECT_ID:a.project,TOWNHELLO_CMS_OWNER_ID:a.user,TOWNHELLO_CMS_ORIGIN:a.config.origin,TOWNHELLO_CMS_BRIDGE_KEY:a.config.secret};
 let writes=0,drop=false,capable=true;
 const dispatch=async request=>{writes++;const form=await request.formData(),file=form.get('file');assert.deepEqual(new Uint8Array(await file.arrayBuffer()),photo.bytes);return Response.json({success:true,data:{item:{id:'01ARZ3NDEKTSV4RRFFQ69G5FAV',status:'ready',filename:file.name,mimeType:'image/jpeg',size:photo.bytes.length,width:32,height:24,url:'PRIVATE_URL',storageKey:'PRIVATE_KEY',owner:'PRIVATE_OWNER'}}},{status:201});};
 const env={CMS_BRIDGE_MASTER_KEY:master,['CMS_'+a.project.replaceAll('-','')]:{fetch:async request=>{
  if(!capable&&new URL(request.url).pathname.endsWith('/capabilities'))return Response.json({error:'old'},{status:403});
  const response=await cmsGateway(request,nativeEnv,dispatch);if(drop&&request.method==='POST'){drop=false;throw Error('lost native acknowledgement');}return response;
 }}};
 const upload=(request=id(),name='studio.jpg',database=db)=>uploadCMSMedia(database,a.user,a.project,request,bytes,name,env);
 const count=async()=>Number((await db.prepare('SELECT count(*) n FROM cms_media_uploads').first()).n);
 const ops=async()=>Number((await db.prepare("SELECT write_ops FROM storage_usage WHERE period=strftime('%Y-%m','now')").first())?.write_ops??0);
 capable=false;await assert.rejects(upload(),e=>e.status===409);assert.equal(await count(),0);assert.equal(writes,0);
 capable=true;const first=id();drop=true;await assert.rejects(upload(first),e=>e.status===503);assert.equal(writes,1);assert.equal(await count(),1);assert.equal(await ops(),2);
 assert.equal((await readCMSUploads(db,a.user,a.project,env)).uploads[0].status,'unresolved');
 const saved=await upload(first);assert.equal(saved.status,'saved');assert.equal(writes,1);assert.equal(await ops(),2);assert.ok(!JSON.stringify(saved).includes('PRIVATE_'));
 capable=false;assert.deepEqual(await upload(first),saved);capable=true;
 await assert.rejects(upload(first,'other.jpg'),e=>e.status===409);
 await assert.rejects(uploadCMSMedia(db,id(),a.project,id(),bytes,'studio.jpg',env),e=>e.status===404);
 await assert.rejects(readCMSUploads(db,id(),a.project,env),e=>e.status===404);
 const concurrent=id();const results=await Promise.allSettled([upload(concurrent),upload(concurrent)]);assert.ok(results.some(r=>r.status==='fulfilled'));assert.equal((await upload(concurrent)).status,'saved');assert.equal(writes,2);assert.equal(await ops(),4);
 // A lost acknowledgement after control D1 commits must still return the saved receipt.
 const localId=id();let lose=true;const lostDB={prepare(sql){const statement=db.prepare(sql);if(!sql.startsWith('UPDATE cms_media_uploads SET result='))return statement;return {bind(...args){const bound=statement.bind(...args);return {async run(){const result=await bound.run();if(lose){lose=false;throw Error('lost local acknowledgement');}return result;}};}};}};
 assert.equal((await upload(localId,'studio.jpg',lostDB)).status,'saved');assert.equal(writes,3);
 await assert.rejects(db.prepare("UPDATE cms_media_uploads SET filename='changed.jpg' WHERE id=?").bind(first).run());
 await assert.rejects(db.prepare('DELETE FROM cms_media_uploads WHERE id=?').bind(first).run());
 // Storage admission rolls the insert back, and never dispatches a native request.
 const prior=await ops();await db.prepare("UPDATE storage_usage SET write_ops=9999 WHERE period=strftime('%Y-%m','now')").run();const refused=id();await assert.rejects(upload(refused),e=>e.status===409);assert.equal(await count(),3);assert.equal(writes,3);assert.equal(await ops(),9999);
 await db.prepare("UPDATE storage_usage SET write_ops=? WHERE period=strftime('%Y-%m','now')").bind(prior).run();
 // Two concurrent admissions at the final project slot cannot both reserve capacity.
 for(let n=0;n<16;n++)await upload();assert.equal(await count(),19);
 const before=writes;const full=await Promise.allSettled([upload(),upload()]);assert.equal(full.filter(r=>r.status==='fulfilled').length,1);assert.equal(await count(),20);assert.equal(writes,before+1);assert.equal(await ops(),40);
 const listing=await readCMSUploads(db,a.user,a.project,env);assert.equal(listing.uploadEnabled,true);assert.equal(listing.uploads.length,20);assert.ok(!JSON.stringify(listing).includes('PRIVATE_'));assert.ok(!JSON.stringify(listing).includes(a.config.origin));
 const {captureCMSArticleImages}=await module('src/cms-article-images.ts');
 const image={_type:'image',_key:'one',asset:{_ref:'01ARZ3NDEKTSV4RRFFQ69G5FAV'},alt:'Synthetic image'};
 let imageReads=0,changed=false;
 const imageEnv={CMS_BRIDGE_MASTER_KEY:master,['CMS_'+a.project.replaceAll('-','')]:{fetch:async request=>{const verified=await verifyCMSRequest(request,a.config);assert.equal(verified.path,'/_emdash/api/whumpo/media/'+image.asset._ref+'/preview');imageReads++;const body=photo.bytes.slice();if(changed)body[body.length-4]^=1;return new Response(body,{headers:{'content-type':'image/jpeg'}});}}};
 const captured=await captureCMSArticleImages(db,a.user,a.project,[image,{...image,_key:'two'}],imageEnv);assert.equal(captured.length,1);assert.equal(imageReads,1);assert.deepEqual(captured[0].bytes,photo.bytes);assert.equal(captured[0].width,32);
 await assert.rejects(captureCMSArticleImages(db,id(),a.project,[image],imageEnv),e=>e.status===404);assert.equal(imageReads,1);
 await assert.rejects(captureCMSArticleImages(db,a.user,a.project,[{...image,asset:{_ref:'01ARZ3NDEKTSV4RRFFQ69G5FAA'}}],imageEnv),e=>e.status===409);assert.equal(imageReads,1);
 changed=true;await assert.rejects(captureCMSArticleImages(db,a.user,a.project,[image],imageEnv),e=>e.status===409);assert.equal(imageReads,2);
 console.log('Article image capture passed: confirmed owner/project receipt, exact native-byte hash, dimensions, deduplicated reads and changed/missing media refusal.');
 const worker=(await module('src/index.ts')).default,{hashToken}=await module('src/security.ts');
 const session='c'.repeat(64);await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(session),a.user,new Date(Date.now()+3600000).toISOString(),new Date().toISOString()).run();
 const http=(suffix,method='GET',body,headers={})=>worker.fetch(new Request('https://whumpo.com/api/cms/'+a.project+'/media/uploads'+suffix,{method,headers:{origin:'https://whumpo.com',cookie:'tellumo_session='+session,'content-type':'image/jpeg','x-photo-name':'studio.jpg',...headers},body}),{...env,DB:db,AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}},{waitUntil(){}});
 assert.equal((await http('')).status,200);
 assert.equal((await http('/'+first,'PUT',bytes,{cookie:''})).status,401);
 assert.equal((await http('/'+first,'PUT',bytes,{origin:'https://evil.test'})).status,403);
 assert.equal((await http('/'+first,'PUT',bytes,{'content-encoding':'gzip'})).status,415);
 assert.equal((await http('/'+first,'PUT',bytes,{'x-photo-name':'%ZZ'})).status,400);
 assert.equal((await http('/'+first,'PUT',new Uint8Array(1048577))).status,413);
 const replay=await http('/'+first,'PUT',bytes);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),saved);
 assert.equal((await http('/'+first,'DELETE')).status,405);assert.equal(writes,before+1);
 console.log('Owner CMS uploads passed: native and local acknowledgement recovery, exact replay, concurrent admission, private metadata projection, owner isolation, immutable reservations, storage rollback and project capacity.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
