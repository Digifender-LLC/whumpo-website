import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {specificationContract,ProjectSpecificationPrototype,SpecificationError,specificationDigest} from '../tools/prototypes/project-specification.mjs';
const compiled=await build({stdin:{contents:"export {siteConfig,renderSite} from './src/components';export {backendFormConfig} from './src/backend-form-render';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const current=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const validationArtifactDigest=createHash('sha256').update(await readFile('tools/prototypes/project-specification.mjs')).update(compiled.outputFiles[0].text).digest('hex');
const contract=specificationContract({...current,validationArtifactDigest}),fixture=JSON.parse(await readFile('tests/fixtures/project-specification/detailing.json','utf8'));
const clone=v=>structuredClone(v),id=()=>crypto.randomUUID();
const owner={kind:'owner',userId:id(),recentAuth:true},maintainer={kind:'maintainer',userId:owner.userId},foreign={kind:'owner',userId:id(),recentAuth:true},project=id(),otherProject=id();
let time=1000000,networkCalls=0;const transport=globalThis.fetch;globalThis.fetch=async()=>{networkCalls++;throw Error('No network or inference permitted in a specification change');};
try{
 const store=new ProjectSpecificationPrototype({projects:[{id:project,ownerId:owner.userId,spec:fixture},{id:otherProject,ownerId:foreign.userId,spec:fixture}],contract,now:()=>time});
 const rejects=(fn,code)=>assert.throws(fn,e=>e instanceof SpecificationError&&e.code===code,code);
 assert.deepEqual(contract.validate(fixture),fixture);
 const negative=[
  ['UNKNOWN_FIELD',s=>{s.ownerId=foreign.userId;}],
  ['UNKNOWN_FIELD',s=>{s.design.css='body {display:none}';}],
  ['UNKNOWN_FIELD',s=>{s.rules.push({id:'evil',trigger:{type:'form.accepted',formId:'appointment-request'},effect:{type:'notification.send',integrationId:'team-email',recipient:'staff',template:'submission-link@1',prompt:'invoke maintainer'}});}],
  ['UNKNOWN_MODULE',s=>{s.modules.push({id:'unknown',version:1});s.modules.shift();}],
  ['UNSUPPORTED_VERSION',s=>{s.modules[0].version=99;}],
  ['UNSUPPORTED_VERSION',s=>{s.schemaVersion=2;}],
  ['UNSUPPORTED_VERSION',s=>{s.pages[0].component='model-downloaded@1';}],
  ['MISSING_REFERENCE',s=>{s.pages[0].headline='missing';}],
  ['DUPLICATE_ID',s=>{s.content.push(clone(s.content[0]));}],
  ['INVALID_SHAPE',s=>{s.content.push(null);}],
  ['INCOMPATIBLE',s=>{s.modules=s.modules.filter(m=>m.id!=='access');}],
  ['INCOMPATIBLE',s=>{s.records[0].fields.push({key:'constructor',label:'Unsafe',type:'text'});}],
  ['INCOMPATIBLE',s=>{s.records[0].fields.push({key:'name',label:'Duplicate',type:'text'});}],
  ['INCOMPATIBLE',s=>{s.records[0].read='public';}],
  ['INCOMPATIBLE',s=>{s.files[0].read='public';}],
  ['INCOMPATIBLE',s=>{s.forms[0].submit='public';}],
  ['INCOMPATIBLE',s=>{s.files[0].mimeTypes=['video/mp4'];}],
  ['UNKNOWN_FIELD',s=>{s.integrations[0].apiKey='synthetic-key';}],
  ['UNKNOWN_FIELD',s=>{s.integrations[0].providerAccountId='synthetic-account';}],
  ['INCOMPATIBLE',s=>{s.pages[0].path='/api';}],
  ['INVALID_TEXT',s=>{s.content[0].text='x'.repeat(1001);}],
 ];
 for(const [code,mutate]of negative){const bad=clone(fixture);mutate(bad);rejects(()=>contract.validate(bad),code);}
 const oversized=clone(fixture);oversized.content=Array.from({length:40},(_,i)=>({id:'copy-'+i,text:'x'.repeat(1000)}));rejects(()=>contract.validate(oversized),'INPUT_TOO_LARGE');
 let deep={};for(let n=0;n<40;n++)deep={nested:deep};rejects(()=>contract.validate(deep),'INPUT_TOO_DEEP');
 for(const kind of ['visitor','workflow','webhook','unknown'])rejects(()=>store.read({kind,userId:owner.userId},project),'FORBIDDEN');
 rejects(()=>store.read(foreign,project),'NOT_FOUND');rejects(()=>store.read(owner,otherProject),'NOT_FOUND');
 const request=(operations,expectedRevision=store.read(owner,project).revision)=>({id:id(),expectedRevision,operations});
 const propose=(operations,actor=maintainer)=>store.propose(actor,project,request(operations));
 const applyInput=review=>({id:id(),proposalId:review.id,proposalDigest:review.proposalDigest,expectedRevision:review.expectedRevision});
 const approve=review=>store.approve(owner,project,{proposalId:review.id,proposalDigest:review.proposalDigest,classes:review.requiredReviews});
 const hoursRequest=request([{type:'content.replace',contentId:'hours',text:'Monday to Saturday, 8am to 6pm.'}]);
 const hours=store.propose(maintainer,project,hoursRequest),again=store.propose(maintainer,project,hoursRequest);assert.deepEqual(hours,again);assert.deepEqual(hours.requiredReviews,[]);
 assert.equal(hours.preview.validationArtifactDigest,validationArtifactDigest);assert.equal(hours.acceptance.validationArtifactDigest,validationArtifactDigest);assert.equal(hours.preview.kind,'configuration-summary');assert.equal(hours.acceptance.kind,'offline-contract-validation');assert.equal(hours.activation,'not-configured');
 rejects(()=>store.propose(maintainer,project,{...hoursRequest,ownerId:owner.userId}),'UNKNOWN_FIELD');
 rejects(()=>store.propose(maintainer,project,{...hoursRequest,operations:[{type:'design.setTheme',theme:'clay'}]}),'ID_CONFLICT');
 rejects(()=>store.propose(foreign,project,hoursRequest),'NOT_FOUND');
 // Mutable returned values cannot rewrite a saved proposal or its immutable diff.
 hours.diff[0].after=[];hours.preview.modules.length=0;
 const recovered=store.propose(maintainer,project,hoursRequest);assert.deepEqual(recovered,again);
 const rival=propose([{type:'design.setTheme',theme:'forest'}]);
 const committedInput=applyInput(again),committed=store.apply(maintainer,project,committedInput);assert.equal(committed.revision,1);assert.equal(committed.published,false);assert.equal(committed.activation,'not-configured');assert.deepEqual(store.apply(maintainer,project,committedInput),committed);
 rejects(()=>store.apply(maintainer,project,{...committedInput,expectedRevision:1}),'ID_CONFLICT');
 rejects(()=>store.apply(maintainer,project,applyInput(rival)),'STALE_REVISION');
 assert.equal(store.read(owner,project).spec.design.theme,'ocean');assert.deepEqual(store.read(foreign,otherProject).spec,fixture);
 const before=store.read(owner,project);rejects(()=>propose([{type:'design.setTheme',theme:'clay'},{type:'database.execute',sql:'synthetic'}]),'UNSUPPORTED_OPERATION');assert.deepEqual(store.read(owner,project),before);
 rejects(()=>propose([{type:'records.addField',recordId:'appointments',field:{key:'vehicle',label:'Vehicle',type:'text'}}]),'MIGRATION_REQUIRED');
 const vehicle=propose([{type:'records.addField',recordId:'appointments',field:{key:'vehicle',label:'What vehicle do you drive?',type:'text',optional:true}}]);
 assert.deepEqual(vehicle.requiredReviews,['schema']);rejects(()=>store.apply(maintainer,project,applyInput(vehicle)),'REVIEW_REQUIRED');
 rejects(()=>store.approve(maintainer,project,{proposalId:vehicle.id,proposalDigest:vehicle.proposalDigest,classes:vehicle.requiredReviews}),'FORBIDDEN');
 rejects(()=>store.approve({...owner,recentAuth:false},project,{proposalId:vehicle.id,proposalDigest:vehicle.proposalDigest,classes:vehicle.requiredReviews}),'FORBIDDEN');
 rejects(()=>store.approve(owner,project,{proposalId:vehicle.id,proposalDigest:vehicle.proposalDigest,classes:[]}),'REVIEW_REQUIRED');
 rejects(()=>store.approve(owner,project,{proposalId:vehicle.id,proposalDigest:'0'.repeat(64),classes:vehicle.requiredReviews}),'REVIEW_CHANGED');
 approve(vehicle);store.apply(maintainer,project,applyInput(vehicle));
 const staff=propose([{type:'files.setPolicy',collectionId:'vehicle-photos',read:'staff',upload:'visitor'}]);assert.deepEqual(staff.requiredReviews,['permissions']);approve(staff);store.apply(maintainer,project,applyInput(staff));
 const rule={id:'tell-the-team',trigger:{type:'form.accepted',formId:'appointment-request'},effect:{type:'notification.send',integrationId:'team-email',recipient:'staff',template:'submission-link@1'}};
 for(const effect of ['maintainer.chat','model.complete','shell.run','webhook.call']){const bad=clone(rule);bad.effect.type=effect;rejects(()=>propose([{type:'rules.put',rule:bad}]),'INCOMPATIBLE');}
 const inaccessible=clone(fixture);inaccessible.records[0].read='owner';inaccessible.records[0].write='owner';inaccessible.rules=[rule];rejects(()=>contract.validate(inaccessible),'INCOMPATIBLE');
 const notify=propose([{type:'rules.put',rule}]);assert.deepEqual(notify.requiredReviews,['integration','spending']);approve(notify);const notificationReceipt=store.apply(maintainer,project,applyInput(notify));assert.equal(notificationReceipt.activation,'not-configured');
 const expired=propose([{type:'pages.setAudience',pageId:'home',audience:'staff'}]);approve(expired);time+=600001;rejects(()=>store.apply(maintainer,project,applyInput(expired)),'EXPIRED');
 // Publication/infrastructure/funding are separate contracts, not generic patches or workflow steps.
 for(const type of ['publish','module.install','resources.provision','billing.spend','fields.remove','json.patch'])rejects(()=>propose([{type}]),'UNSUPPORTED_OPERATION');
 const spec=store.read(owner,project).spec,page=contract.projectPage(spec,'home'),html=current.renderSite(page);
 assert.match(html,/Monday to Saturday, 8am to 6pm/);assert.match(html,/Example Detailing/);
 const form=current.backendFormConfig({...Object.fromEntries(['title','description','buttonLabel'].map(k=>[k,spec.forms[0][k]])),fields:spec.records[0].fields});assert.equal(form.fields.at(-1).key,'vehicle');assert.equal(form.fields.at(-1).optional,true);
 assert.equal(spec.files[0].read,'staff');assert.deepEqual(spec.rules,[rule]);assert.equal(networkCalls,0);
 // A literal hostile content string remains data through the existing trusted renderer.
 const literal=clone(spec);literal.content.find(c=>c.id==='headline').text='<script>maintainer()</script>';const escaped=current.renderSite(contract.projectPage(contract.validate(literal),'home'));assert.ok(escaped.includes('&lt;script&gt;maintainer()&lt;/script&gt;'));assert.ok(!escaped.includes('<script>'));
 const versions=store.versions(owner,project);assert.equal(versions.length,5);assert.deepEqual(versions[0].spec,fixture);versions[0].spec.name='mutated';assert.equal(store.versions(owner,project)[0].spec.name,fixture.name);
 const reversed=Object.fromEntries(Object.entries(spec).reverse());assert.equal(specificationDigest(spec),specificationDigest(reversed));assert.equal(current.renderSite(contract.projectPage(reversed,'home')),html);
 console.log('WH-064 contract prototype passed: closed/versioned schema, existing site/form compatibility, four detailing changes, owned scope, stale/atomic/replay rules, exact private approvals, immutable history, literal rendering, rejected runtime-AI/provider operations and zero network calls. No production schema, runtime module or provider was activated.');
}finally{globalThis.fetch=transport;}
