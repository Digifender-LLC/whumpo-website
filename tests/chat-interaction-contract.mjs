import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
Error.stackTraceLimit=0;
const protocolBuild=await build({entryPoints:['src/chat-interactions/protocol.ts'],bundle:true,format:'esm',platform:'neutral',write:false});
const {bindings,bounds,validateDefinition,validateAnswers,contentRequest,sealDefinition,verifyEnvelope,validateMutation,requireCurrentClient}=await import('data:text/javascript;base64,'+Buffer.from(protocolBuild.outputFiles[0].contents).toString('base64'));

// Shared Worker protocol evidence. No D1, browser, inference, provider or real account.
const fixture=JSON.parse(await readFile('tests/fixtures/chat-interactions.json','utf8'));
const copy=x=>structuredClone(x),id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const answers={headline:'Care for your car, at your door.',services:'Interior refresh. Exterior detail. Ask for a quote.'};
const custom={area:'Example town',mobile:false,sizes:['car']};
const envelope=(definition=fixture.contentChange)=>({version:1,id:id(1),scope:{accountId:id(2),actorId:id(2),conversationId:id(3),projectId:['project-select@1','project-brief@1'].includes(definition.template)?null:id(4),taskId:id(5),originTurnId:id(6)},createdAt:'2026-10-01T12:00:00.000Z',expiresAt:'2026-10-08T12:00:00.000Z',definition:copy(definition)});
const client={versions:[1],fieldTypes:['text','long-text','choice','multi-choice','boolean','number','date','datetime','resource','attachment'],bindings:Object.keys(bindings)};
let count=0;
async function test(name,fn){try{await fn();count++;}catch(e){console.error('Failed:',name);throw e;}}
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code,code);
const rejectsAsync=(fn,code)=>assert.rejects(fn,e=>e.code===code,code);
async function invalid(name,mutate,code,key='contentChange'){await test(name,async()=>{const d=copy(fixture[key]);mutate(d);rejects(()=>validateDefinition(d),code);});}

for(const [name,d] of Object.entries(fixture))await test('valid '+name,()=>assert.deepEqual(validateDefinition(d),d));
await test('valid content/custom answers and no inferred defaults',async()=>{
  assert.deepEqual(validateAnswers(fixture.contentChange,answers),answers);
  assert.deepEqual(validateAnswers(fixture.custom,custom),custom);
  assert.deepEqual(validateAnswers(fixture.custom,{...custom,mobile:true,radius:30}),{...custom,mobile:true,radius:30});
  rejects(()=>validateAnswers(fixture.contentChange,{}),'REQUIRED');
});
await test('returns independent data',async()=>{const d=validateDefinition(fixture.contentChange);d.fields[0].label='different';assert.notEqual(d.fields[0].label,fixture.contentChange.fields[0].label);});
for(const [name,mutate,code] of [
  ['unknown envelope command',d=>d.command='/confirm anything','UNKNOWN_FIELD'],
  ['unsupported version',d=>d.version=2,'VERSION'],
  ['missing purpose',d=>delete d.summary,'MISSING_FIELD'],
  ['unknown template',d=>d.template='downloaded@1','TEMPLATE'],
  ['unknown field type',d=>d.fields[0].type='password','FIELD_TYPE'],
  ['raw HTML field',d=>d.fields[0].html='<b>bad</b>','UNKNOWN_FIELD'],
  ['arbitrary endpoint',d=>d.fields[0].binding='https://example.invalid','BINDING'],
  ['publish as continuation',d=>d.continuationBinding='site.publish@1','BINDING'],
  ['null conditional',d=>d.fields[0].when=null,'SHAPE'],
  ['unknown validation rule',d=>d.fields[0].constraints.regex='.*','UNKNOWN_FIELD'],
  ['field number coercion',d=>d.fields[0].constraints.maxLength='120','NUMBER'],
  ['duplicate field',d=>d.fields.push(copy(d.fields[0])),'DUPLICATE'],
  ['reserved field name',d=>d.fields[0].id='constructor','ID'],
  ['unknown source authority',d=>d.fields[0].source.ownerId=id(99),'UNKNOWN_FIELD'],
  ['mixed content revision',d=>d.fields[1].source.revision=4,'CONTENT_MAPPING'],
  ['duplicate content target',d=>d.fields[1].source.contentId='headline','DUPLICATE'],
  ['future conditional target',d=>d.fields[0].when={fieldId:'services',equals:true},'CONDITION'],
  ['invalid default',d=>d.fields[0].default.value=true,'TEXT'],
  ['oversized downstream content',d=>{d.fields[1].constraints.maxLength=2000;},'CONTENT_MAPPING'],
  ['unsupported display hint',d=>d.presentation='full-screen-script','PRESENTATION'],
  ['nested group',d=>d.fields[0].group={children:[]},'NUMBER'],
  ['too many fields',d=>d.fields=Array.from({length:13},(_,i)=>({...copy(d.fields[0]),id:'f'+i})),'LIST'],
  ['too many bytes',d=>d.summary='a'.repeat(bounds.definitionBytes),'BYTES'],
  ['nonfinite value',d=>d.fields[0].constraints.maxLength=Infinity,'NUMBER'],
])await invalid(name,mutate,code);
await invalid('no mapped source',d=>{delete d.fields[0].source;delete d.fields[0].default;},'CONTENT_MAPPING');
await invalid('invalid saved provenance',d=>delete d.fields[0].source,'PROVENANCE');
await invalid('too many choice options',d=>{d.fields[3].constraints.options=Array.from({length:13},(_,i)=>({id:'o'+i,label:'Option'}));},'LIST','custom');
await invalid('invalid conditional answer',d=>d.fields[2].when.equals='true','VALUE','custom');
await invalid('conditional chain',d=>{d.fields[1].when={fieldId:'area',equals:true};},'CONDITION','custom');
await invalid('unapproved attachment collection',d=>d.fields[4].constraints.collection='credentials','BINDING','custom');
await invalid('view action payload',d=>d.cards[0].action={type:'confirm'},'UNKNOWN_FIELD','view');
await invalid('unregistered read binding',d=>d.cards[0].binding='database.sql@1','BINDING','view');
await invalid('view cannot submit',d=>d.submitBinding='interaction.answers@1','TEMPLATE','view');
await invalid('wrong view component',d=>d.cards[0].display='preview','BINDING','view');
await invalid('unnecessary review identity',d=>d.cards[0].reviewId=id(9),'REFERENCE','view');
await invalid('changed maintained brief field',d=>d.fields[0].id='password','TEMPLATE','projectBrief');
await invalid('project selector cannot collect photos',d=>d.fields[0].constraints.collection='photos','TEMPLATE','projectSelection');
await invalid('retired project brief continuation rejected',d=>d.continuationBinding=null,'TEMPLATE','projectBrief');
await invalid('retired project selector continuation rejected',d=>d.continuationBinding=null,'TEMPLATE','projectSelection');
await test('resource negotiation and maintained choices',async()=>{
  const c={...client,bindings:client.bindings.filter(b=>b!=='owned.projects@1')};
  await rejectsAsync(async()=>await requireCurrentClient(await sealDefinition(envelope(fixture.projectSelection)),c),'CLIENT_UPDATE_REQUIRED');
  validateAnswers(fixture.projectSelection,{project:id(4)},{owned:{projects:[id(4)]}});
  validateAnswers(fixture.choice,{tone:'friendly'});
});
await test('nested malicious data rejected before schema walk',()=>{
  const d=copy(fixture.custom);let a=d.extra={};for(let i=0;i<12;i++)a=a.child={};rejects(()=>validateDefinition(d),'COMPLEXITY');
});
await test('large node count rejected',async()=>{const d=copy(fixture.custom);d.extra=Array(1025).fill(null);rejects(()=>validateDefinition(d),'COMPLEXITY');});
await test('unknown and hidden values rejected',async()=>{
  rejects(()=>validateAnswers(fixture.contentChange,{...answers,approve:true}),'UNKNOWN_FIELD');
  rejects(()=>validateAnswers(fixture.custom,{...custom,radius:0}),'HIDDEN_VALUE');
  rejects(()=>validateAnswers(fixture.custom,{...custom,mobile:true}),'REQUIRED');
});
await test('choice duplication and numerical coercion rejected',()=>{
  rejects(()=>validateAnswers(fixture.custom,{...custom,sizes:['car','car']}),'VALUE');
  rejects(()=>validateAnswers(fixture.custom,{...custom,mobile:true,radius:'30'}),'VALUE');
  rejects(()=>validateAnswers(fixture.custom,{...custom,mobile:true,radius:30.5}),'VALUE');
});
await test('owned fixture resolver and attachment shape',()=>{
  const a={...custom,photos:[id(8)]};assert.deepEqual(validateAnswers(fixture.custom,a,{owned:{photos:[id(8)]}}),a);
  rejects(()=>validateAnswers(fixture.custom,a,{owned:{photos:[]}}),'RESOURCE_UNAVAILABLE');
  rejects(()=>validateAnswers(fixture.custom,{...custom,photos:['https://example.invalid/file']}),'VALUE');
});
function single(type,constraints,required=true){return {...copy(fixture.custom),fields:[{id:'answer',type,label:'Answer',help:'',required,binding:'answer.value@1',constraints}]};}
await test('calendar dates and explicit zone instants',()=>{
  const date=single('date',{});assert.equal(validateAnswers(date,{answer:'2028-02-29'}).answer,'2028-02-29');
  rejects(()=>validateAnswers(date,{answer:'2026-02-29'}),'VALUE');
  rejects(()=>validateAnswers(date,{answer:'0000-01-01'}),'VALUE');
  const time=single('datetime',{zone:'America/Chicago'});validateAnswers(time,{answer:'2026-11-01T07:30:00.000Z'});
  rejects(()=>validateAnswers(time,{answer:'2026-11-01T01:30:00'}),'VALUE');
  rejects(()=>validateAnswers(time,{answer:'0000-01-01T00:00:00.000Z'}),'VALUE');
  rejects(()=>validateAnswers(time,{answer:'0001-01-01T00:00:00.000Z'}),'VALUE');
  rejects(()=>validateAnswers(single('datetime',{zone:'Pacific/Kiritimati'}),{answer:'9999-12-31T23:00:00.000Z'}),'VALUE');
  rejects(()=>validateDefinition(single('datetime',{zone:'imaginary-zone'})),'ZONE');
});
await test('remaining value types, optional empty and literal text',()=>{
  validateAnswers(single('resource',{collection:'projects',multiple:false,maxItems:1}),{answer:id(4)},{owned:{projects:[id(4)]}});
  validateAnswers(single('choice',{options:[{id:'small',label:'Small'}]}),{answer:'small'});
  rejects(()=>validateAnswers(single('choice',{options:[{id:'small',label:'Small'}]}),{answer:'invented'}),'VALUE');
  assert.equal(validateAnswers(single('text',{maxLength:80}),{answer:'<script>plain customer text</script>'}).answer,'<script>plain customer text</script>');
  validateAnswers(single('text',{maxLength:80},false),{answer:''});
  rejects(()=>validateAnswers(single('text',{maxLength:80}),{answer:''}),'TEXT');
});
await test('canonical digest and independent immutable association',async()=>{
  const a=envelope(),b=Object.fromEntries(Object.entries(a).reverse());
  assert.equal((await sealDefinition(a)).definitionDigest,(await sealDefinition(b)).definitionDigest);
  const s=await sealDefinition(a);assert.deepEqual(await verifyEnvelope(s),s);
  for(const mutate of [x=>x.scope.projectId=id(99),x=>x.scope.actorId=id(99),x=>x.definition.fields.forEach(f=>f.source.revision=9),x=>x.expiresAt='2026-10-07T12:00:00.000Z']){
    const altered=copy(s);mutate(altered);await rejectsAsync(async()=>await verifyEnvelope(altered),'DIGEST');
  }
});
await test('issuance rejects shape, missing project, excessive expiry and forged digest',async()=>{
  const a=envelope();a.scope.projectId=null;await rejectsAsync(async()=>await sealDefinition(a),'PROJECT');
  const b=envelope();b.expiresAt='2026-10-09T12:00:00.000Z';await rejectsAsync(async()=>await sealDefinition(b),'TIME');
  const c=envelope();c.id=[id(1)];await rejectsAsync(async()=>await sealDefinition(c),'ID');
  const d=await sealDefinition(envelope());d.action={type:'confirm'};await rejectsAsync(async()=>await verifyEnvelope(d),'UNKNOWN_FIELD');
  const e=await sealDefinition(envelope());e.definitionDigest='a'.repeat(64);await rejectsAsync(async()=>await verifyEnvelope(e),'DIGEST');
});
await test('only the current complete client contract is accepted',async()=>{
  const e=await sealDefinition(envelope());assert.deepEqual(await requireCurrentClient(e,client),{canSubmit:true,canApprove:false});
  for(const c of [{...client,versions:[]},{...client,versions:[1,2]},{...client,versions:[2]},{...client,bindings:[]},{...client,fieldTypes:['text']}])await rejectsAsync(async()=>await requireCurrentClient(e,c),'CLIENT_UPDATE_REQUIRED');
  assert.equal((await requireCurrentClient(await sealDefinition(envelope(fixture.view)),client)).canSubmit,false);
});
await test('registered comparison and preview reference bindings',()=>{
  const d=copy(fixture.view);d.cards=[{id:'preview',binding:'site.preview@1',display:'preview',limit:1,reviewId:id(9)},{id:'diff',binding:'site.comparison@1',display:'comparison',limit:1,reviewId:id(9)}];validateDefinition(d);
  d.cards[0].reviewId=null;rejects(()=>validateDefinition(d),'REFERENCE');
});
await test('exact submission identity/hash and corrections',async()=>{
  const e=await sealDefinition(envelope()),r={version:1,requestId:id(10),interactionId:e.id,definitionDigest:e.definitionDigest,expectedAnswerRevision:2,operation:'submit',answers};
  const first=await validateMutation(r,e);assert.equal(first.requestHash,(await validateMutation(copy(r),e)).requestHash);
  assert.notEqual(first.requestHash,(await validateMutation({...r,answers:{...answers,headline:'A correction'}},e)).requestHash);
  assert.notEqual(first.requestHash,(await validateMutation({...r,requestId:id(11)},e)).requestHash);
  // Hash mismatch lets the runtime reject same-ID/different-payload replay;
  // the shared protocol does not grant or persist authority by itself.
  await rejectsAsync(async()=>await validateMutation({...r,projectId:id(99)},e),'UNKNOWN_FIELD');
  await rejectsAsync(async()=>await validateMutation({...r,definitionDigest:'a'.repeat(64)},e),'DIGEST');
  await rejectsAsync(async()=>await validateMutation({...r,interactionId:id(99)},e),'REFERENCE');
  await rejectsAsync(async()=>await validateMutation({...r,operation:'approve'},e),'OPERATION');
  await rejectsAsync(async()=>await validateMutation({...r,expectedAnswerRevision:'2'},e),'NUMBER');
});
await test('partial draft and explicit cancellation remain distinct from submission',async()=>{
  const e=await sealDefinition(envelope()),r={version:1,requestId:id(10),interactionId:e.id,definitionDigest:e.definitionDigest,expectedAnswerRevision:0,operation:'save-draft',answers:{headline:answers.headline}};
  await validateMutation(r,e);await rejectsAsync(async()=>await validateMutation({...r,operation:'submit'},e),'REQUIRED');
  await validateMutation({...r,answers:{headline:''}},e);
  await rejectsAsync(async()=>await validateMutation({...r,operation:'submit',answers:{...answers,headline:''}},e),'TEXT');
  await rejectsAsync(async()=>await validateMutation({...r,operation:'cancel'},e),'UNKNOWN_FIELD');
  const {answers:_,...cancel}=r;await validateMutation({...cancel,operation:'cancel'},e);
});
await test('carried user defaults preserve incomplete drafts without weakening submission types',()=>{
  for(const value of ['', '   ']){
    const d=copy(fixture.contentChange);d.fields[0].default={value,provenance:'user'};
    assert.deepEqual(validateDefinition(d),d);validateAnswers(d,{headline:value},{partial:true});
    rejects(()=>validateAnswers(d,{...answers,headline:value}),'TEXT');
    for(const provenance of ['saved','suggested']){d.fields[0].default.provenance=provenance;rejects(()=>validateDefinition(d),'TEXT');}
  }
  const d=copy(fixture.projectSelection);d.fields[0].default={value:'',provenance:'user'};
  rejects(()=>validateDefinition(d),'VALUE');rejects(()=>validateAnswers(fixture.projectSelection,{project:''},{partial:true}),'VALUE');
  assert.deepEqual(validateAnswers(fixture.projectSelection,{},{partial:true}),{});
  rejects(()=>validateAnswers(fixture.projectSelection,{}),'REQUIRED');
});

await test('object hooks are rejected without execution',()=>{
  let executed=0;
  for(const mutate of [d=>Object.defineProperty(d,'summary',{enumerable:true,get(){executed++;return 'Injected';}}),d=>d.toJSON=()=>{executed++;return {};},d=>d[Symbol('hidden')]=true,d=>delete d.fields[0]]){
    const d=copy(fixture.contentChange);mutate(d);rejects(()=>validateDefinition(d),'SHAPE');
  }
  assert.equal(executed,0);
});
await test('answer errors identify the field without reflecting customer text',()=>{
  assert.throws(()=>validateAnswers(fixture.contentChange,{...answers,headline:''}),e=>e.code==='TEXT'&&e.fieldId==='headline'&&!e.message.includes(answers.services));
  assert.throws(()=>validateAnswers(fixture.custom,{...custom,radius:30}),e=>e.code==='HIDDEN_VALUE'&&e.fieldId==='radius');
});
await test('UTF-8 sizes and array ordering are exact',async()=>{
  const d=copy(fixture.custom);d.extra='☁'.repeat(9000);rejects(()=>validateDefinition(d),'BYTES');
  const first=envelope(),second=copy(first);second.definition.fields.reverse();
  assert.notEqual((await sealDefinition(first)).definitionDigest,(await sealDefinition(second)).definitionDigest);
  const composed=envelope(),decomposed=copy(composed);composed.definition.title='Café';decomposed.definition.title='Cafe\u0301';
  assert.notEqual((await sealDefinition(composed)).definitionDigest,(await sealDefinition(decomposed)).definitionDigest);
});
await test('unsupported or duplicated client capabilities require an update',async()=>{
  const e=await sealDefinition(envelope());
  for(const c of [{...client,bindings:[...client.bindings,'site.publish@1']},{...client,bindings:[...client.bindings,client.bindings[0]]},{...client,fieldTypes:[...client.fieldTypes,'password']},{...client,fieldTypes:[...client.fieldTypes,'text']}])await rejectsAsync(()=>requireCurrentClient(e,c),'CLIENT_UPDATE_REQUIRED');
});
await test('malformed nested values always return protocol errors',()=>{
  for(const key of ['fields','cards'])for(const value of [null,true,{},'wrong',[null],[false],[[]]]){
    const d=copy(fixture.contentChange);d[key]=value;assert.throws(()=>validateDefinition(d),e=>typeof e.code==='string');
  }
  for(const key of ['constraints','source','default','when'])for(const value of [null,0,'wrong',[],{}]){
    const d=copy(fixture.contentChange);d.fields[0][key]=value;assert.throws(()=>validateDefinition(d),e=>typeof e.code==='string');
  }
});

const result=await build({stdin:{contents:`export * from './src/project-specification/compiler'; export {chatControl} from './src/chat-controls'; export {parseLayout} from './src/workspace-dashboard'; export {launchFeatureCatalogue} from './src/plan-features';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'neutral',write:false});
const real=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
let calls=0;const fetch=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('Unexpected network in offline contract test');};
try {
  await test('binding feature/source names match maintained foundations',async()=>{
    for(const b of Object.values(bindings)){
      assert(real.launchFeatureCatalogue.features.some(f=>f.id===b.feature));
      if(b.source){const source=await readFile(b.source,'utf8');assert(source.includes('export async function '+b.handler+'('),b.handler);}
    }
  });
  await test('first slice compiles through actual content compiler without publication',async()=>{
    const all=JSON.parse(await readFile('tests/fixtures/project-specification/detailing.json','utf8'));
    const spec={...all,modules:[{id:'content',version:2}],records:[],forms:[],files:[],access:{roles:[]},integrations:[],rules:[]};
    const request=contentRequest(fixture.contentChange,answers,id(4));
    assert.deepEqual(request,{kind:'specification',operation:'change',projectId:id(4),expectedRevision:3,operations:[{type:'content.replace',contentId:'headline',text:answers.headline},{type:'content.replace',contentId:'services',text:answers.services}]});
    const change=await real.compileSpecificationChange(spec,request.operations,real.currentCompilerLock());
    assert.equal(change.compiled.manifest.published,false);assert.equal(change.compiled.manifest.activation,'not-configured');
    assert(change.compiled.artifacts[0].html.includes(answers.headline));assert(change.compiled.artifacts[0].html.includes(answers.services));
    for(const c of spec.content.filter(c=>!['headline','services'].includes(c.id)))assert.deepEqual(change.compiled.specification.content.find(n=>n.id===c.id),c);
    assert.deepEqual(change.compiled.specification.pages,spec.pages);
    await assert.rejects(()=>real.compileSpecificationChange(spec,[{type:'content.replace',contentId:'foreign-content',text:'Not in this site'}],real.currentCompilerLock()));
  });
  await test('only existing exact human review shape is admitted',async()=>{
    const action={type:'specificationApply',reviewId:id(9),proposalDigest:'a'.repeat(64),expectedRevision:3};
    assert.equal(real.chatControl(action).recentAuth,true);
    assert.equal(real.chatControl({...action,answers}),undefined);
    assert.equal(real.chatControl({type:'confirm',kind:'site',reviewId:id(9)}).action.kind,'site');
    assert.equal(real.chatControl({type:'interaction.answers@1',answers}),undefined);
  });
  await test('existing saved view stays in its bounded layout and shortcut registry',async()=>{
    const layout={version:1,dashboard:{version:1,projectId:null,widgets:['projects','usage','activity'],shortcuts:[]},tabs:[{id:'tab-detailing',label:'Detailing',view:{version:1,projectId:id(4),widgets:['traffic','activity'],shortcuts:['project','versions']}}]};
    assert.deepEqual(real.parseLayout(layout),layout);
    assert.throws(()=>real.parseLayout({...layout,tabs:[{...layout.tabs[0],view:{...layout.tabs[0].view,shortcuts:['publish']}}] }));
    assert.throws(()=>real.parseLayout({...layout,tabs:[{...layout.tabs[0],url:'https://example.invalid'}]}));
  });
}finally{globalThis.fetch=fetch;}
assert.equal(calls,0);
console.log(`Chat interaction contract: ${count} offline cases passed; actual compiler, review control and layout checks passed. No runtime storage/UI/device acceptance claimed.`);
