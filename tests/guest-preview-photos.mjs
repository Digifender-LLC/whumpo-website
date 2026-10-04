import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
Error.stackTraceLimit=0;
// WH-092 private photo delivery to a guest: local D1 + local R2 only, one synthetic JPEG and an
// explicitly synthetic photo clearance (no detector runs). Bytes are digest-verified and inlined
// into the single sandboxed preview response; no object URL or asset alias is served.
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true,r2:true}),{db,env}=store;
const dir=await mkdtemp('/tmp/whumpo-guest-photos-');
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network is allowed');};
try{
 execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(60,110,80)).save(sys.argv[1])",dir+'/photo.jpg']);
 const jpeg=new Uint8Array(await readFile(dir+'/photo.jpg'));
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;await paidPlan(db,user,'personal');
 const site=await createFixtureProject(scope,user,'Photo garden','A neighborhood website','clay'),photo=crypto.randomUUID();
 await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':'Garden'},body:jpeg}),{...env,DB:scope},user,site.project,photo);
 await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),photo).run();
 const version=await changeFixtureWebsite(scope,user,site.project,[{type:'pages.setPhotos',pageId:'home',photos:[{id:photo,alt:'Garden'}]}]);
 const api=(path,method='GET',data)=>m.worker.fetch(new Request('https://whumpo.com/api'+path,{method,headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+actor.token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),{...env,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},{waitUntil:()=>{}});
 const ownerHTML=await (await api('/site-versions/'+version+'/preview')).text();
 const issued=await (await api(`/projects/${site.project}/guest-previews`,'POST',{id:crypto.randomUUID(),versionId:version,expiresInHours:2,feedback:false})).json();
 assert.match(issued.token,/^[A-Za-z0-9_-]{43}$/);
 const view=()=>m.host.fetch(new Request('https://preview.whumpo.site/view',{method:'POST',headers:{origin:'https://preview.whumpo.site','content-type':'application/x-www-form-urlencoded'},body:'token='+issued.token}),env);
 const response=await view(),html=await response.text();
 assert.equal(response.status,200);assert.equal(html,ownerHTML);assert.ok(html.includes('src="data:image/jpeg;base64,'));assert.ok(!html.includes('assets/'+photo));
 assert.match(response.headers.get('content-security-policy'),/img-src data:/);
 for(const path of ['/assets/'+photo+'.jpg','/s/'+site.project+'/assets/'+photo+'.jpg'])assert.equal((await m.host.fetch(new Request('https://preview.whumpo.site'+path),env)).status,404);
 // An unpublished private photo stays unavailable on the project's public host as well.
 assert.equal((await m.host.fetch(new Request('https://'+site.project+'.whumpo.site/assets/'+photo+'.jpg'),env)).status,404);
 // Private bytes that no longer match their recorded digest are never served to a guest.
 const key=(await db.prepare('SELECT object_key FROM project_files WHERE id=?').bind(photo).first()).object_key,object=await env.FILES.get(key);
 await env.FILES.put(key,new Uint8Array([1,2,3]),{customMetadata:object.customMetadata});
 assert.equal((await view()).status,404);
 assert.equal(network,0);
 console.log('Guest preview photos passed (local D1/R2): exact owner bytes inlined after digest checks, no asset URL or alias on the guest or project host, tampered private bytes refused. Synthetic clearance only; no detector.');
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await store.close();await rm(dir,{recursive:true,force:true});}
