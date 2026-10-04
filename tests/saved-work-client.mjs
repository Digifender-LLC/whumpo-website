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
console.log(`Saved-work client passed ${cases} groups: strict current list/turn readers, ordered cursor pages, truthful uncertain/photo/expiry text and exact existing destinations. Offline; no network or browser.`);
