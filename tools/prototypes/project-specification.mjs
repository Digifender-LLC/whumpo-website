// WH-064 decision prototype. No Worker imports, network, provider, persistence or runtime dispatch.
// Supply the existing trusted site/form validators in the offline fixture harness.
import {createHash} from 'node:crypto';

export class SpecificationError extends Error {
 constructor(code,path='request'){super(`${code}: ${path}`);this.code=code;this.path=path;}
}
const fail=(code,path)=>{throw new SpecificationError(code,path);};
const check=(condition,code,path)=>{if(!condition)fail(code,path);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function shape(v,required,optional=[],path='request'){
 check(plain(v),'INVALID_SHAPE',path);
 check(Object.keys(v).every(k=>required.includes(k)||optional.includes(k)),'UNKNOWN_FIELD',path);
 check(required.every(k=>Object.hasOwn(v,k)),'MISSING_FIELD',path);
}
function text(v,max,path,empty=false){check(typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),'INVALID_TEXT',path);}
const identity=(v,path)=>check(typeof v==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(v)&&!['constructor','prototype','tojson'].includes(v),'INVALID_ID',path);
const uuid=(v,path)=>check(typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v),'INVALID_ID',path);
const integer=(v,min,max,path)=>check(Number.isSafeInteger(v)&&v>=min&&v<=max,'INVALID_NUMBER',path);
function list(v,max,path){check(Array.isArray(v)&&v.length<=max,'INVALID_LIST',path);}
function unique(rows,key,path){const seen=new Set();for(const row of rows){check(plain(row),'INVALID_SHAPE',path);check(!seen.has(row[key]),'DUPLICATE_ID',path);seen.add(row[key]);}}
function canonical(v,depth=0){
 check(depth<=32,'INPUT_TOO_DEEP','json');
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){check(Number.isFinite(v),'INVALID_NUMBER','json');return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(item=>canonical(item,depth+1)).join(',')+']';
 check(plain(v),'INVALID_SHAPE','json');return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
}
export const specificationDigest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const copy=v=>JSON.parse(canonical(v));
const same=(a,b)=>canonical(a)===canonical(b);
const moduleVersions=Object.freeze({content:1,records:1,files:1,access:1,notifications:1,automation:1});
const dependencies={records:['content'],files:['access'],notifications:['access'],automation:['records','notifications','access']};
const compiler='project-spec-contract@1';

/** A proposed schema, checked against current component/input contracts; no new service is enabled. */
export function specificationContract({siteConfig,backendFormConfig,validationArtifactDigest}){
 check(typeof validationArtifactDigest==='string'&&/^[0-9a-f]{64}$/.test(validationArtifactDigest),'INVALID_DIGEST','validationArtifactDigest');
 function validate(input){
  // Public JSON transport must enforce a streaming byte bound before parsing too.
  check(Buffer.byteLength(canonical(input))<=32768,'INPUT_TOO_LARGE','specification');
  const spec=copy(input);
  shape(spec,['schemaVersion','name','design','modules','content','pages','records','forms','files','access','integrations','rules']);
  check(spec.schemaVersion===1,'UNSUPPORTED_VERSION','schemaVersion');text(spec.name,100,'name');
  shape(spec.design,['theme'],[],'design');check(['ocean','clay','forest'].includes(spec.design.theme),'INCOMPATIBLE','design.theme');
  list(spec.modules,6,'modules');unique(spec.modules,'id','modules');
  const modules=new Set();
  for(const m of spec.modules){shape(m,['id','version'],[],'modules');identity(m.id,'modules.id');check(Object.hasOwn(moduleVersions,m.id),'UNKNOWN_MODULE','modules.id');check(m.version===moduleVersions[m.id],'UNSUPPORTED_VERSION','modules.version');modules.add(m.id);}
  check(modules.has('content'),'INCOMPATIBLE','modules.content');
  for(const [id,required] of Object.entries(dependencies))if(modules.has(id))check(required.every(k=>modules.has(k)),'INCOMPATIBLE','modules.dependencies');
  const requireModule=(id,rows)=>check(!rows.length||modules.has(id),'INCOMPATIBLE',id);
  list(spec.content,40,'content');unique(spec.content,'id','content');
  for(const c of spec.content){shape(c,['id','text'],[],'content');identity(c.id,'content.id');text(c.text,1000,'content.text',true);}
  const content=new Map(spec.content.map(c=>[c.id,c.text]));
  function value(id){identity(id,'content.reference');check(content.has(id),'MISSING_REFERENCE','content');return content.get(id);}
  list(spec.pages,4,'pages');check(spec.pages.length>0,'INVALID_LIST','pages');unique(spec.pages,'id','pages');unique(spec.pages,'path','pages');
  for(const p of spec.pages){
   shape(p,['id','path','component','audience','headline','description','aboutTitle','aboutText','sections'],[],'pages');identity(p.id,'pages.id');
   check(typeof p.path==='string'&&/^(?:\/|\/[a-z][a-z0-9-]{0,39})$/.test(p.path)&&!['/api','/assets','/backend','/cms','/contact','/directory','/workspace'].includes(p.path),'INCOMPATIBLE','pages.path');
   check(p.component==='site-page@1','UNSUPPORTED_VERSION','pages.component');check(['public','staff'].includes(p.audience),'INCOMPATIBLE','pages.audience');
   check(p.audience!=='staff'||modules.has('access'),'INCOMPATIBLE','pages.access');
   list(p.sections,6,'pages.sections');for(const s of p.sections)shape(s,['heading','text'],[],'pages.sections');
   try{siteConfig({name:spec.name,theme:spec.design.theme,headline:value(p.headline),description:value(p.description),aboutTitle:value(p.aboutTitle),aboutText:value(p.aboutText),sections:p.sections.map(s=>({heading:value(s.heading),text:value(s.text)}))});}catch(e){if(e instanceof SpecificationError)throw e;fail('INCOMPATIBLE','pages.componentConfiguration');}
  }
  shape(spec.access,['roles'],[],'access');list(spec.access.roles,1,'access.roles');check(same(spec.access.roles,[])||same(spec.access.roles,['staff']),'INCOMPATIBLE','access.roles');
  check(modules.has('access')===spec.access.roles.includes('staff'),'INCOMPATIBLE','access.module');
  list(spec.records,4,'records');unique(spec.records,'id','records');requireModule('records',spec.records);
  for(const r of spec.records){
   shape(r,['id','schemaVersion','fields','read','write'],[],'records');identity(r.id,'records.id');check(r.schemaVersion===1,'UNSUPPORTED_VERSION','records.schemaVersion');
   check(['owner','staff'].includes(r.read)&&['owner','staff'].includes(r.write),'INCOMPATIBLE','records.policy');
   check((r.read!=='staff'&&r.write!=='staff')||modules.has('access'),'INCOMPATIBLE','records.access');
   check(r.write!=='staff'||r.read==='staff','INCOMPATIBLE','records.policy');
   try{backendFormConfig({title:'Schema',description:'',buttonLabel:'Submit',fields:r.fields});}catch{fail('INCOMPATIBLE','records.fields');}
  }
  list(spec.files,4,'files');unique(spec.files,'id','files');requireModule('files',spec.files);
  for(const f of spec.files){
   shape(f,['id','read','upload','maxBytes','mimeTypes'],[],'files');identity(f.id,'files.id');
   check(['owner','staff'].includes(f.read)&&f.upload==='visitor','INCOMPATIBLE','files.policy');integer(f.maxBytes,1,5*1024*1024,'files.maxBytes');
   list(f.mimeTypes,2,'files.mimeTypes');check(f.mimeTypes.length>0&&new Set(f.mimeTypes).size===f.mimeTypes.length&&f.mimeTypes.every(m=>['image/jpeg','image/png'].includes(m)),'INCOMPATIBLE','files.mimeTypes');
  }
  list(spec.forms,4,'forms');unique(spec.forms,'id','forms');requireModule('records',spec.forms);
  for(const f of spec.forms){
   shape(f,['id','recordId','title','description','buttonLabel','submit','uploadCollectionId'],[],'forms');identity(f.id,'forms.id');
   const r=spec.records.find(r=>r.id===f.recordId);check(r,'MISSING_REFERENCE','forms.recordId');
   check(['public','visitor'].includes(f.submit),'INCOMPATIBLE','forms.submit');check(f.submit!=='visitor'||modules.has('access'),'INCOMPATIBLE','forms.access');
   check(f.uploadCollectionId===null||f.submit==='visitor'&&spec.files.some(c=>c.id===f.uploadCollectionId),'INCOMPATIBLE','forms.uploadCollectionId');
   try{backendFormConfig({title:f.title,description:f.description,buttonLabel:f.buttonLabel,fields:r.fields});}catch{fail('INCOMPATIBLE','forms.configuration');}
  }
  list(spec.integrations,2,'integrations');unique(spec.integrations,'id','integrations');requireModule('notifications',spec.integrations);
  for(const i of spec.integrations){shape(i,['id','capability'],[],'integrations');identity(i.id,'integrations.id');check(i.capability==='email.staff','INCOMPATIBLE','integrations.capability');}
  list(spec.rules,8,'rules');unique(spec.rules,'id','rules');requireModule('automation',spec.rules);
  for(const r of spec.rules){
   shape(r,['id','trigger','effect'],[],'rules');identity(r.id,'rules.id');shape(r.trigger,['type','formId'],[],'rules.trigger');shape(r.effect,['type','integrationId','recipient','template'],[],'rules.effect');
   check(r.trigger.type==='form.accepted'&&r.effect.type==='notification.send'&&r.effect.recipient==='staff'&&r.effect.template==='submission-link@1','INCOMPATIBLE','rules.operation');
   const form=spec.forms.find(f=>f.id===r.trigger.formId);check(form,'MISSING_REFERENCE','rules.formId');
   check(spec.records.find(d=>d.id===form.recordId)?.read==='staff','INCOMPATIBLE','rules.recipientAccess');
   check(spec.integrations.some(i=>i.id===r.effect.integrationId),'MISSING_REFERENCE','rules.integrationId');
  }
  return spec;
 }
 function change(before,operations){
  list(operations,8,'operations');check(operations.length>0,'INVALID_LIST','operations');const next=copy(before),reviews=new Set();
  const found=(rows,id,path)=>{identity(id,path);const row=rows.find(x=>x.id===id);check(row,'MISSING_REFERENCE',path);return row;};
  for(const op of operations){
   check(plain(op),'INVALID_SHAPE','operations');
   switch(op.type){
    case 'content.replace':shape(op,['type','contentId','text']);text(op.text,1000,'operations.text',true);found(next.content,op.contentId,'contentId').text=op.text;break;
    case 'design.setTheme':shape(op,['type','theme']);next.design.theme=op.theme;break;
    case 'records.addField':shape(op,['type','recordId','field']);check(plain(op.field)&&op.field.type==='text'&&op.field.optional===true,'MIGRATION_REQUIRED','field');found(next.records,op.recordId,'recordId').fields.push(copy(op.field));reviews.add('schema');break;
    case 'files.setPolicy':shape(op,['type','collectionId','read','upload']);Object.assign(found(next.files,op.collectionId,'collectionId'),{read:op.read,upload:op.upload});reviews.add('permissions');break;
    case 'pages.setAudience':shape(op,['type','pageId','audience']);found(next.pages,op.pageId,'pageId').audience=op.audience;reviews.add('permissions');break;
    case 'rules.put':{
     shape(op,['type','rule']);check(plain(op.rule),'INVALID_SHAPE','rule');identity(op.rule.id,'rule.id');const at=next.rules.findIndex(r=>r.id===op.rule.id);if(at<0)next.rules.push(copy(op.rule));else next.rules[at]=copy(op.rule);reviews.add('integration');reviews.add('spending');break;
    }
    default:fail('UNSUPPORTED_OPERATION','operations.type');
   }
  }
  const spec=validate(next);check(!same(before,spec),'NO_CHANGE','operations');return {spec,reviews:[...reviews].sort()};
 }
 function projectPage(spec,pageId){
  const page=spec.pages.find(p=>p.id===pageId);check(page,'MISSING_REFERENCE','pageId');const value=id=>spec.content.find(c=>c.id===id).text;
  return siteConfig({name:spec.name,theme:spec.design.theme,headline:value(page.headline),description:value(page.description),aboutTitle:value(page.aboutTitle),aboutText:value(page.aboutText),sections:page.sections.map(s=>({heading:value(s.heading),text:value(s.text)}))});
 }
 return Object.freeze({validate,change,projectPage,validationArtifactDigest});
}

function difference(a,b,path=''){
 if(same(a,b))return [];
 if(plain(a)&&plain(b))return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().flatMap(k=>difference(a[k]??null,b[k]??null,path+'/'+k));
 return [{path,before:copy(a),after:copy(b)}];
}
/** In-memory protocol model. It proves contract behavior, not D1 atomicity or real authentication. */
export class ProjectSpecificationPrototype {
 #projects=new Map();#proposals=new Map();#approvals=new Map();#receipts=new Map();#contract;#now;
 constructor({projects,contract,now=()=>Date.now()}){
  this.#contract=contract;this.#now=now;
  for(const p of projects){uuid(p.id,'project');uuid(p.ownerId,'owner');check(!this.#projects.has(p.id),'ID_CONFLICT','project');const spec=contract.validate(p.spec);this.#projects.set(p.id,{id:p.id,ownerId:p.ownerId,revision:0,spec,versions:[{revision:0,digest:specificationDigest(spec),spec:copy(spec)}]});}
 }
 #own(actor,projectId){
  check(actor&&['owner','maintainer'].includes(actor.kind),'FORBIDDEN','actor');
  const p=this.#projects.get(projectId);check(p&&p.ownerId===actor.userId,'NOT_FOUND','project');return p;
 }
 read(actor,projectId){const p=this.#own(actor,projectId);return copy({projectId:p.id,revision:p.revision,digest:specificationDigest(p.spec),spec:p.spec});}
 propose(actor,projectId,input){
  const p=this.#own(actor,projectId);shape(input,['id','expectedRevision','operations']);uuid(input.id,'request.id');integer(input.expectedRevision,0,Number.MAX_SAFE_INTEGER,'expectedRevision');
  const key=projectId+':'+input.id,requestDigest=specificationDigest(input),previous=this.#proposals.get(key);
  if(previous){check(previous.requestDigest===requestDigest,'ID_CONFLICT','request.id');return copy(previous.review);}
  check(p.revision===input.expectedRevision,'STALE_REVISION','expectedRevision');check([...this.#proposals.keys()].filter(k=>k.startsWith(projectId+':')).length<32,'QUOTA','proposals');
  const {spec,reviews}=this.#contract.change(p.spec,input.operations),diff=difference(p.spec,spec);
  const preview={kind:'configuration-summary',compiler,validationArtifactDigest:this.#contract.validationArtifactDigest,projectId,baseRevision:p.revision,changes:diff,pages:spec.pages.map(p=>({id:p.id,path:p.path,audience:p.audience,component:p.component})),modules:spec.modules,activation:'not-configured'};
  const review={id:input.id,projectId,expectedRevision:p.revision,baseDigest:specificationDigest(p.spec),nextDigest:specificationDigest(spec),diff,preview,previewDigest:specificationDigest(preview),requiredReviews:reviews,acceptance:{kind:'offline-contract-validation',schemaVersion:1,validationArtifactDigest:this.#contract.validationArtifactDigest,checks:['closed-schema','module-versions','references','field-contracts','permission-compatibility','no-maintainer-runtime']},expiresAt:this.#now()+600000,activation:'not-configured'};
  review.proposalDigest=specificationDigest(review);this.#proposals.set(key,{requestDigest,review,spec});return copy(review);
 }
 #proposal(actor,projectId,id,digest){
  const p=this.#own(actor,projectId);uuid(id,'proposalId');check(typeof digest==='string'&&/^[0-9a-f]{64}$/.test(digest),'INVALID_DIGEST','proposalDigest');const saved=this.#proposals.get(projectId+':'+id);check(saved,'NOT_FOUND','proposal');
  check(saved.review.proposalDigest===digest,'REVIEW_CHANGED','proposalDigest');check(saved.review.expiresAt>this.#now(),'EXPIRED','proposal');
  check(p.revision===saved.review.expectedRevision&&specificationDigest(p.spec)===saved.review.baseDigest,'STALE_REVISION','proposal');return {p,saved};
 }
 approve(actor,projectId,input){
  this.#own(actor,projectId);check(actor.kind==='owner'&&actor.recentAuth===true,'FORBIDDEN','approval');shape(input,['proposalId','proposalDigest','classes']);
  const {saved}=this.#proposal(actor,projectId,input.proposalId,input.proposalDigest);
  check(same(input.classes,saved.review.requiredReviews),'REVIEW_REQUIRED','classes');this.#approvals.set(projectId+':'+input.proposalId,{digest:input.proposalDigest,ownerId:actor.userId});
  return {proposalId:input.proposalId,proposalDigest:input.proposalDigest,classes:copy(input.classes),scope:'private-specification-only'};
 }
 apply(actor,projectId,input){
  this.#own(actor,projectId);shape(input,['id','proposalId','proposalDigest','expectedRevision']);uuid(input.id,'request.id');integer(input.expectedRevision,0,Number.MAX_SAFE_INTEGER,'expectedRevision');
  const key=projectId+':'+input.id,hash=specificationDigest(input),previous=this.#receipts.get(key);
  if(previous){check(previous.hash===hash,'ID_CONFLICT','request.id');return copy(previous.receipt);}
  const {p,saved}=this.#proposal(actor,projectId,input.proposalId,input.proposalDigest),approval=this.#approvals.get(projectId+':'+input.proposalId);
  check(input.expectedRevision===p.revision,'STALE_REVISION','expectedRevision');
  check(!saved.review.requiredReviews.length||approval?.digest===input.proposalDigest&&approval.ownerId===actor.userId,'REVIEW_REQUIRED','approval');
  check(p.versions.length<25,'QUOTA','versions');
  const spec=this.#contract.validate(saved.spec),revision=p.revision+1;
  const receipt={id:input.id,projectId,revision,proposalId:input.proposalId,proposalDigest:input.proposalDigest,specDigest:specificationDigest(spec),previewDigest:saved.review.previewDigest,activation:'not-configured',published:false};
  // One synchronous in-memory transition; production needs a real guarded transaction.
  p.spec=spec;p.revision=revision;p.versions.push({revision,digest:receipt.specDigest,spec:copy(spec)});this.#receipts.set(key,{hash,receipt});return copy(receipt);
 }
 versions(actor,projectId){return copy(this.#own(actor,projectId).versions);}
}
