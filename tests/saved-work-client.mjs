import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Offline client contract: strict current saved-work/turn readers, truthful labels and exact destinations.
const {outputFiles}=await build({entryPoints:['frontend/src/lib/saved-work.ts'],bundle:true,format:'esm',write:false});
const client=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const {savedWorkKinds}=await import('data:text/javascript;base64,'+Buffer.from((await build({entryPoints:['src/saved-work-shape.ts'],bundle:true,format:'esm',write:false})).outputFiles[0].text).toString('base64'));
const id=()=>crypto.randomUUID(),sorted=n=>Array.from({length:n},id).sort();let cases=0;
const test=(name,fn)=>{try{fn();cases++;}catch(error){console.error(name);throw error;}};
const entry=(over={})=>{const kind=over.kind??'chat',item=over.id??id();return {key:kind+':'+item,kind,id:item,projectId:null,projectName:null,state:'completed',phase:'finished',expiresAt:null,turnId:null,interactionId:null,safety:null,...over};};
const page=(items,next=null)=>({version:1,items,next});

test('accepts the current list and every current kind and phase',()=>{
 for(const kind of Object.keys(savedWorkKinds))assert.ok(client.readSavedWorkList(page([entry({kind})])),kind);
 for(const phase of client.savedWorkPhases)assert.ok(client.readSavedWorkList(page([entry({phase,expiresAt:['review','form','expired'].includes(phase)?'2026-10-04T01:02:03.000Z':null})])),phase);
 const project=id(),turn=id(),form=id();
 const value=page([entry({kind:'form',projectId:project,projectName:'Garden',state:'open',phase:'form',expiresAt:'2026-10-04 01:02:03',turnId:turn,interactionId:form})]);
 assert.deepEqual(client.readSavedWorkList(value),value);
 const full=sorted(30).map(item=>entry({id:item}));assert.ok(client.readSavedWorkList(page(full,full.at(-1).key)));
 assert.ok(client.readSavedWorkList(page(full.slice(1)),full[0].key),'Keys follow the requested cursor');
});
test('refuses stale, extra, unordered or inconsistent responses',()=>{
 const one=entry(),full=sorted(30).map(item=>entry({id:item}));
 for(const bad of [null,[],{},{version:2,items:[],next:null},{...page([]),extra:true},page([{...one,code:'PRIVATE'}]),page([{...one,key:'chat:'+id()}]),page([entry({kind:'cms'})]),page([entry({id:'NOT-AN-ID'})]),
  page([entry({phase:'approved'})]),page([entry({state:''})]),page([entry({projectId:id()})]),page([entry({projectName:'Orphan'})]),page([entry({turnId:'https://example.invalid'})]),page([entry({interactionId:'x'})]),
  page([entry({safety:'website'})]),page([entry({safety:'dns',projectId:id(),projectName:'Garden'})]),page([entry({expiresAt:'2026-10-04T00:00:00Z'})]),page([entry({phase:'review',expiresAt:'soon'})]),
  page([one,one]),page([full[1],full[0]]),page(full.slice(0,29),full[28].key),page(full,full[0].key),page(full.concat(entry())),page([one],one.key)])
  assert.equal(client.readSavedWorkList(bad),null,JSON.stringify(bad)?.slice(0,120));
 assert.equal(client.readSavedWorkList(page([full[0]]),full[1].key),null,'A page never repeats or rewinds past its cursor');
});
test('phase text is truthful; uncertain and photo states never read as success or clearance',()=>{
 for(const phase of client.savedWorkPhases){const s=client.savedWorkStatus({kind:'chat',phase});assert.ok(s.label&&s.detail);}
 const uncertain=client.savedWorkStatus({kind:'backup',phase:'uncertain'});assert.match(uncertain.label,/not known/i);assert.match(uncertain.detail,/not confirmed/i);assert.doesNotMatch(uncertain.label,/finished|complete|success|done/i);
 for(const phase of ['uncertain','attention','working','review']){const s=client.savedWorkStatus({kind:'photo',phase});assert.doesNotMatch(s.label,/approved|^cleared|\bsafe\b/i);if(phase!=='working'&&phase!=='review')assert.match(s.label+s.detail,/not cleared/i);}
 assert.match(client.savedWorkStatus({kind:'photo',phase:'finished'}).label,/current safety check/);
 assert.match(client.savedWorkStatus({kind:'chat',phase:'finished'}).detail,/not a live status/);
 assert.match(client.savedWorkStatus({kind:'website',phase:'review'}).detail,/does not approve/);
 assert.equal(client.savedWorkExpiry({phase:'finished',expiresAt:null}),null);
 assert.match(client.savedWorkExpiry({phase:'review',expiresAt:'2026-10-04T01:02:03.000Z'},'en-US'),/^Review by /);
 assert.match(client.savedWorkExpiry({phase:'form',expiresAt:'2026-10-04T01:02:03.000Z'},'en-US'),/^Answer by /);
 assert.match(client.savedWorkExpiry({phase:'expired',expiresAt:'2026-10-04T01:02:03.000Z'},'en-US'),/^Expired /);
 assert.equal(client.savedWorkTime('2026-10-04 01:02:03').toISOString(),'2026-10-04T01:02:03.000Z','Zone-less SQLite times are UTC');
});
test('destinations reuse exact current locators and never infer one',()=>{
 const project=id(),turn=id(),form=id(),item=id();
 assert.deepEqual(client.savedWorkDestination(entry({kind:'website',id:item,projectId:project,projectName:'Garden',turnId:turn,safety:'website'})).search,{project,review:item});
 assert.deepEqual(client.savedWorkDestination(entry({kind:'backend',id:item,projectId:project,projectName:'Garden',safety:'backend'})).search,{project,service:'backend',review:item});
 assert.deepEqual(client.savedWorkDestination(entry({kind:'application',id:item,projectId:project,projectName:'Garden',safety:'application'})).search,{project,service:'application',review:item});
 assert.deepEqual(client.savedWorkDestination(entry({kind:'form',turnId:turn,interactionId:form})),{kind:'interaction',label:'Open saved form in Chat',search:{signup:false,interaction:form}});
 assert.deepEqual(client.savedWorkDestination(entry({turnId:turn})),{kind:'turn',label:'Open message in Chat',search:{signup:false,turn}});
 assert.equal(client.savedWorkDestination(entry({kind:'checkout',projectId:project,projectName:'Garden'})),null,'No project or page is selected for an unlinked item');
 assert.equal(client.savedWorkPath('open',null,null),'/workspace/saved-work?view=open');
 assert.equal(client.savedWorkPath('all','photo','photo:'+item),'/workspace/saved-work?view=all&kind=photo&after=photo%3A'+item);
});
test('saved Chat turn reader accepts the schema uncertain status without implying success',()=>{
 const turnId=id(),turn=status=>({version:1,turn:{id:turnId,revision:3,user_text:'Hello',assistant_text:'',status}});
 for(const status of ['pending','completed','failed','uncertain'])assert.equal(client.readSavedTurn(turn(status),turnId).status,status);
 for(const bad of [turn('approved'),{...turn('completed'),version:2},{version:1,turn:{...turn('completed').turn,revision:0}},{version:1,turn:{...turn('completed').turn,user_text:null}},{version:1}])assert.equal(client.readSavedTurn(bad,turnId),null);
 assert.equal(client.readSavedTurn(turn('completed'),id()),null,'Another turn ID is refused');
 assert.match(client.savedTurnFallback('uncertain'),/could not confirm/);assert.doesNotMatch(client.savedTurnFallback('uncertain'),/completed|success/i);
 assert.match(client.savedTurnFallback('pending'),/working/);assert.match(client.savedTurnFallback('failed'),/No saved reply/);
});

// Tab-local recovery summary over the existing validated stores (handoff step 5).
const local=await import('data:text/javascript;base64,'+Buffer.from((await build({entryPoints:['frontend/src/lib/local-recovery.ts'],bundle:true,format:'esm',write:false})).outputFiles[0].text).toString('base64'));
const nav=await import('data:text/javascript;base64,'+Buffer.from((await build({entryPoints:['frontend/src/lib/workspace-navigation.ts'],bundle:true,format:'esm',write:false})).outputFiles[0].text).toString('base64'));
const {jsonDigest}=await import('data:text/javascript;base64,'+Buffer.from((await build({entryPoints:['src/project-specification/v2/json.ts'],bundle:true,format:'esm',write:false})).outputFiles[0].text).toString('base64'));
const memory=(seed={})=>{const map=new Map(Object.entries(seed));return {map,getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};};
const digest='a'.repeat(64),now=Date.parse('2026-10-04T00:00:00Z');
const seeded=(owner,{project=id(),chatRequest=id(),form=id(),pendingForm=id(),requestId=id(),photo=id(),turn=id()}={})=>({ids:{project,chatRequest,form,pendingForm,requestId,photo,turn},store:memory({
 'whumpo.chat-recovery':JSON.stringify({version:2,owner,updatedAt:now-1000,draft:'PRIVATE DRAFT TEXT',pending:{id:chatRequest,revision:4,content:'PRIVATE SENT TEXT'}}),
 'whumpo.chat-forms.v1':JSON.stringify({version:1,owner,forms:{[form]:{definitionDigest:digest,answerRevision:0,answers:{name:'PRIVATE ANSWER'},updatedAt:now-1000,dismissed:false,pending:null},[pendingForm]:{definitionDigest:digest,answerRevision:2,answers:null,updatedAt:now-1000,dismissed:false,pending:{version:1,requestId,interactionId:pendingForm,definitionDigest:digest,expectedAnswerRevision:2,operation:'submit',answers:{name:'PRIVATE SUBMITTED'}}}}}),
 'whumpo.photo-upload-recovery':JSON.stringify({version:1,owner,uploads:[{id:photo,projectId:project,name:'Front garden',digest:'b'.repeat(64),size:2048,width:800,height:600,handoff:null}]}),
 'whumpo.chat-location':JSON.stringify({version:2,owner,kind:'turn',id:turn,updatedAt:now-1000}),
})});
test('local summary lists each existing store without copying text, answers or bytes',()=>{
 const owner=id(),{store,ids}=seeded(owner),before=JSON.stringify([...store.map]);
 const {items,failed}=local.readLocalRecovery(store,owner,now);assert.equal(failed,false);
 assert.deepEqual(items.map(i=>i.kind).sort(),['chat-draft','chat-request','form-draft','form-request','location','photo']);
 assert.equal(JSON.stringify([...store.map]),before,'Reading changes no store');
 const summary=JSON.stringify(items.map(i=>({...i,request:undefined})));for(const secret of ['PRIVATE DRAFT TEXT','PRIVATE ANSWER','PRIVATE SUBMITTED'])assert(!summary.includes(secret),secret);
 for(const item of items){const copy=local.localRecoveryCopy(item,null);for(const secret of ['PRIVATE'])assert(!JSON.stringify(copy).includes(secret));}
 assert.equal(local.localRecoveryCopy(items.find(i=>i.kind==='chat-draft'),null).label,'Unsaved on this device');
 assert.equal(local.localRecoveryCopy(items.find(i=>i.kind==='form-draft'),null).label,'Unsaved on this device');
 assert.ok(['chat-request','form-request','photo'].every(kind=>local.localRecoveryNeedsCheck(items.find(i=>i.kind===kind))));
 assert.ok(['chat-draft','form-draft','location'].every(kind=>!local.localRecoveryNeedsCheck(items.find(i=>i.kind===kind))));
 assert.deepEqual(local.localRecoveryDestination(items.find(i=>i.kind==='form-request')).search,{signup:false,interaction:ids.pendingForm});
 assert.deepEqual(local.localRecoveryDestination(items.find(i=>i.kind==='form-draft')).search,{signup:false,interaction:ids.form});
 assert.deepEqual(local.localRecoveryDestination(items.find(i=>i.kind==='photo')),{kind:'photos',label:'Open Photos for this project',search:{project:ids.project}});
 assert.deepEqual(local.localRecoveryDestination(items.find(i=>i.kind==='location')).search,{signup:false,turn:ids.turn});
 assert.deepEqual(local.localRecoveryDestination(items.find(i=>i.kind==='chat-request')).search,{signup:false},'Chat restores and offers the same-ID retry');
});
test('another account, stale versions and expired drafts are not listed',()=>{
 const owner=id(),{store}=seeded(owner);
 const other=local.readLocalRecovery(store,id(),now);assert.deepEqual(other.items,[]);
 assert.equal(store.map.has('whumpo.chat-recovery'),false);assert.equal(store.map.has('whumpo.chat-forms.v1'),false);assert.equal(store.map.has('whumpo.photo-upload-recovery'),false);assert.equal(store.map.has('whumpo.chat-location'),false);
 const late=seeded(owner),later=local.readLocalRecovery(late.store,owner,now+8*24*60*60*1000);
 assert.deepEqual(later.items.map(i=>i.kind).sort(),['chat-request','form-request','photo'],'Unresolved requests outlive draft/locator expiry; drafts do not');
 const stale=memory({'whumpo.chat-recovery':JSON.stringify({version:1,owner,draft:'x'})});assert.deepEqual(local.readLocalRecovery(stale,owner,now).items,[]);
 const broken=memory({'whumpo.photo-upload-recovery':'{"version":0}'});assert.equal(local.readLocalRecovery(broken,owner,now).failed,true,'Unreadable photo recovery is reported, not hidden');
});
for(const [name,fn] of Object.entries({
 'Chat request checks distinguish absent, confirmed and different records':async()=>{
  const request={id:id(),revision:4,content:'Hello'},turn=over=>({id:request.id,revision:5,user_text:'Hello',action_json:null,assistant_text:'',status:'completed',...over});
  assert.deepEqual(await local.checkChatRequest(request,async()=>null),{state:'absent'});
  assert.deepEqual(await local.checkChatRequest(request,async()=>turn()),{state:'confirmed',detail:'completed'});
  assert.deepEqual(await local.checkChatRequest(request,async()=>turn({status:'uncertain'})),{state:'confirmed',detail:'uncertain'});
  assert.deepEqual(await local.checkChatRequest(request,async()=>turn({user_text:'Other'})),{state:'different'});
  await assert.rejects(local.checkChatRequest(request,async()=>{throw Error('offline');}));
  const item={key:'chat-request:'+request.id,kind:'chat-request',request};
  assert.equal(local.localRecoveryCopy(item,{state:'absent'}).label,'Not found on the server');assert.match(local.localRecoveryCopy(item,{state:'absent'}).detail,/does not prove/);
  assert.equal(local.localRecoveryCopy(item,{state:'confirmed',detail:'completed'}).label,'Saved receipt confirmed');
  assert.doesNotMatch(local.localRecoveryCopy(item,{state:'confirmed',detail:'uncertain'}).detail,/finished|success/i);
  assert.match(local.localRecoveryCopy(item,'error').detail,/Nothing is sent again automatically/);
 },
 'form receipt checks require the exact request digest':async()=>{
  const request={version:1,requestId:id(),interactionId:id(),definitionDigest:digest,expectedAnswerRevision:2,operation:'submit',answers:{name:'A'}};
  const receipt={version:1,requestId:request.requestId,interactionId:request.interactionId,operation:'submit',answerRevision:3,requestDigest:await jsonDigest(request,32768),createdAt:new Date().toISOString()};
  assert.deepEqual(await local.checkFormRequest(request,async()=>null),{state:'absent'});
  assert.deepEqual(await local.checkFormRequest(request,async()=>receipt),{state:'confirmed',detail:'saved'});
  assert.deepEqual(await local.checkFormRequest(request,async()=>({...receipt,requestDigest:'c'.repeat(64)})),{state:'different'});
 },
 'photo checks never imply clearance':async()=>{
  const upload={id:id(),projectId:id(),name:'Front',digest:'b'.repeat(64),size:10,width:10,height:10,handoff:{interactionId:id(),definitionDigest:digest}};
  const item={key:'photo:'+upload.id,kind:'photo',upload};
  assert.deepEqual(local.checkPhotoUpload(upload,{version:1,photo:null,closedHandoff:null}),{state:'absent'});
  assert.deepEqual(local.checkPhotoUpload(upload,{version:1,photo:null,closedHandoff:upload.handoff}),{state:'closed'});
  assert.deepEqual(local.checkPhotoUpload(upload,{version:1,photo:null,closedHandoff:{interactionId:id(),definitionDigest:digest}}),{state:'different'});
  assert.deepEqual(local.checkPhotoUpload(upload,{version:1,photo:{...upload,status:'pending',safetyStatus:'pending'},closedHandoff:null}),{state:'started'});
  assert.deepEqual(local.checkPhotoUpload(upload,{version:1,photo:{...upload,size:11,status:'ready',safetyStatus:'approved'},closedHandoff:null}),{state:'different'});
  for(const safety of ['pending','blocked']){const check=local.checkPhotoUpload(upload,{version:1,photo:{...upload,status:'ready',safetyStatus:safety},closedHandoff:null});assert.equal(check.state,'confirmed');assert.match(local.localRecoveryCopy(item,check).detail,/not cleared/);}
  assert.match(local.localRecoveryCopy(item,local.checkPhotoUpload(upload,{version:1,photo:{...upload,status:'ready',safetyStatus:'approved'},closedHandoff:null})).detail,/current safety check/);
  assert.equal(local.localRecoveryCopy(item,null).title,'Photo upload from this tab: Front');
 },
}))try{await fn();cases++;}catch(error){console.error(name);throw error;}
test('selected project locator: strict, current-owner list only, never inferred',()=>{
 const owned=id(),other=id(),projects=[{id:owned}];
 assert.deepEqual(nav.selectedProject('',projects),{project:'',stale:false});
 assert.deepEqual(nav.selectedProject('?project='+owned,projects),{project:owned,stale:false});
 assert.deepEqual(nav.selectedProject('?project='+owned,undefined),{project:'',stale:false},'Waits for the current owned-project read');
 for(const search of ['?project='+other,'?project='+owned+'&project='+owned,'?project=../settings','?project='+owned.toUpperCase()])assert.deepEqual(nav.selectedProject(search,projects),{project:'',stale:true},search);
 assert.deepEqual(nav.selectedProject('?project='+owned,[]),{project:'',stale:true},'An account change empties the selection');
});
console.log(`Saved-work client passed ${cases} groups: strict current list/turn readers, ordered cursor pages, truthful uncertain/photo/expiry text, exact existing destinations, tab-local recovery summary/checks without copied text or answers, and the strict current-owner project locator. Offline; no network or browser.`);
