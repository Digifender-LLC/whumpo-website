import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {currentSiteFixtureHandlers,createFixtureProject,proposeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
// WH-091 logo storage: a brand logo is one more reviewed project photo of the saved version (version_photos position 0 to 4, once per
// file). Every reader must agree with that list: saved preview, export (site-page and photo-page), the stored rows, and a logo that is also
// a gallery photo. Cases: 0, 1 and 4 gallery photos, a distinct logo and a logo that is also a gallery photo, and no logo at all.
const d1=process.argv.includes('--d1');
const consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=()=>{};
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(d1?{d1:true}:{}),{db}=fixture,id=()=>crypto.randomUUID();
globalThis.fetch=async()=>{throw Error('No network');};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
const objects=new Map(),FILES={get:async key=>{const v=objects.get(key);return v?{size:v.length,body:{cancel:async()=>{}},arrayBuffer:async()=>v.slice().buffer}:null;}};
const tokens={light:{ink:'#1f2a44',paper:'#fbf8f1',accent:'#8a2c0d'},dark:null,font:'modern',radius:'soft',density:'comfortable',logoAlt:'Harbour logo'};
const grant=(user,feature,project=null)=>Promise.all(['prepare','confirm'].map(op=>run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-091 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,project,feature,op)));
async function owner(){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account,site=await createFixtureProject(scope,user,'Logo '+id().slice(0,6),'Bread');
 await grant(user,'core.editing',site.project);for(const f of ['creator.brand-kits'])await grant(user,f);
 return {...actor,scope,user,...site};
}
async function photo(o){
 const key=id(),bytes=new TextEncoder().encode('synthetic-image-'+key),digest=createHash('sha256').update(bytes).digest('hex');objects.set(key,bytes);
 await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,'Photo',?,?,?,1,1,'ready',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",key,o.project,key,digest,bytes.length);
 await run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-fixture',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),key);
 return key;
}
const revision=async o=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(o,action){const turn=id();const r=await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(o),action});return {id:turn,...r};}
async function apply(o,proposalId){const p=await row('SELECT * FROM project_spec_proposals WHERE id=?',proposalId);const r=await control(o,{type:'specificationApply',reviewId:p.id,proposalDigest:p.proposal_digest,expectedRevision:p.expected_revision});assert.equal(r.status,200,r.error);}
const versionId=async o=>(await row('SELECT version_id FROM project_spec_heads WHERE project_id=?',o.project)).version_id;
async function http(o,path){return m.worker.fetch(new Request('https://whumpo.com'+path,{headers:{cookie:`__Host-whumpo_session=${o.token}`,origin:'https://whumpo.com'}}),{...(fixture.env??{}),DB:db,FILES,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}},{waitUntil(){}});}
let cases=0;
try{
 for(const [name,gallery,logo] of [['no logo, two photos',2,'none'],['no gallery, distinct logo',0,'distinct'],['one photo, distinct logo',1,'distinct'],['four photos, distinct logo',4,'distinct'],['four photos, the logo is also a gallery photo',4,'same'],['no gallery, no logo',0,'none']]){
  const o=await owner(),kit=await m.brandKits.createBrandKit(o.scope,o.user,{id:id(),name:'K',tokens});
  const ids=[];for(let i=0;i<gallery;i++)ids.push(await photo(o));
  if(gallery){const q=await proposeFixtureWebsite(o.scope,o.user,o.project,[{type:'pages.setPhotos',pageId:'home',photos:ids.map((x,i)=>({id:x,alt:'Gallery '+i}))}]);await apply(o,q.id);}
  const logoId=logo==='same'?ids[0]:logo==='distinct'?await photo(o):null;
  if(logo!=='none'){const r=await control(o,{type:'brandKitReview',projectId:o.project,kitId:kit.id,version:1,logoId});assert.equal(r.status,200,name+': '+r.error);await apply(o,r.id);}
  const v=await versionId(o),expected=[...ids,...(logoId&&!ids.includes(logoId)?[logoId]:[])];
  // The stored rows are exactly the page photos and then the logo, once each, at positions 0..n-1.
  const stored=await rows('SELECT file_id,position FROM version_photos WHERE version_id=? ORDER BY position',v);
  assert.deepEqual(stored.map(r=>r.file_id),expected,name+' stored rows');assert.deepEqual(stored.map(r=>r.position),expected.map((_,i)=>i));
  // Saved preview (also the guest preview's renderer): every image is inlined, in either component, with no leftover asset path.
  const preview=await m.ownedPreview({DB:db,FILES},o.user,v);assert.equal(preview.status,200,name+' preview');const html=await preview.text();
  assert.equal(html.includes('src="assets/'),false,name+' no leftover asset path');
  const imgs=(html.match(/<img /g)??[]).length,inlined=(html.match(/src="data:image\/jpeg;base64,/g)??[]).length;
  assert.equal(imgs,gallery+(logoId?1:0),name+' image elements');assert.equal(inlined,imgs,name+' every image inlined');
  // Export: an archive carries each distinct asset once and a manifest that lists them.
  const exported=await http(o,`/api/site-versions/${v}/export`);assert.equal(exported.status,200,name+' export '+exported.status);
  const files=unzipSync(new Uint8Array(await exported.arrayBuffer())),assets=Object.keys(files).filter(f=>f.startsWith('public/assets/')).sort();
  assert.deepEqual(assets,expected.map(x=>`public/assets/${x}.jpg`).sort(),name+' archive assets');
  const manifest=JSON.parse(strFromU8(files['whumpo/site.json']));assert.deepEqual((manifest.photos??[]).map(p=>p.id),expected,name+' manifest photos');
  assert.equal(manifest.component,gallery?'photo-page@1':'site-page@1');
  if(expected.length)assert.match(strFromU8(files['public/_headers']),/img-src 'self' data:/,name+' export headers allow its own images');
  cases++;
 }
 // A saved version whose stored rows disagree with its configuration is refused, never partly shown.
 const o=await owner(),kit=await m.brandKits.createBrandKit(o.scope,o.user,{id:id(),name:'K',tokens}),lg=await photo(o);
 const r=await control(o,{type:'brandKitReview',projectId:o.project,kitId:kit.id,version:1,logoId:lg});await apply(o,r.id);const v=await versionId(o);
 await run('DELETE FROM version_photos WHERE version_id=?',v);
 await assert.rejects(()=>m.ownedPreview({DB:db,FILES},o.user,v),e=>e.status===503&&/could not be verified/.test(e.message));
 cases++;
 for(const k of consoleMethods)console[k]=originals[k];
 console.log(`Brand logo readers passed (${cases} cases${d1?', local D1':', SQLite'}): stored rows, saved preview and export agree for 0, 1 and 4 gallery photos with a distinct logo, a logo that is also a gallery photo, and no logo, for both components.`);
}catch(error){for(const k of consoleMethods)console[k]=originals[k];throw error;}
finally{await fixture.close?.();}
