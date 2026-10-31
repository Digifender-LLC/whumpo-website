import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
// WH-091 brand kits and saved sections over the complete current schema: disposable SQLite, or local D1 with --d1.
// Two owners and two projects. No model, provider or network: fetch throws.
const d1=process.argv.includes('--d1');
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(d1?{d1:true}:{}),{db}=fixture,id=()=>crypto.randomUUID();
let network=0;globalThis.fetch=async()=>{network++;throw Error('No network or inference is available');};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const kits=m.brandKits;
const tokens=(over={})=>({light:{ink:'#1f2a44',paper:'#fbf8f1',accent:'#8a2c0d'},dark:{ink:'#f2efe6',paper:'#14161c',accent:'#f0a37f'},font:'editorial',radius:'round',density:'spacious',logoAlt:'Harbour Bakery logo',...over});
const grant=(user,feature,project=null)=>Promise.all(['prepare','confirm'].map(op=>run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-091 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,project,feature,op)));
async function owner(features=true){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Bakery '+id().slice(0,6),'Bread');
 for(const feature of ['core.editing'])await grant(user,feature,site.project);
 if(features)for(const feature of ['creator.brand-kits','creator.saved-sections'])await grant(user,feature);
 return {...actor,scope,user,...site};
}
const revision=async o=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(o,action){const turn=id();return {id:turn,...await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(o),action})};}
const rejects=(fn,status,pattern)=>assert.rejects(fn,e=>e.status===status&&(!pattern||pattern.test(e.message)),String(pattern));
async function approvedPhoto(o,project=o.project,approved=true){
 const key=id();
 await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,'Logo',?,?,10,1,1,'ready',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",key,project,key,'a'.repeat(64));
 if(approved)await run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-fixture',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),key);
 return key;
}
async function apply(o,proposalId){
 const p=await row('SELECT * FROM project_spec_proposals WHERE id=?',proposalId);
 const r=await control(o,{type:'specificationApply',reviewId:p.id,proposalDigest:p.proposal_digest,expectedRevision:p.expected_revision});assert.equal(r.status,200,r.error);return p;
}
const head=async o=>{const h=await row('SELECT v.spec_json,v.spec_digest,v.version_id FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=?',o.project);return {...h,spec:JSON.parse(h.spec_json)};};

try{
 const a=await owner(),b=await owner(),nofeature=await owner(false);
 let kit,kit2;

 await check('the controls are typed, carry ids and a version only, and the model is never told about them',async()=>{
  const ok={type:'brandKitReview',projectId:a.project,kitId:id(),version:1,logoId:null};
  assert.ok(m.chatControl(ok));assert.ok(m.chatControl({...ok,logoId:id()}));
  for(const bad of [{...ok,version:0},{...ok,version:51},{...ok,version:1.5},{...ok,kitId:'x'},{...ok,logoId:'x'},{...ok,tokens:{}},{...ok,css:'a{}'},{type:'brandKitReview'}])assert.ok(!m.chatControl(bad),JSON.stringify(bad));
  assert.ok(m.chatControl({type:'brandRemoveReview',projectId:a.project}));assert.ok(!m.chatControl({type:'brandRemoveReview',projectId:a.project,x:1}));
  const section={type:'savedSectionReview',projectId:a.project,sectionId:id(),version:2,pageId:'home'};
  assert.ok(m.chatControl(section));assert.ok(!m.chatControl({...section,pageId:'Home!'}));
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');for(const word of ['brandKitReview','review-brand-kit','savedSectionReview','design.setBrand'])assert.ok(!prompt.includes(word),word);
 });

 await check('creating needs the Creator feature; reading and deleting do not',async()=>{
  await rejects(()=>kits.createBrandKit(nofeature.scope,nofeature.user,{id:id(),name:'Mine',tokens:tokens()}),403,/Creator plan/);
  assert.equal((await rows('SELECT id FROM brand_kits WHERE owner_user_id=?',nofeature.user)).length,0);
  assert.deepEqual((await kits.listBrandKits(nofeature.scope,nofeature.user)).kits,[]);
 });

 await check('colors that cannot be read are refused with the reason in plain words; malformed values are refused',async()=>{
  const weak=tokens({light:{ink:'#9a9a9a',paper:'#ffffff',accent:'#8a2c0d'}});
  await rejects(()=>kits.createBrandKit(a.scope,a.user,{id:id(),name:'Pale',tokens:weak}),422,/hard to read.*4\.5 to 1/);
  await rejects(()=>kits.createBrandKit(a.scope,a.user,{id:id(),name:'Pale dark',tokens:tokens({dark:{ink:'#444444',paper:'#14161c',accent:'#f0a37f'}})}),422,/dark mode/);
  for(const bad of [tokens({light:{ink:'red',paper:'#ffffff',accent:'#000000'}}),tokens({light:{ink:'#1f2a44;}',paper:'#fbf8f1',accent:'#8a2c0d'}}),tokens({font:'Comic Sans'}),tokens({radius:'9px'}),tokens({density:'x'}),tokens({logoAlt:' '}),{...tokens(),extra:1},{...tokens(),light:undefined}])
   await rejects(()=>kits.createBrandKit(a.scope,a.user,{id:id(),name:'Bad',tokens:bad}),400);
  for(const name of ['',' ','x'.repeat(61),'bad\nname'])await rejects(()=>kits.createBrandKit(a.scope,a.user,{id:id(),name,tokens:tokens()}),400);
  assert.equal((await rows('SELECT id FROM brand_kits WHERE owner_user_id=?',a.user)).length,0);
 });

 await check('create is idempotent per request ID; a different body under the same ID is a conflict',async()=>{
  const request={id:id(),name:'Harbour',tokens:tokens()};
  kit=await kits.createBrandKit(a.scope,a.user,request);assert.equal(kit.version,1);assert.deepEqual(kit.tokens,tokens());
  assert.deepEqual(await kits.createBrandKit(a.scope,a.user,request),kit);
  await rejects(()=>kits.createBrandKit(a.scope,a.user,{...request,tokens:tokens({font:'modern'})}),409);
  await rejects(()=>kits.createBrandKit(b.scope,b.user,request),409,undefined).catch(()=>{});
  assert.equal((await rows('SELECT kit_id FROM brand_kit_versions WHERE kit_id=?',request.id)).length,1);
 });

 await check('a new version is immutable history; a stale save is refused, never merged',async()=>{
  kit2=await kits.saveBrandKitVersion(a.scope,a.user,kit.id,{expectedVersion:1,name:'Harbour 2',tokens:tokens({font:'modern'})});
  assert.equal(kit2.version,2);assert.equal(kit2.name,'Harbour 2');
  await rejects(()=>kits.saveBrandKitVersion(a.scope,a.user,kit.id,{expectedVersion:1,name:'Late',tokens:tokens({font:'humanist'})}),409,/changed since you opened/);
  assert.equal((await kits.readBrandKitVersion(a.scope,a.user,kit.id,1)).tokens.font,'editorial','version 1 is still exactly what it was');
  await assert.rejects(()=>run("UPDATE brand_kit_versions SET tokens_json='{}' WHERE kit_id=?",kit.id),/brand_kit_version_immutable/);
  await assert.rejects(()=>run("UPDATE brand_kits SET owner_user_id=? WHERE id=?",b.user,kit.id),/brand_kit_immutable/);
  await assert.rejects(()=>run("INSERT INTO brand_kit_versions VALUES(?,?,?,?,?)",kit.id,9,'{}','a'.repeat(64),'2026-01-01T00:00:00.000Z'),/version_order|CHECK|constraint/);
 });

 await check('another owner cannot read, change, delete or apply a kit',async()=>{
  assert.deepEqual((await kits.listBrandKits(b.scope,b.user)).kits,[]);
  await rejects(()=>kits.readBrandKitVersion(b.scope,b.user,kit.id,1),404);
  await rejects(()=>kits.saveBrandKitVersion(b.scope,b.user,kit.id,{expectedVersion:2,name:'x',tokens:tokens()}),404);
  await rejects(()=>kits.deleteBrandKit(b.scope,b.user,kit.id),404);
  const r=await control(b,{type:'brandKitReview',projectId:b.project,kitId:kit.id,version:2,logoId:null});assert.equal(r.status,404);assert.match(r.error,/Brand kit not found/);
  const foreignProject=await control(b,{type:'brandKitReview',projectId:a.project,kitId:kit.id,version:2,logoId:null});assert.ok(foreignProject.status>=400);
  assert.equal((await rows('SELECT id FROM project_spec_proposals WHERE project_id IN(?,?)',a.project,b.project)).length,0);
 });

 let proposal,before;
 await check('applying prepares the exact review: tokens are copied in, the kit is cited, nothing is saved',async()=>{
  before=await head(a);assert.equal(before.spec.design.brand,null);
  const prepared=await control(a,{type:'brandKitReview',projectId:a.project,kitId:kit.id,version:2,logoId:null});assert.equal(prepared.status,200,prepared.error);
  proposal=await row('SELECT * FROM project_spec_proposals WHERE id=?',prepared.id);const spec=JSON.parse(proposal.spec_json);
  assert.deepEqual(spec.design.brand,{source:{kitId:kit.id,version:2},light:tokens().light,dark:tokens().dark,font:'modern',radius:'round',density:'spacious',logo:null});
  assert.ok(JSON.parse(proposal.diff_json).some(r=>r.label==='Brand kit'&&r.before===null&&/Type: Modern/.test(r.after)&&/Light: text #1f2a44/.test(r.after)));
  assert.match(proposal.html??'',/--accent:#8a2c0d/);
  assert.deepEqual((await head(a)).spec,before.spec,'Preparing saves nothing');
  const turn=(await m.readChat(a.scope,a.user)).turns.find(t=>t.id===prepared.id);assert.equal(turn.specification_review.id,proposal.id);
 });

 await check('the commit trigger refuses a forged brand: other colors, another owner\'s kit, a stale base, another action',async()=>{
  let bump=0;const synthetic=async(o,action)=>{const t=id(),r=await revision(o)+1+bump++;await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,action_json) VALUES(?,?,?,'Synthetic','',strftime('%Y-%m-%dT%H:%M:%fZ','now'),?)",t,o.user,r,JSON.stringify(action));await run("UPDATE chat_turns SET mode='guided',status='completed' WHERE id=?",t);return t;};
  const copy=(turn,specJSON)=>run('INSERT INTO project_spec_proposals SELECT ?,user_id,project_id,operation,expected_revision,draft_revision,base_version_id,target_version_id,base_digest,request_hash,proposal_digest,spec_digest,manifest_digest,policy_version,expires_at,?,lock_json,manifest_json,config_json,html,html_digest,diff_json,envelope_json FROM project_spec_proposals WHERE id=?',turn,specJSON,proposal.id);
  const spec=JSON.parse(proposal.spec_json),tweak=fn=>{const s=structuredClone(spec);fn(s);return JSON.stringify(s);};
  const action={type:'brandKitReview',projectId:a.project,kitId:kit.id,version:2,logoId:null};
  for(const [name,json] of [['other color',tweak(s=>{s.design.brand.light.accent='#000000';})],['other font',tweak(s=>{s.design.brand.font='classic';})],['other version',tweak(s=>{s.design.brand.source.version=1;})],['unknown kit',tweak(s=>{s.design.brand.source.kitId=id();})],['no source',tweak(s=>{s.design.brand.source=null;})],['extra change',tweak(s=>{s.name='Renamed';})]]){
   const t=await synthetic(a,action);await assert.rejects(()=>copy(t,json),/specification_changed|constraint/,name);
  }
  const t=await synthetic(b,{...action,projectId:b.project});
  await assert.rejects(()=>run('INSERT INTO project_spec_proposals SELECT ?,?,?,operation,expected_revision,draft_revision,base_version_id,target_version_id,base_digest,request_hash,proposal_digest,spec_digest,manifest_digest,policy_version,expires_at,spec_json,lock_json,manifest_json,config_json,html,html_digest,diff_json,envelope_json FROM project_spec_proposals WHERE id=?',t,b.user,b.project,proposal.id),/specification_changed|constraint/,'a foreign owner cannot use this owner\'s proposal or kit');
  for(const o of [a,b])await run('UPDATE workspace_state SET revision=max(revision,(SELECT coalesce(max(revision),0) FROM chat_turns WHERE user_id=?)) WHERE user_id=?',o.user,o.user);
 });

 await check('saving applies it; later edits and deletion of the kit never change the saved site',async()=>{
  await apply(a,proposal.id);
  const saved=await head(a);assert.notEqual(saved.spec_digest,before.spec_digest);assert.equal(saved.spec.design.brand.source.version,2);assert.equal(saved.spec.design.brand.font,'modern');
  const html=(await row('SELECT html FROM site_versions WHERE id=?',saved.version_id)).html;
  assert.match(html,/--accent:#8a2c0d;--radius:28px;--space:1\.3/);assert.match(html,/prefers-color-scheme:dark/);assert.doesNotMatch(html,/<script|javascript:/);
  await kits.saveBrandKitVersion(a.scope,a.user,kit.id,{expectedVersion:2,name:'Changed later',tokens:tokens({light:{ink:'#000000',paper:'#ffffff',accent:'#0000aa'}})});
  await kits.deleteBrandKit(a.scope,a.user,kit.id);
  assert.equal((await rows('SELECT id FROM brand_kits WHERE id=?',kit.id)).length,0);assert.equal((await rows('SELECT kit_id FROM brand_kit_versions WHERE kit_id=?',kit.id)).length,0,'Versions go with the kit');
  const after=await head(a);assert.equal(after.spec_digest,saved.spec_digest,'Saved specification bytes are unchanged');
  assert.equal((await row('SELECT html FROM site_versions WHERE id=?',saved.version_id)).html,html,'Saved site bytes are unchanged');
  const again=await control(a,{type:'brandKitReview',projectId:a.project,kitId:kit.id,version:2,logoId:null});assert.equal(again.status,404,'A deleted kit can no longer be applied');
 });

 await check('a logo must be an approved photo of this project; an unapproved or foreign photo is refused',async()=>{
  const k=await kits.createBrandKit(a.scope,a.user,{id:id(),name:'With logo',tokens:tokens({font:'classic'})});
  const noAlt=await kits.createBrandKit(a.scope,a.user,{id:id(),name:'No alt',tokens:tokens({logoAlt:null})});
  const good=await approvedPhoto(a),pending=await approvedPhoto(a,a.project,false),foreign=await approvedPhoto(b);
  for(const bad of [pending,foreign,id()]){const r=await control(a,{type:'brandKitReview',projectId:a.project,kitId:k.id,version:1,logoId:bad});assert.ok(r.status>=400,'refused '+bad);}
  const missing=await control(a,{type:'brandKitReview',projectId:a.project,kitId:noAlt.id,version:1,logoId:good});assert.equal(missing.status,409);assert.match(missing.error,/no logo description/);
  const r=await control(a,{type:'brandKitReview',projectId:a.project,kitId:k.id,version:1,logoId:good});assert.equal(r.status,200,r.error);
  const p=await apply(a,r.id);const saved=await head(a);
  assert.deepEqual(saved.spec.design.brand.logo,{id:good,alt:'Harbour Bakery logo'});
  assert.deepEqual((await rows('SELECT file_id FROM version_photos WHERE version_id=?',saved.version_id)).map(x=>x.file_id),[good],'The logo is a reviewed version photo like any page photo');
  assert.match((await row('SELECT html FROM site_versions WHERE id=?',saved.version_id)).html,new RegExp(`<img class="logo" src="assets/${good}\\.jpg" alt="Harbour Bakery logo">`));
  assert.ok(p);
  const later=await control(a,{type:'brandRemoveReview',projectId:a.project});assert.equal(later.status,200,later.error);
  const removal=await row('SELECT spec_json FROM project_spec_proposals WHERE id=?',later.id);assert.equal(JSON.parse(removal.spec_json).design.brand,null);
  await apply(a,later.id);assert.equal((await head(a)).spec.design.brand,null);
  assert.equal((await control(a,{type:'brandRemoveReview',projectId:a.project})).status,409,'Nothing left to remove');
 });

 await check('a saved section is appended through the same review; a foreign section and a full page are refused',async()=>{
  const s=await kits.createSavedSection(a.scope,a.user,{id:id(),name:'Opening hours',content:{heading:'Hours',text:'Open 7 to 3, Tuesday to Sunday.',variant:'callout'}});
  await rejects(()=>kits.createSavedSection(a.scope,a.user,{id:id(),name:'Bad',content:{heading:'H',text:'T',variant:'"><script>'}}),400);
  await rejects(()=>kits.createSavedSection(a.scope,a.user,{id:id(),name:'Bad',content:{heading:'H',text:'T',variant:'card',css:'x'}}),400);
  await rejects(()=>kits.createSavedSection(nofeature.scope,nofeature.user,{id:id(),name:'Mine',content:{heading:'H',text:'T',variant:'card'}}),403);
  const foreign=await control(b,{type:'savedSectionReview',projectId:b.project,sectionId:s.id,version:1,pageId:'home'});assert.equal(foreign.status,404);
  const wrongPage=await control(a,{type:'savedSectionReview',projectId:a.project,sectionId:s.id,version:1,pageId:'nope'});assert.equal(wrongPage.status,404);
  const r=await control(a,{type:'savedSectionReview',projectId:a.project,sectionId:s.id,version:1,pageId:'home'});assert.equal(r.status,200,r.error);
  const spec=JSON.parse((await row('SELECT spec_json FROM project_spec_proposals WHERE id=?',r.id)).spec_json);
  assert.deepEqual(spec.pages[0].sections.map(x=>x.variant),['callout']);
  await apply(a,r.id);
  const html=(await row('SELECT html FROM site_versions WHERE id=?',(await head(a)).version_id)).html;assert.match(html,/class="feature feature-callout"/);assert.match(html,/Open 7 to 3, Tuesday to Sunday\./);
  const v2=await kits.saveSavedSectionVersion(a.scope,a.user,s.id,{expectedVersion:1,name:'Opening hours',content:{heading:'Hours',text:'Changed later.',variant:'plain'}});assert.equal(v2.version,2);
  await rejects(()=>kits.saveSavedSectionVersion(a.scope,a.user,s.id,{expectedVersion:1,name:'x',content:{heading:'H',text:'T',variant:'plain'}}),409);
  await kits.deleteSavedSection(a.scope,a.user,s.id);
  assert.match((await row('SELECT html FROM site_versions WHERE id=?',(await head(a)).version_id)).html,/Open 7 to 3/,'The site keeps the copy it was given');
  for(let i=0;i<5;i++){const x=await kits.createSavedSection(a.scope,a.user,{id:id(),name:'S'+i,content:{heading:'H'+i,text:'T'+i,variant:'card'}});const q=await control(a,{type:'savedSectionReview',projectId:a.project,sectionId:x.id,version:1,pageId:'home'});assert.equal(q.status,200,q.error);await apply(a,q.id);}
  const x=await kits.createSavedSection(a.scope,a.user,{id:id(),name:'Seventh',content:{heading:'H',text:'T',variant:'quote'}});
  const full=await control(a,{type:'savedSectionReview',projectId:a.project,sectionId:x.id,version:1,pageId:'home'});assert.equal(full.status,409);assert.match(full.error,/six sections/);
 });

 await check('a stale review is refused at apply: the site changed after it was prepared',async()=>{
  const k=await kits.createBrandKit(a.scope,a.user,{id:id(),name:'Stale',tokens:tokens()});
  const first=await control(a,{type:'brandKitReview',projectId:a.project,kitId:k.id,version:1,logoId:null});assert.equal(first.status,200,first.error);
  const second=await control(a,{type:'brandRemoveReview',projectId:a.project});
  const p1=await row('SELECT * FROM project_spec_proposals WHERE id=?',first.id);
  await apply(a,first.id);
  const stale=await row('SELECT * FROM project_spec_proposals WHERE id=?',second.id);
  if(stale){const r=await control(a,{type:'specificationApply',reviewId:stale.id,proposalDigest:stale.proposal_digest,expectedRevision:stale.expected_revision});assert.ok(r.status>=400,'the second review was prepared against an older site');}
 });

 await check('limits hold in the commit and nothing used the network',async()=>{
  const c=await owner();
  for(let i=0;i<20;i++)await kits.createBrandKit(c.scope,c.user,{id:id(),name:'K'+i,tokens:tokens()});
  await rejects(()=>kits.createBrandKit(c.scope,c.user,{id:id(),name:'K21',tokens:tokens()}),409,/limit/);
  assert.equal(network,0);
 });
 for(const k of consoleMethods)console[k]=originals[k];
 console.log(`Brand kit checks passed (${cases} cases${d1?', local D1':', SQLite'}): feature gate, plain-words contrast refusals, idempotent create, immutable versions with stale refusal, foreign owner refusals, exact review, commit trigger, apply and independence from later kit edits or deletion, logo photo safety, removal, saved sections, limits, zero network.`);
}finally{for(const k of consoleMethods)console[k]=originals[k];await fixture.close?.();}
