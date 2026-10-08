import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as shared from '../tools/prototypes/shared-modules.mjs';

// WH-161 offline conformance for the WH-070 customer presentation contract. Benign invented identifiers only: no
// database, HTTP, browser, model, provider or customer code runs. It proves the frozen shapes, static checks and change
// classification of tools/prototypes/customer-presentation.mjs, then re-runs itself against deliberately broken copies
// of that reference and fails if any mutation survives. It does not prove a renderer, sandbox, CSP enforcement,
// accessibility of rendered output or runtime authorization; WH-162–160 must test those against real code.
const prototypeURL=new URL('../tools/prototypes/customer-presentation.mjs',import.meta.url);
const sharedURL=new URL('../tools/prototypes/shared-modules.mjs',import.meta.url);
const doc=readFileSync(new URL('../docs/customer-presentation.md',import.meta.url),'utf8');
const appHost=readFileSync(new URL('../src/app-host.ts',import.meta.url),'utf8');
const detailing=JSON.parse(readFileSync(new URL('./fixtures/project-specification/detailing.json',import.meta.url),'utf8'));

function suite(lib){
 let count=0;
 const test=(name,fn)=>{try{fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const rejects=(fn,code,path)=>assert.throws(fn,e=>e?.code===code&&(path===undefined||String(e.path).includes(path)),`expected ${code}${path?` at ${path}`:''}`);
 const pin=(name,c='a')=>({name,version:1,digest:c.repeat(64)});
 const project='11111111-1111-4111-8111-111111111111',otherProject='22222222-2222-4222-8222-222222222222';
 const uuid=n=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`;
 const field=(key,read,optional=true)=>({key,label:key[0].toUpperCase()+key.slice(1),type:'text',optional,read});
 const instances=()=>[
  {id:'members',kind:'access',module:pin('module-access'),schema:pin('access-data'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}},
  {id:'bookings',kind:'records',module:pin('module-records'),schema:pin('records-data'),dependencies:['members'],config:{retentionDays:90,
   schemas:[{id:'appointment',fieldsRevision:2,staffWrite:['status'],fields:[field('name','submitter',false),field('vehicle','submitter'),field('status','staff'),field('notes','owner')]}],
   forms:[{id:'request',recordId:'appointment',submit:'public',uploadCollectionId:null},{id:'member-request',recordId:'appointment',submit:'visitor',uploadCollectionId:null}],
   views:[{id:'queue',recordId:'appointment',audience:'staff',scope:'all',fields:['name','vehicle','status'],limit:50},
    {id:'mine',recordId:'appointment',audience:'visitor',scope:'own',fields:['name','vehicle'],limit:10}]}},
  {id:'media',kind:'files',module:pin('module-files'),schema:pin('files-data'),dependencies:['members'],config:{collections:[
   {id:'my-photos',read:'submitter',upload:['visitor'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:{audience:'visitor'}},
   {id:'intake',read:'staff',upload:['staff'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:{audience:'staff'}}]}},
  {id:'listings',kind:'content',module:pin('module-collections'),schema:pin('collections-data'),dependencies:[],config:{collections:[{id:'directory',type:'directory-listing@1'}]}},
 ];
 const contentIds=['welcome','intro','book','members-title','staff-title','nav-home','nav-mine','nav-desk','compare-name','upload-label'];
 const spec=(presentation,over={})=>({content:contentIds.map(id=>({id,text:`Synthetic ${id}`})),instances:instances(),presentation,...over});
 const catalog={kit:pin('presentation-kit','c'),templates:[{...pin('portal-classic','d'),state:'available'},{...pin('studio-gallery','e'),state:'available'},{...pin('retired-starter','f'),state:'withdrawn'}]};
 const registry=()=>({members:{resourceId:uuid(1),configRevision:1},bookings:{resourceId:uuid(2),configRevision:3},media:{resourceId:uuid(3),configRevision:2},listings:{resourceId:uuid(4),configRevision:1}});
 const artifact={script:"const root=document.getElementById('root');\nconst show=r=>{for(const f of r.items){const b=document.createElement('button');b.textContent=f.alt;b.style.top='0';root.append(b);}};\nconst opts={data:1};\nwhumpo.call('photos',{target:null,input:null}).then(show);\n",
  style:'.pair{display:grid;gap:var(--wp-space)}button{min-height:24px;font-family:var(--wp-font-body)}'};
 const accessibility=()=>({name:'compare-name',role:'figure',keyboard:'operable',focusVisible:true,reducedMotion:'respected',textAlternatives:'provided',minTargetPx:24});
 const component=(over={})=>({id:'before-after',contractVersion:1,revision:1,
  artifact:{digest:lib.artifactDigest(artifact),scriptBytes:Buffer.byteLength(artifact.script),styleBytes:Buffer.byteLength(artifact.style)},
  capabilities:['modules'],uses:[{alias:'photos',instanceId:'media',operation:'files.gallery',target:{collectionId:'my-photos'}}],
  accessibility:accessibility(),frame:{minHeight:240,maxHeight:900},...over});
 const designs={
  classic:{palette:{ink:'#123f4e',paper:'#f3f9f9',accent:'#0b5c66',onAccent:'#ffffff',muted:'#3d5560'},typography:{heading:'serif',body:'sans',scale:'regular'},shape:{radius:'small',density:'comfortable'},motion:'subtle'},
  studio:{palette:{ink:'#1b1b1b',paper:'#fffaf2',accent:'#8a2c0d',onAccent:'#fff7ee',muted:'#5a4a3f'},typography:{heading:'slab',body:'serif',scale:'large'},shape:{radius:'none',density:'compact'},motion:'none'},
  bold:{palette:{ink:'#f4f1ea',paper:'#121a24',accent:'#ffcf4a',onAccent:'#121a24',muted:'#c9c3b8'},typography:{heading:'rounded',body:'rounded',scale:'compact'},shape:{radius:'large',density:'comfortable'},motion:'subtle'},
 };
 const uses=()=>[{instanceId:'bookings',operations:['forms.submit','records.update','records.view']},{instanceId:'listings',operations:['collections.readPublic']},
  {instanceId:'media',operations:['files.gallery','files.putBytes']},{instanceId:'members',operations:['access.me']}];
 const place=(id,componentName,binding,props)=>({id,component:componentName,binding,props});
 const bind=(instanceId,operation,target)=>({instanceId,operation,target});
 function composition(kind){
  const d=designs[kind],nav={classic:'top-bar',studio:'side-rail',bold:'tabs'}[kind],list={classic:'table',studio:'cards',bold:'list'}[kind];
  const interaction={classic:'grid',studio:'carousel',bold:'lightbox'}[kind];
  const navigation=place('nav','navigation@1',null,{style:nav,items:[{surfaceId:'home',label:'nav-home'},{surfaceId:'mine',label:'nav-mine'},{surfaceId:'desk',label:'nav-desk'}]});
  const visitorGallery=kind==='bold'?place('photos','custom@1',null,{componentId:'before-after'}):place('photos','gallery@1',bind('media','files.gallery',{collectionId:'my-photos'}),{interaction,columns:kind==='classic'?3:2});
  const regions=(main)=>kind==='classic'?[{id:'top',landmark:'header',placements:[navigation]},{id:'body',landmark:'main',placements:main}]
   :kind==='studio'?[{id:'rail',landmark:'navigation',placements:[navigation]},{id:'body',landmark:'main',placements:main},{id:'foot',landmark:'contentinfo',placements:[]}]
   :[{id:'body',landmark:'main',placements:main},{id:'tabs',landmark:'navigation',placements:[navigation]}];
  return {contractVersion:1,kit:catalog.kit,template:kind==='studio'?{name:'studio-gallery',version:1,digest:'e'.repeat(64)}:kind==='classic'?{name:'portal-classic',version:1,digest:'d'.repeat(64)}:null,
   design:structuredClone(d),uses:uses(),
   surfaces:[
    {id:'home',path:'/',audience:'public',title:'welcome',regions:regions([place('title','heading@1',null,{text:'welcome',level:1}),place('intro','text@1',null,{text:'intro'}),
     place('request','record-form@1',bind('bookings','forms.submit',{formId:'request'}),{layout:kind==='studio'?'two-column':'stacked',submitLabel:'book'}),
     place('listing','directory@1',bind('listings','collections.readPublic',{collectionId:'directory'}),{layout:kind==='classic'?'list':'cards'})])},
    {id:'mine',path:'/mine',audience:'visitor',title:'members-title',regions:regions([place('title','heading@1',null,{text:'members-title',level:1}),
     place('account','account@1',bind('members','access.me',null),{}),place('mine','record-list@1',bind('bookings','records.view',{viewId:'mine'}),{layout:list,columns:['name','vehicle']}),visitorGallery])},
    {id:'desk',path:'/desk',audience:'staff',title:'staff-title',regions:regions([place('title','heading@1',null,{text:'staff-title',level:1}),
     place('queue','record-list@1',bind('bookings','records.view',{viewId:'queue'}),{layout:list,columns:['name','vehicle','status']}),
     place('status','record-editor@1',bind('bookings','records.update',{recordId:'appointment'}),{fields:['status']}),
     place('intake','gallery@1',bind('media','files.gallery',{collectionId:'intake'}),{interaction,columns:4}),
     place('upload','upload@1',bind('media','files.putBytes',{collectionId:'intake'}),{label:'upload-label'})])}],
   components:kind==='bold'?[component()]:[]};
 }
 const kinds=['classic','studio','bold'];
 const valid=(p,s=spec(p))=>lib.validatePresentation(p,s,catalog);
 const invalid=(name,kind,mutate,code,path)=>test(name,()=>{const p=composition(kind),s=spec(p);mutate(p,s);rejects(()=>lib.validatePresentation(p,s,catalog),code,path);});
 const surface=(p,id)=>p.surfaces.find(s=>s.id===id);
 const main=(p,id)=>surface(p,id).regions.find(r=>r.landmark==='main').placements;
 const custom=p=>p.components[0];

 // Positive compositions and functional reuse versus visual diversity.
 test('three distinct compositions validate',()=>{for(const k of kinds){const p=composition(k);assert.deepEqual(valid(p),p);}});
 test('identical API footprint, distinct visual fingerprints',()=>{
  const [a,b,c]=kinds.map(composition);
  assert.deepEqual(lib.apiFootprint(a),lib.apiFootprint(b));assert.deepEqual(lib.apiFootprint(b),lib.apiFootprint(c));
  assert.equal(new Set([a,b,c].map(lib.presentationFingerprint)).size,3);
  for(const [x,y] of [[a,b],[b,c],[a,c]])assert.ok(lib.designDistance(x.design,y.design)>=5);
 });
 // Identical API/permission conformance: every footprint tuple decided by the frozen WH-067 policy table for each
 // principal gives the same table for every composition, because presentation cannot alter the decision inputs.
 const descriptor=(kind,n)=>({contractVersion:1,ref:{projectId:project,resourceId:uuid(n)},kind,module:pin(shared.moduleKinds[kind].module),schema:pin(shared.moduleKinds[kind].schema),
  ownership:{data:[{id:'primary',classId:`module-${kind}`,subject:'project',export:'eligible'}],assets:[]},
  dependencies:kind==='access'||kind==='content'?[]:[{ref:{projectId:project,resourceId:uuid(1)},module:pin(shared.moduleKinds.access.module)}],
  lifecycle:{exportFormat:1,exportHook:`${kind}-export-v1`,deleteHook:`${kind}-delete-v1`,restoreHook:`${kind}-restore-v1`,migrateHook:`${kind}-migrate-v1`,portability:'not-verified'}});
 const envelope=(i,n)=>({contractVersion:1,descriptor:descriptor(i.kind,n),config:i.config,configRevision:1,source:{specificationVersionId:'66666666-6666-4666-8666-666666666666',specificationDigest:'b'.repeat(64)}});
 const envelopes=Object.fromEntries(instances().map((i,n)=>[i.id,envelope(i,n+1)]));
 const principals={public:{kind:'public',projectId:project},visitor:{kind:'visitor',projectId:project,visitorId:uuid(90),roles:[],accessRevision:2},
  staff:{kind:'visitor',projectId:project,visitorId:uuid(91),roles:['staff'],accessRevision:2},foreign:{kind:'visitor',projectId:otherProject,visitorId:uuid(92),roles:['staff'],accessRevision:2}};
 const runtimeTarget=(op,target)=>op==='records.update'?{...target,changes:{status:'ready'}}:target;
 const conformance=p=>lib.apiFootprint(p).map(row=>{const [id,op,json]=row.split(/:(.+?):(.+)/).filter(Boolean);const t=JSON.parse(json);
  return [row,Object.fromEntries(Object.entries(principals).map(([name,pr])=>[name,shared.decide(pr,envelopes[id],op,runtimeTarget(op,t)).decision]))];});
 test('three compositions pass identical API/permission conformance cases',()=>{
  const [a,b,c]=kinds.map(k=>conformance(composition(k)));assert.deepEqual(a,b);assert.deepEqual(b,c);
  assert.ok(a.every(([,r])=>r.foreign==='deny'));
  assert.deepEqual(Object.fromEntries(a)['bookings:records.view:{"viewId":"queue"}'],{public:'deny',visitor:'deny',staff:'allow',foreign:'deny'});
 });
 test('static audience projection agrees with the frozen policy table',()=>{
  const targets={'forms.submit':[{formId:'request'},{formId:'member-request'}],'records.view':[{viewId:'queue'},{viewId:'mine'}],'records.get':[{recordId:'appointment'}],
   'records.update':[{recordId:'appointment'}],'files.putBytes':[{collectionId:'my-photos'},{collectionId:'intake'}],'files.read':[{collectionId:'my-photos'},{collectionId:'intake'}],
   'files.gallery':[{collectionId:'my-photos'},{collectionId:'intake'}],'access.me':[null],'collections.readPublic':[{collectionId:'directory'}]};
  let compared=0;
  for(const i of instances())for(const [op,list] of Object.entries(targets)){
   if(shared.moduleOperations[op].kind!==i.kind)continue;
   for(const t of list)for(const audience of lib.audiences){compared++;
    assert.equal(lib.audienceAllows(i,op,t,audience),shared.decide(principals[audience],envelopes[i.id],op,runtimeTarget(op,t)).decision==='allow',`${i.id} ${op} ${JSON.stringify(t)} ${audience}`);}
  }
  assert.equal(compared,42);
 });
 test('current detailing fixture instances compose without new backend',()=>{
  const s={content:detailing.content,instances:detailing.instances,presentation:null};
  const p={contractVersion:1,kit:catalog.kit,template:null,design:designs.classic,uses:[{instanceId:'appointments',operations:['forms.submit','records.view']}],components:[],surfaces:[
   {id:'request',path:'/',audience:'visitor',title:'headline',regions:[{id:'body',landmark:'main',placements:[place('title','heading@1',null,{text:'headline',level:1}),
    place('form','record-form@1',bind('appointments','forms.submit',{formId:'appointment-request'}),{layout:'stacked',submitLabel:'services-title'})]}]},
   {id:'desk',path:'/desk',audience:'staff',title:'hours-title',regions:[{id:'body',landmark:'main',placements:[place('title','heading@1',null,{text:'hours-title',level:1}),
    place('queue','record-list@1',bind('appointments','records.view',{viewId:'queue'}),{layout:'table',columns:['name','service']})]}]}]};
  s.presentation=p;assert.deepEqual(lib.validatePresentation(p,s,catalog),p);
 });
 test('accessibility evaluation is independent of functional reuse',()=>{
  const a=composition('classic'),b=structuredClone(a);
  b.uses=b.uses.filter(u=>u.instanceId!=='listings');main(b,'home').splice(3,1);valid(b);
  assert.deepEqual(lib.accessibilityReport(a),lib.accessibilityReport(b));assert.notDeepEqual(lib.apiFootprint(a),lib.apiFootprint(b));
  const c=structuredClone(a);c.design=structuredClone(designs.studio);valid(c);
  assert.deepEqual(lib.apiFootprint(a),lib.apiFootprint(c));assert.notDeepEqual(lib.accessibilityReport(a).contrast,lib.accessibilityReport(c).contrast);
  for(const k of kinds){const r=lib.accessibilityReport(composition(k));assert.ok(r.contrast.text>=4.5&&r.contrast.onAccent>=4.5&&r.contrast.accentBoundary>=3);assert.ok(r.surfaces.every(s=>s.mainLandmarks===1&&s.levelOneHeadings===1));}
 });

 // Level 1 design configuration.
 test('design compiles to deterministic same-origin CSS custom properties',()=>{
  const css=lib.designCss(designs.classic);assert.equal(css,lib.designCss(Object.fromEntries(Object.entries(designs.classic).reverse())));
  assert.match(css,/--wp-ink:#123f4e/);assert.match(css,/prefers-reduced-motion/);assert.doesNotMatch(css,/url\(|@import|@font-face|https?:/);
  assert.notEqual(css,lib.designCss(designs.studio));
 });
 invalid('arbitrary CSS field refused','classic',p=>{p.design.css='body{background:url(https://x.example/a.png)}';},'UNKNOWN_FIELD');
 invalid('remote font token refused','classic',p=>{p.design.typography.heading='https://fonts.example/brand';},'UNSUPPORTED_TOKEN');
 invalid('named or invalid color refused','classic',p=>{p.design.palette.ink='red';},'INVALID_COLOR');
 invalid('low text contrast refused','classic',p=>{p.design.palette.ink='#9fb8bf';},'CONTRAST_INSUFFICIENT','ink');
 invalid('low button contrast refused','classic',p=>{p.design.palette.onAccent='#1a6f7a';},'CONTRAST_INSUFFICIENT','onAccent');

 // Versions and pins: unknown or stale identities fail closed; kit, template and modules are identified separately.
 invalid('future presentation contract','classic',p=>{p.contractVersion=2;},'UNSUPPORTED_VERSION');
 invalid('retired presentation contract','classic',p=>{p.contractVersion=0;},'UNSUPPORTED_VERSION');
 invalid('unknown top-level field','classic',p=>{p.script='alert(1)';},'UNKNOWN_FIELD');
 invalid('stale kit digest','classic',p=>{p.kit={...p.kit,digest:'9'.repeat(64)};},'STALE_KIT_VERSION');
 invalid('unknown kit version','classic',p=>{p.kit={...p.kit,version:2};},'STALE_KIT_VERSION');
 invalid('stale template digest','classic',p=>{p.template={...p.template,digest:'9'.repeat(64)};},'STALE_TEMPLATE_VERSION');
 invalid('withdrawn template','classic',p=>{p.template={...pin('retired-starter','f')};},'UNAVAILABLE');
 invalid('unknown component version','classic',p=>{main(p,'mine')[3].component='gallery@2';},'UNSUPPORTED_COMPONENT');
 invalid('stale custom component contract','bold',p=>{custom(p).contractVersion=2;},'UNSUPPORTED_VERSION');
 invalid('reserved module route path','classic',p=>{surface(p,'mine').path='/modules';},'INCOMPATIBLE');

 // Level 2 composition cannot widen backend permissions.
 invalid('staff view on a public surface','classic',p=>{main(p,'home').push(place('leak','record-list@1',bind('bookings','records.view',{viewId:'queue'}),{layout:'table',columns:['name']}));},'AUDIENCE_EXCEEDS_POLICY');
 invalid('staff gallery on a visitor surface','classic',p=>{main(p,'mine')[3].binding.target.collectionId='intake';},'AUDIENCE_EXCEEDS_POLICY');
 invalid('staff field editor on a visitor surface','classic',p=>{main(p,'mine').push(place('edit','record-editor@1',bind('bookings','records.update',{recordId:'appointment'}),{fields:['status']}));},'AUDIENCE_EXCEEDS_POLICY');
 invalid('visitor upload into a staff-only collection','classic',p=>{main(p,'mine').push(place('up','upload@1',bind('media','files.putBytes',{collectionId:'intake'}),{label:'upload-label'}));},'AUDIENCE_EXCEEDS_POLICY');
 invalid('gallery component rebound to a write','classic',p=>{main(p,'mine')[3].binding=bind('bookings','records.update',{recordId:'appointment'});},'COMPONENT_BINDING_MISMATCH');
 invalid('owner-only field projected in a staff list','classic',p=>{main(p,'desk')[1].props.columns.push('notes');},'FIELD_FORBIDDEN');
 invalid('editor field outside staffWrite','classic',p=>{main(p,'desk')[2].props.fields=['name'];},'FIELD_FORBIDDEN');
 invalid('caller-supplied project in a binding target','classic',p=>{main(p,'home')[2].binding.target.projectId=otherProject;},'AUTHORITY_FIELD');
 invalid('role grant smuggled into a binding','classic',p=>{main(p,'desk')[1].binding.role='staff';},'AUTHORITY_FIELD');
 invalid('owner removal is not presentable','classic',p=>{p.uses[0].operations.push('records.remove');},'OPERATION_NOT_PRESENTABLE');
 invalid('role review is not presentable','classic',p=>{p.uses[3].operations.push('access.prepareRole');},'OPERATION_NOT_PRESENTABLE');
 invalid('staff surface needs the access staff role','classic',(p,s)=>{s.instances[0].config.roles=[];},'MISSING_DEPENDENCY');
 invalid('visitor surface needs an access instance','classic',(p,s)=>{s.instances=s.instances.filter(i=>i.kind!=='access');p.uses=p.uses.filter(u=>u.instanceId!=='members');main(p,'mine').splice(1,1);},'MISSING_DEPENDENCY');

 // Copying or forking a standard backend to vary typography, navigation or gallery interaction.
 invalid('handler code attached to a placement','classic',p=>{main(p,'mine')[3].handler='export default ()=>1';},'BACKEND_FORBIDDEN');
 invalid('component carrying backend source','bold',p=>{custom(p).backend={source:'export default()=>1'};},'BACKEND_FORBIDDEN');
 invalid('component overriding module configuration','bold',p=>{custom(p).config={read:'submitter'};},'BACKEND_FORBIDDEN');
 invalid('component granting itself permissions','bold',p=>{custom(p).permissions=['records.update'];},'AUTHORITY_FIELD');
 const state=()=>{const p=composition('bold');return {spec:spec(p),registry:registry()};};
 test('a forked files instance for a new gallery style is refused',()=>{
  const s=state(),after=structuredClone(s.spec),media=after.instances.find(i=>i.id==='media');
  const copy=structuredClone(media);copy.id='media-carousel';copy.config.collections=copy.config.collections.map(c=>({...c,id:`${c.id}-copy`}));after.instances.push(copy);
  rejects(()=>lib.classifySpecificationChange(s.spec,after),'FORK_FOR_PRESENTATION');
  const distinct=structuredClone(copy);distinct.config.collections[0].maxBytes=524288;after.instances[after.instances.length-1]=distinct;
  assert.deepEqual(lib.classifySpecificationChange(s.spec,after).modules.changed,['media-carousel']);
 });
 for(const type of ['modules.put','modules.remove','records.addField'])test(`presentation operations cannot run ${type}`,()=>rejects(()=>lib.changePresentation(state(),[{type,instanceId:'media'}],catalog),'PRESENTATION_CANNOT_CHANGE_MODULES'));
 test('unknown presentation operation',()=>rejects(()=>lib.changePresentation(state(),[{type:'presentation.setCss',css:''}],catalog),'UNSUPPORTED_OPERATION'));

 // Declared module dependencies.
 invalid('undeclared module dependency','classic',p=>{p.uses=p.uses.filter(u=>u.instanceId!=='listings');},'UNDECLARED_DEPENDENCY','listings');
 invalid('undeclared operation on a declared instance','classic',p=>{p.uses[0].operations=['forms.submit','records.view'];},'UNDECLARED_DEPENDENCY','records.update');
 invalid('declared but unused dependency','classic',p=>{p.uses[2].operations.push('files.read');},'UNUSED_DEPENDENCY');
 invalid('dependency on an unknown instance','classic',p=>{p.uses.push({instanceId:'payments',operations:['forms.submit']});},'MISSING_REFERENCE');
 invalid('operation of another module kind','classic',p=>{p.uses[1].operations.push('forms.submit');},'UNSUPPORTED_OPERATION');
 invalid('component use outside the declared dependencies','bold',p=>{p.uses[2].operations=['files.putBytes'];main(p,'mine');},'UNDECLARED_DEPENDENCY','files.gallery');

 // Level 3 custom component boundary.
 for(const cap of ['network','storage','credentials','auth','inference','same-origin','popups','teleport'])
  invalid(`custom component capability ${cap}`,'bold',p=>{custom(p).capabilities=[cap];},'FORBIDDEN_CAPABILITY');
 for(const key of ['network','inference','cookies'])invalid(`custom component ${key} switch`,'bold',p=>{custom(p)[key]=true;},'FORBIDDEN_CAPABILITY');
 invalid('module use without the modules capability','bold',p=>{custom(p).capabilities=[];},'UNDECLARED_CAPABILITY');
 invalid('custom component record write','bold',p=>{custom(p).uses.push({alias:'edit',instanceId:'bookings',operation:'records.update',target:{recordId:'appointment'}});},'CUSTOM_WRITE_FORBIDDEN');
 invalid('custom component upload','bold',p=>{custom(p).uses.push({alias:'up',instanceId:'media',operation:'files.putBytes',target:{collectionId:'my-photos'}});},'CUSTOM_WRITE_FORBIDDEN');
 invalid('custom component owner operation','bold',p=>{custom(p).uses.push({alias:'rm',instanceId:'bookings',operation:'records.remove',target:{recordId:'appointment'}});},'OPERATION_NOT_PRESENTABLE');
 invalid('custom component staff gallery on a visitor surface','bold',p=>{custom(p).uses[0].target.collectionId='intake';},'AUDIENCE_EXCEEDS_POLICY');
 invalid('custom component use with caller authority','bold',p=>{custom(p).uses[0].visitorId=uuid(5);},'AUTHORITY_FIELD');
 invalid('missing accessibility declaration','bold',p=>{delete custom(p).accessibility;},'ACCESSIBILITY_REQUIRED');
 invalid('partial accessibility declaration','bold',p=>{delete custom(p).accessibility.keyboard;},'ACCESSIBILITY_REQUIRED');
 invalid('focus indicator not promised','bold',p=>{custom(p).accessibility.focusVisible=false;},'ACCESSIBILITY_REQUIRED');
 invalid('targets below WCAG 2.5.8 minimum','bold',p=>{custom(p).accessibility.minTargetPx=16;},'ACCESSIBILITY_REQUIRED');
 invalid('motion ignores reduced-motion preference','bold',p=>{custom(p).accessibility.reducedMotion='ignored';},'ACCESSIBILITY_REQUIRED');
 invalid('surface without a main landmark','classic',p=>{for(const r of surface(p,'mine').regions)if(r.landmark==='main')r.landmark='complementary';},'ACCESSIBILITY_REQUIRED','main');
 invalid('surface with two level-one headings','classic',p=>{main(p,'mine').push(place('again','heading@1',null,{text:'welcome',level:1}));},'ACCESSIBILITY_REQUIRED','h1');
 invalid('declared component never placed','classic',p=>{p.components.push(component());},'UNUSED_COMPONENT');
 invalid('oversize script declaration','bold',p=>{custom(p).artifact.scriptBytes=16385;},'TOO_LARGE');
 invalid('oversize style declaration','bold',p=>{custom(p).artifact.styleBytes=9000;},'TOO_LARGE');
 invalid('oversize presentation','classic',p=>{for(const r of surface(p,'mine').regions)r.placements.push(...Array.from({length:7},(_,n)=>place(`pad-${n}`,'text@1',null,{text:'intro'})));p.design.motion='x'.repeat(13000);},'TOO_LARGE');
 invalid('frame height outside bounds','bold',p=>{custom(p).frame.maxHeight=5000;},'INVALID_NUMBER');
 const declaration=component();
 test('benign artifact passes static checks and digest binding',()=>assert.equal(lib.validateComponentArtifact(artifact,declaration).digest,declaration.artifact.digest));
 const samples={network:'fetch("/x")','dynamic-code':'eval("1")',storage:'localStorage.setItem("a","b")',credentials:'navigator.credentials.get({})',
  'frame-escape':'window.top.location="x"','html-sink':'root.innerHTML=r.html',workers:'new Worker("w.js")',inference:'ai.run("model")',
  'absolute-url':'const u="https://evil.example"','platform-route':'const r="/modules"',device:'navigator.geolocation.getCurrentPosition(()=>1)'};
 for(const [rule,line] of Object.entries(samples))test(`static check refuses ${rule}`,()=>{
  const bad={...artifact,script:artifact.script+line+'\n'},d=component({artifact:{digest:lib.artifactDigest(bad),scriptBytes:Buffer.byteLength(bad.script),styleBytes:Buffer.byteLength(bad.style)}});
  rejects(()=>lib.validateComponentArtifact(bad,d),'DISALLOWED_CONTENT',rule);
 });
 assert.deepEqual(Object.keys(samples).sort(),lib.scriptRules.map(([rule])=>rule).sort());
 for(const [rule,style] of [['remote-resource','@import "https://x.example/a.css";'],['remote-resource','.a{background:url(x.png)}'],['legacy-script','.a{width:expression(1)}'],['markup','</style><script>']])
  test(`style check refuses ${rule} (${style.slice(0,12)})`,()=>{const bad={...artifact,style},d=component({artifact:{digest:lib.artifactDigest(bad),scriptBytes:Buffer.byteLength(bad.script),styleBytes:Buffer.byteLength(style)}});rejects(()=>lib.validateComponentArtifact(bad,d),'DISALLOWED_CONTENT',rule);});
 test('bidirectional control characters refused',()=>{const bad={...artifact,script:artifact.script+'// ‮ hidden\n'},d=component({artifact:{digest:lib.artifactDigest(bad),scriptBytes:Buffer.byteLength(bad.script),styleBytes:Buffer.byteLength(bad.style)}});rejects(()=>lib.validateComponentArtifact(bad,d),'DISALLOWED_CONTENT','hidden');});
 test('artifact bytes above the bound refused',()=>{const bad={...artifact,script:'//'+'x'.repeat(16384)};rejects(()=>lib.validateComponentArtifact(bad,declaration),'TOO_LARGE');});
 test('artifact swapped after review refused',()=>{const other={...artifact,style:artifact.style+'.b{}'};rejects(()=>lib.validateComponentArtifact(other,declaration),'DIGEST_MISMATCH');});

 // Frame boundary and host bridge.
 test('host policy matches the current visitor host and adds only frame-src',()=>{
  assert.ok(appHost.includes(`const policy="${lib.visitorHostPolicy}"`));
  assert.equal(lib.hostPolicy(false),lib.visitorHostPolicy);assert.equal(lib.hostPolicy(true),lib.visitorHostPolicy+"; frame-src 'self'");
  assert.equal(lib.frameSandbox,'allow-scripts');
 });
 test('component frame runs in an opaque origin with no network',()=>{
  const h=lib.componentFrameHeaders(artifact,'whumpo.bootstrap()'),csp=h['content-security-policy'];
  assert.match(csp,/^sandbox allow-scripts; default-src 'none';/);assert.doesNotMatch(csp,/allow-same-origin|allow-popups|allow-forms|allow-top-navigation|unsafe-|script-src[^;]*'self'|\*/);
  for(const d of ["connect-src 'none'","frame-src 'none'","worker-src 'none'","form-action 'none'","base-uri 'none'","frame-ancestors 'self'","require-trusted-types-for 'script'"])assert.ok(csp.includes(d),d);
  assert.equal((csp.match(/'sha256-[A-Za-z0-9+/]+=*'/g)??[]).length,3);assert.equal(h['cache-control'],'private, no-store');assert.equal(h['x-frame-options'],'SAMEORIGIN');
 });
 test('manifest is deterministic and pins configRevision per used instance',()=>{
  const s=state(),a=lib.compileManifest(s,catalog),b=lib.compileManifest({...s,spec:{...s.spec,presentation:Object.fromEntries(Object.entries(s.spec.presentation).reverse())}},catalog);
  assert.equal(a.digest,b.digest);assert.deepEqual(Object.keys(a.manifest.instances),['bookings','listings','media','members']);
  assert.deepEqual(a.manifest.instances.bookings,{resourceId:uuid(2),configRevision:3});assert.ok(lib.checkManifestCurrent(a.manifest,s.registry));
  const bumped=registry();bumped.bookings.configRevision=4;rejects(()=>lib.checkManifestCurrent(a.manifest,bumped),'STALE_CONFIGURATION');
  const unregistered=registry();delete unregistered.media;rejects(()=>lib.compileManifest({...s,registry:unregistered},catalog),'UNAVAILABLE');
 });
 const manifest=lib.compileManifest(state(),catalog).manifest;
 test('bridge builds the closed envelope from bridge-owned fields',()=>{
  const r=lib.bridgeRequest(manifest,'before-after',{alias:'photos',target:null,input:null},null);
  assert.deepEqual(r,{api:'whumpo-modules',version:1,operation:'files.gallery',resourceId:uuid(3),configRevision:2,requestId:null,target:{collectionId:'my-photos'},input:null});
  const writes={...manifest,components:{form:{revision:1,artifactDigest:'a'.repeat(64),uses:{send:{operation:'forms.submit',target:{formId:'request'},resourceId:uuid(2),configRevision:3}}}}};
  assert.equal(lib.bridgeRequest(writes,'form',{alias:'send',target:null,input:{values:{name:'Synthetic'}}},'77777777-7777-4777-8777-777777777777').requestId,'77777777-7777-4777-8777-777777777777');
 });
 for(const [name,message,code] of [['component sets resourceId',{alias:'photos',target:null,input:null,resourceId:uuid(9)},'BRIDGE_FIELD'],
  ['component sets configRevision',{alias:'photos',target:null,input:null,configRevision:1},'BRIDGE_FIELD'],
  ['component picks the operation',{alias:'photos',target:null,input:null,operation:'records.update'},'BRIDGE_FIELD'],
  ['component supplies a project',{alias:'photos',target:null,input:null,projectId:otherProject},'AUTHORITY_FIELD'],
  ['undeclared alias',{alias:'everything',target:null,input:null},'UNDECLARED_DEPENDENCY'],
  ['static target override',{alias:'photos',target:{collectionId:'intake'},input:null},'BRIDGE_FIELD'],
  ['target role smuggling',{alias:'photos',target:{role:'staff'},input:null},'AUTHORITY_FIELD'],
  ['unknown runtime key',{alias:'photos',target:{query:'SELECT 1'},input:null},'UNKNOWN_FIELD']])
  test(`bridge refuses ${name}`,()=>rejects(()=>lib.bridgeRequest(manifest,'before-after',message,null),code));
 test('bridge output still passes the shared envelope check',()=>rejects(()=>lib.bridgeRequest(manifest,'before-after',{alias:'photos',target:null,input:{sql:'x'}},null),'AUTHORITY_FIELD'));

 // Change classification: presentation never touches module pins or configRevision; template and dependency changes
 // are reported separately.
 const digest=v=>JSON.stringify(v);
 test('design change leaves modules and registry untouched',()=>{
  const s=state(),instancesBefore=digest(s.spec.instances),registryBefore=digest(s.registry);
  const r=lib.changePresentation(s,[{type:'presentation.setDesign',design:designs.studio}],catalog);
  assert.equal(digest(r.state.spec.instances),instancesBefore);assert.equal(digest(r.state.registry),registryBefore);assert.equal(r.state.registry,s.registry);
  assert.deepEqual(r.classification.modules.changed,[]);assert.equal(r.classification.template,'unchanged');assert.deepEqual(r.classification.dependencies,{added:[],removed:[]});
  assert.deepEqual(r.classification.reviews,['presentation']);assert.ok(lib.checkManifestCurrent(lib.compileManifest(r.state,catalog).manifest,s.registry));
 });
 test('gallery interaction and navigation changes are presentation-only',()=>{
  const s={spec:spec(composition('classic')),registry:registry()},home=structuredClone(surface(s.spec.presentation,'mine'));
  home.regions[0].placements[0].props.style='tabs';home.regions[1].placements[3].props.interaction='masonry';
  const r=lib.changePresentation(s,[{type:'presentation.putSurface',surface:home}],catalog);
  assert.deepEqual(r.classification.reviews,['presentation']);assert.deepEqual(r.classification.presentation.surfaces,['mine']);assert.deepEqual(r.classification.modules.changed,[]);
 });
 test('template change is reported separately',()=>{
  const s={spec:spec(composition('classic')),registry:registry()};
  const r=lib.changePresentation(s,[{type:'presentation.setTemplate',template:{name:'studio-gallery',version:1,digest:'e'.repeat(64)}}],catalog);
  assert.equal(r.classification.template,'changed');assert.deepEqual(r.classification.reviews,['presentation','template']);assert.deepEqual(r.classification.modules.changed,[]);
 });
 test('module dependency change is reported separately and edits no instance',()=>{
  const s={spec:spec(composition('classic')),registry:registry()},home=structuredClone(surface(s.spec.presentation,'home'));
  home.regions[1].placements.splice(3,1);
  const r=lib.changePresentation(s,[{type:'presentation.putSurface',surface:home},{type:'presentation.setUses',uses:uses().filter(u=>u.instanceId!=='listings')}],catalog);
  assert.deepEqual(r.classification.dependencies,{added:[],removed:['listings:collections.readPublic']});assert.deepEqual(r.classification.reviews,['dependencies','presentation']);
  assert.equal(digest(r.state.spec.instances),digest(s.spec.instances));assert.equal(r.state.registry,s.registry);
  const back=lib.changePresentation(r.state,[{type:'presentation.putSurface',surface:surface(s.spec.presentation,'home')},{type:'presentation.setUses',uses:uses()}],catalog);
  assert.deepEqual(back.classification.dependencies.added,['listings:collections.readPublic']);
 });
 test('custom component revision is its own review class',()=>{
  const s=state(),next=component({revision:2,frame:{minHeight:240,maxHeight:1000}});
  const r=lib.changePresentation(s,[{type:'presentation.putComponent',component:next}],catalog);
  assert.deepEqual(r.classification.reviews,['custom-component','presentation']);assert.deepEqual(r.classification.presentation.components,['before-after']);
 });
 test('module changes are classified apart from presentation',()=>{
  const s=state(),after=structuredClone(s.spec);after.instances[1].config.schemas[0].fields[1].label='Car';
  const c=lib.classifySpecificationChange(s.spec,after);assert.deepEqual(c.modules.changed,['bookings']);assert.deepEqual(c.reviews,['modules']);
 });
 test('no-op presentation change refused',()=>{const s=state();rejects(()=>lib.changePresentation(s,[{type:'presentation.setDesign',design:s.spec.presentation.design}],catalog),'NO_CHANGE');});

 // Owner-maintenance focused edits.
 test('focused context loads only the component and its contracts',()=>{
  const s=state(),other={script:'const z=1;\n',style:''},ctx=lib.focusedEditContext(s,{componentId:'before-after'},{[lib.artifactDigest(artifact)]:artifact,[lib.artifactDigest(other)]:other});
  assert.deepEqual(ctx.artifact,artifact);assert.deepEqual(ctx.contracts.map(c=>`${c.instanceId}:${c.operation}`),['media:files.gallery']);
  const text=JSON.stringify(ctx);for(const absent of [lib.artifactDigest(other),'surfaces','registry','resourceId','configRevision','bookings','notes','members'])assert.ok(!text.includes(absent),absent);
  const placement=lib.focusedEditContext(s,{surfaceId:'desk',placementId:'queue'});
  assert.deepEqual(placement.contracts[0].contract.fields.map(f=>f.key),['name','vehicle','status']);assert.ok(!JSON.stringify(placement).includes('notes'));
 });
 test('focused edit preserves everything else',()=>{
  const s=state(),before=s.spec.presentation,after=structuredClone(before);after.components[0].frame.maxHeight=1000;
  assert.ok(lib.assertFocusedEdit(before,after,{componentId:'before-after'}));
  const wider=structuredClone(after);surface(wider,'home').title='intro';rejects(()=>lib.assertFocusedEdit(before,wider,{componentId:'before-after'}),'UNFOCUSED_EDIT');
  const deps=structuredClone(after);deps.uses[2].operations.push('files.read');rejects(()=>lib.assertFocusedEdit(before,deps,{componentId:'before-after'}),'UNFOCUSED_EDIT');
  const placed=structuredClone(before);main(placed,'desk')[1].props.layout='cards';assert.ok(lib.assertFocusedEdit(before,placed,{surfaceId:'desk',placementId:'queue'}));
  main(placed,'desk')[3].props.columns=2;rejects(()=>lib.assertFocusedEdit(before,placed,{surfaceId:'desk',placementId:'queue'}),'UNFOCUSED_EDIT');
 });

 test('contract document names the frozen anchors',()=>{for(const anchor of ['contractVersion','presentation-kit@1','whumpo-modules','sandbox allow-scripts',"connect-src 'none'",'ACCESSIBILITY_REQUIRED','FORK_FOR_PRESENTATION','UNDECLARED_DEPENDENCY','tools/prototypes/customer-presentation.mjs','tests/customer-presentation-contract.mjs','**Planned contract'])assert.ok(doc.includes(anchor),anchor);});
 return count;
}

const count=suite(await import(prototypeURL.href));

// Mutation check: each edit removes one guard from a temporary copy of the reference. The suite must fail on every copy.
const source=readFileSync(prototypeURL,'utf8');
const mutations=[
 ['capability allowlist',"for(const cap of c.capabilities)check(cap==='modules',","for(const cap of c.capabilities)check(true,"],
 ['custom write allowlist','customWriteOperations.includes(u.operation)','true'],
 ['audience projection',"check(audienceAllows(instance,operation,target,audience),","check(true,"],
 ['undeclared dependency',"check(declared.has(t),'UNDECLARED_DEPENDENCY'","check(true,'UNDECLARED_DEPENDENCY'"],
 ['unused dependency',"check(required.has(t),'UNUSED_DEPENDENCY'","check(true,'UNUSED_DEPENDENCY'"],
 ['presentable operations',"check(Object.hasOwn(presentableOperations,op),","check(true,"],
 ['network rule',"['network',/\\b(?:fetch|","['network',/\\b(?:__never__|"],
 ['hidden characters','check(!hidden.test(value)','check(true'],
 ['digest binding','check(declaration.artifact.digest===artifactDigest(input)&&','check(true||'],
 ['declared script bound','integer(c.artifact.scriptBytes,0,limits.scriptBytes,','integer(c.artifact.scriptBytes,0,1e9,'],
 ['accessibility presence',"check(Object.hasOwn(input,'accessibility'),","check(true,"],
 ['accessibility focus',"check(a.focusVisible===true,","check(true,"],
 ['main landmark',"check(mains===1,","check(true,"],
 ['presentation version','check(p.contractVersion===presentationContractVersion,','check(true,'],
 ['kit pin','check(samePin(p.kit,catalog.kit),','check(true,'],
 ['template pin',"check(samePin(p.template,entry),","check(true,"],
 ['text contrast','contrast(p.ink,p.paper)>=4.5','contrast(p.ink,p.paper)>=1'],
 ['authority keys',"check(!authorityKeys.includes(k),'AUTHORITY_FIELD',`${path}.${k}`);","check(true,'AUTHORITY_FIELD',`${path}.${k}`);"],
 ['backend keys',"check(!backendKeys.includes(k),'BACKEND_FORBIDDEN',","check(true,'BACKEND_FORBIDDEN',"],
 ['binding/component match',"check(x.binding.operation===def.op,","check(true,"],
 ['fork detection','check(!existing.has(serviceIdentity(next.get(id))),','check(true,'],
 ['module operation refusal',"/^(?:modules|records)\\./.test(op.type)?'PRESENTATION_CANNOT_CHANGE_MODULES':'UNSUPPORTED_OPERATION'","'UNSUPPORTED_OPERATION'"],
 ['instances passed through','const after={...spec,presentation:next};','const after={...spec,instances:spec.instances.map(i=>({...i,module:{...i.module,version:2}})),presentation:next};'],
 ['template review',"if(result.template==='changed'||result.kit==='changed')reviews.add('template');",''],
 ['dependency report','removed:[...ua].filter(t=>!ub.has(t)).sort()','removed:[]'],
 ['stale manifest','check(r.configRevision===pinned.configRevision,','check(true,'],
 ['bridge-owned fields',"check(!['api','version','operation','resourceId','configRevision','requestId'].includes(k),'BRIDGE_FIELD'","check(true,'BRIDGE_FIELD'"],
 ['bridge static target',"check(!rules.target.includes(k),'BRIDGE_FIELD'","check(true,'BRIDGE_FIELD'"],
 ['frame network',`"connect-src 'none'"`,`"connect-src 'self'"`],
 ['frame origin',"const csp=['sandbox allow-scripts',","const csp=['sandbox allow-scripts allow-same-origin',"],
 ['focused artifact','Object.hasOwn(artifacts,c.artifact.digest)?structuredClone(artifacts[c.artifact.digest]):null','structuredClone(artifacts)'],
 ['focused preservation',"check(same(strip(before),strip(after)),'UNFOCUSED_EDIT'","check(true,'UNFOCUSED_EDIT'"],
];
const dir=mkdtempSync(join(tmpdir(),'whumpo-presentation-mutants-'));
try{
 // Control: an unmutated copy loaded the same way must pass, so a kill is never just an import or path failure.
 const control=join(dir,'control.mjs');writeFileSync(control,source.replace("'./shared-modules.mjs'",JSON.stringify(sharedURL.href)));
 assert.equal(suite(await import(pathToFileURL(control).href)),count);
 for(const [index,[name,from,to]] of mutations.entries()){
  assert.ok(source.includes(from),`mutation target missing: ${name}`);
  const file=join(dir,`mutant-${index}.mjs`);
  writeFileSync(file,source.replace(from,to).replace("'./shared-modules.mjs'",JSON.stringify(sharedURL.href)));
  // Import outside the kill check: a mutant that fails to load is a broken harness, not a kill.
  const mutant=await import(pathToFileURL(file).href);
  let killedBy=null;try{suite(mutant);}catch(error){killedBy=error.message;}
  assert.ok(killedBy,`mutation survived: ${name}`);
  if(process.env.MUTATION_REPORT)console.log(`${name} -> ${killedBy}`);
 }
}finally{rmSync(dir,{recursive:true,force:true});}
console.log(`customer-presentation contract: ${count} offline checks passed; ${mutations.length}/${mutations.length} mutations killed`);
