// WH-070 offline contract reference (WH-161): customer presentation levels, the scoped module client and the custom
// component boundary. It validates frozen shapes, static content checks and change classification only. It is not a
// renderer, compiler, browser sandbox, CSP enforcement point or HTTP handler, and no Worker imports it. Production code
// keeps deriving every principal server-side and enforcing the WH-067 policy table inside each module API; nothing
// here grants authority.
import {createHash} from 'node:crypto';
import {moduleOperations,validateRequest} from './shared-modules.mjs';

export class PresentationContractError extends Error{
 constructor(code,path){super(`${code}: ${path}`);this.code=code;this.path=path;}
}
const check=(ok,code,path)=>{if(!ok)throw new PresentationContractError(code,path);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function shape(v,keys,path,missing='MISSING_FIELD'){
 check(plain(v),'INVALID_SHAPE',path);
 check(Object.keys(v).every(k=>keys.includes(k)),'UNKNOWN_FIELD',path);
 check(keys.every(k=>Object.hasOwn(v,k)),missing,path);
}
const localId=(v,path)=>check(typeof v==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(v)&&!['constructor','prototype','tojson'].includes(v),'INVALID_ID',path);
const hex64=(v,path)=>check(typeof v==='string'&&/^[0-9a-f]{64}$/.test(v),'INVALID_DIGEST',path);
const integer=(v,min,max,path,code='INVALID_NUMBER')=>check(Number.isSafeInteger(v)&&v>=min&&v<=max,code,path);
function list(v,min,max,path){check(Array.isArray(v)&&v.length>=min&&v.length<=max,'INVALID_LIST',path);}
function unique(values,path){check(new Set(values).size===values.length,'DUPLICATE_ID',path);}
const oneOf=(v,values,code,path)=>check(values.includes(v),code,path);
export function canonical(v,depth=0){
 check(depth<=24,'TOO_DEEP','json');
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){check(Number.isFinite(v),'INVALID_NUMBER','json');return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
 check(plain(v),'INVALID_SHAPE','json');
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
}
const sha256=s=>createHash('sha256').update(s).digest('hex');
const copy=(v,max,path)=>{const json=canonical(v);check(Buffer.byteLength(json)<=max,'TOO_LARGE',path);return JSON.parse(json);};
const same=(a,b)=>canonical(a)===canonical(b);

/** Frozen v1 identities and bounds. A different value is a new reviewed identity, never a silent repin. */
export const presentationContractVersion=1,componentContractVersion=1,frameApiVersion=1;
export const limits=Object.freeze({presentationBytes:12288,surfaces:8,regions:4,placements:12,placementsTotal:48,components:4,componentUses:6,
 navItems:8,scriptBytes:16384,styleBytes:8192,frameMinHeight:48,frameMaxHeight:2400});

// Keys a presentation, binding, use or custom component can never carry. Scope, principals and storage are derived on
// the server; backend behavior stays in the maintained module, never in presentation configuration.
export const authorityKeys=Object.freeze(['projectId','ownerId','userId','visitorId','principal','role','roles','permissions','grants','approved',
 'credentials','credential','token','session','cookie','apiKey','secret','prefix','bucket','sql']);
export const backendKeys=Object.freeze(['handler','handlers','backend','server','function','source','endpoint','url','route','database','schema','config','fork']);
export const deniedCapabilities=Object.freeze(['network','fetch','storage','cookies','credentials','auth','authentication','inference','ai','model',
 'geolocation','camera','microphone','clipboard','payments','notifications','workers','popups','top-navigation','forms','same-origin','downloads']);
function forbiddenKeys(v,path){
 if(!plain(v))return;
 for(const k of Object.keys(v)){
  check(!backendKeys.includes(k),'BACKEND_FORBIDDEN',`${path}.${k}`);
  check(!authorityKeys.includes(k),'AUTHORITY_FIELD',`${path}.${k}`);
  check(!deniedCapabilities.includes(k),'FORBIDDEN_CAPABILITY',`${path}.${k}`);
 }
}

/** WH-067 operations a customer presentation may bind. Owner operations stay on the workspace origin. `target` is the
 * static part fixed by the specification; `dynamic` are runtime keys the host bridge may add from a user action. */
export const presentableOperations=Object.freeze({
 'forms.submit':Object.freeze({target:['formId'],dynamic:[]}),
 'records.view':Object.freeze({target:['viewId'],dynamic:['cursor']}),
 'records.get':Object.freeze({target:['recordId'],dynamic:['entryId']}),
 'records.update':Object.freeze({target:['recordId'],dynamic:['entryId','revision','changes']}),
 'files.putBytes':Object.freeze({target:['collectionId'],dynamic:[]}),
 'files.read':Object.freeze({target:['collectionId'],dynamic:['fileId']}),
 'files.gallery':Object.freeze({target:['collectionId'],dynamic:[]}),
 'access.me':Object.freeze({target:[],dynamic:[]}),
 'collections.readPublic':Object.freeze({target:['collectionId'],dynamic:[]}),
});
/** v1 custom components may write only through a maintained form submission (owner decision 2 may widen this). */
export const customWriteOperations=Object.freeze(['forms.submit']);

/** Level 2: the maintained component vocabulary of presentation-kit@1. Platform-authored code; never customer source. */
export const kitComponents=Object.freeze({
 'heading@1':{op:null,props:{text:'content',level:[1,2,3]}},
 'text@1':{op:null,props:{text:'content'}},
 'navigation@1':{op:null,props:{style:['top-bar','side-rail','tabs'],items:'nav'}},
 'record-form@1':{op:'forms.submit',props:{layout:['stacked','two-column'],submitLabel:'content'}},
 'record-list@1':{op:'records.view',props:{layout:['table','cards','list'],columns:'viewFields'}},
 'record-detail@1':{op:'records.get',props:{fields:'readableFields'}},
 'record-editor@1':{op:'records.update',props:{fields:'staffWrite'}},
 'gallery@1':{op:'files.gallery',props:{interaction:['grid','carousel','lightbox','masonry'],columns:[2,3,4]}},
 'upload@1':{op:'files.putBytes',props:{label:'content'}},
 'directory@1':{op:'collections.readPublic',props:{layout:['list','cards']}},
 'account@1':{op:'access.me',props:{}},
 'custom@1':{op:null,props:{componentId:'component'}},
});
export const audiences=Object.freeze(['public','visitor','staff']);
const landmarks=['header','navigation','main','complementary','contentinfo'];
const reservedPaths=['/modules','/components','/visitor.js','/visitor.css','/presentation.css','/kit','/api','/assets'];

// Level 1: closed design configuration. System font stacks only: no remote font, stylesheet or asset is ever loaded.
export const fontStacks=Object.freeze({
 serif:"Georgia,'Times New Roman',serif",sans:"system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif",
 slab:"Rockwell,'Roboto Slab',Georgia,serif",rounded:"ui-rounded,'Arial Rounded MT Bold',system-ui,sans-serif",mono:"ui-monospace,Menlo,Consolas,monospace",
});
const paletteKeys=['ink','paper','accent','onAccent','muted'];
const scales={compact:0.9375,regular:1,large:1.125},radii={none:0,small:6,large:18},densities={compact:12,comfortable:20};
function luminance(hex){
 const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
 return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
}
/** WCAG 2.2 contrast ratio between two #rrggbb colors. */
export function contrast(a,b){const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);return (x+0.05)/(y+0.05);}
export function validateDesign(input){
 const d=copy(input,2048,'design');
 shape(d,['palette','typography','shape','motion'],'design');
 shape(d.palette,paletteKeys,'design.palette');
 for(const k of paletteKeys)check(typeof d.palette[k]==='string'&&/^#[0-9a-f]{6}$/.test(d.palette[k]),'INVALID_COLOR',`design.palette.${k}`);
 shape(d.typography,['heading','body','scale'],'design.typography');
 oneOf(d.typography.heading,Object.keys(fontStacks),'UNSUPPORTED_TOKEN','design.typography.heading');
 oneOf(d.typography.body,['sans','serif','rounded'],'UNSUPPORTED_TOKEN','design.typography.body');
 oneOf(d.typography.scale,Object.keys(scales),'UNSUPPORTED_TOKEN','design.typography.scale');
 shape(d.shape,['radius','density'],'design.shape');
 oneOf(d.shape.radius,Object.keys(radii),'UNSUPPORTED_TOKEN','design.shape.radius');
 oneOf(d.shape.density,Object.keys(densities),'UNSUPPORTED_TOKEN','design.shape.density');
 oneOf(d.motion,['none','subtle'],'UNSUPPORTED_TOKEN','design.motion');
 // WCAG 2.2 SC 1.4.3 (text, 4.5:1) and SC 1.4.11 (interactive boundaries, 3:1). Checked at configuration time; the
 // rendered result still needs the browser evaluation slice.
 const p=d.palette;
 check(contrast(p.ink,p.paper)>=4.5,'CONTRAST_INSUFFICIENT','design.palette.ink');
 check(contrast(p.muted,p.paper)>=4.5,'CONTRAST_INSUFFICIENT','design.palette.muted');
 check(contrast(p.onAccent,p.accent)>=4.5,'CONTRAST_INSUFFICIENT','design.palette.onAccent');
 check(contrast(p.accent,p.paper)>=3,'CONTRAST_INSUFFICIENT','design.palette.accent');
 return d;
}
/** Deterministic level-1 compile: CSS custom properties served as a same-origin stylesheet (never inline style). */
export function designCss(input){
 const d=validateDesign(input),p=d.palette;
 const vars=[['ink',p.ink],['paper',p.paper],['accent',p.accent],['on-accent',p.onAccent],['muted',p.muted],
  ['font-heading',fontStacks[d.typography.heading]],['font-body',fontStacks[d.typography.body]],['scale',String(scales[d.typography.scale])],
  ['radius',`${radii[d.shape.radius]}px`],['space',`${densities[d.shape.density]}px`],['motion',d.motion==='none'?'0s':'160ms']];
 return `:root{${vars.map(([k,v])=>`--wp-${k}:${v}`).join(';')}}\n@media (prefers-reduced-motion:reduce){:root{--wp-motion:0s}}\n`;
}

function pin(v,name,path){shape(v,['name','version','digest'],path);check(typeof v.name==='string'&&(!name||v.name===name),'INVALID_SHAPE',`${path}.name`);integer(v.version,1,1e6,`${path}.version`);hex64(v.digest,`${path}.digest`);}
const samePin=(a,b)=>!!b&&a.name===b.name&&a.version===b.version&&a.digest===b.digest;

/** Context the presentation is validated against: the same specification's content ids and (already validated)
 * schema-3 module instances, plus the trusted kit/template catalog. */
function context(spec,catalog){
 check(plain(spec)&&Array.isArray(spec.instances)&&Array.isArray(spec.content),'INVALID_SHAPE','specification');
 const instances=new Map(spec.instances.map(i=>[i.id,i]));
 return {instances,contentIds:new Set(spec.content.map(c=>c.id)),catalog};
}
function contentRef(v,ctx,path){localId(v,path);check(ctx.contentIds.has(v),'MISSING_REFERENCE',path);}
function instanceOf(ctx,id,path){localId(id,path);const i=ctx.instances.get(id);check(i,'MISSING_REFERENCE',path);return i;}
function targetEntity(instance,operation,target,path){
 const c=instance.config,t=target??{};
 const found=(rows,id)=>{const row=(rows??[]).find(x=>x.id===id);check(row,'MISSING_REFERENCE',path);return row;};
 switch(operation){
  case 'forms.submit':return found(c.forms,t.formId);
  case 'records.view':return found(c.views,t.viewId);
  case 'records.get':case 'records.update':return found(c.schemas,t.recordId);
  case 'files.putBytes':case 'files.read':case 'files.gallery':case 'collections.readPublic':return found(c.collections,t.collectionId);
  default:return null;
 }
}
/** Static audience projection of the frozen WH-067 policy table (tests cross-check it against the shared-modules
 * reference). It only refuses misleading configuration early; the module API still decides every request. */
export function audienceAllows(instance,operation,target,audience){
 const c=instance.config,t=target??{},staff=audience==='staff',signed=audience!=='public';
 switch(operation){
  case 'forms.submit':{const f=c.forms.find(x=>x.id===t.formId);return !!f&&(f.submit==='public'||(f.submit==='visitor'?signed:staff));}
  case 'records.view':{const v=c.views.find(x=>x.id===t.viewId);return !!v&&(v.audience==='staff'?staff:signed);}
  case 'records.get':return signed&&c.schemas.some(x=>x.id===t.recordId);
  case 'records.update':{const s=c.schemas.find(x=>x.id===t.recordId);return staff&&!!s&&s.staffWrite.length>0;}
  case 'files.putBytes':{const x=c.collections.find(y=>y.id===t.collectionId);return !!x&&signed&&x.upload.includes(staff?'staff':'visitor');}
  case 'files.read':case 'files.gallery':{
   const x=c.collections.find(y=>y.id===t.collectionId);if(!x||!signed)return false;
   if(operation==='files.gallery'&&(!x.gallery||(x.gallery.audience==='staff'&&!staff)))return false;
   return staff?x.read!=='owner':x.read==='submitter';
  }
  case 'access.me':return signed;
  case 'collections.readPublic':return c.collections.some(x=>x.id===t.collectionId);
 }
 return false;
}
function validateBinding(b,ctx,path){
 forbiddenKeys(b,path);
 shape(b,['instanceId','operation','target'],path);
 const instance=instanceOf(ctx,b.instanceId,`${path}.instanceId`);
 check(Object.hasOwn(moduleOperations,b.operation),'UNSUPPORTED_OPERATION',`${path}.operation`);
 check(Object.hasOwn(presentableOperations,b.operation),'OPERATION_NOT_PRESENTABLE',`${path}.operation`);
 check(moduleOperations[b.operation].kind===instance.kind,'UNSUPPORTED_OPERATION',`${path}.operation kind`);
 const keys=presentableOperations[b.operation].target;
 if(!keys.length)check(b.target===null,'INVALID_SHAPE',`${path}.target`);
 else{forbiddenKeys(b.target,`${path}.target`);shape(b.target,keys,`${path}.target`);for(const k of keys)localId(b.target[k],`${path}.target.${k}`);}
 return {instance,entity:targetEntity(instance,b.operation,b.target,`${path}.target`)};
}
function fieldList(v,allowed,path){list(v,1,8,path);unique(v,path);for(const k of v){localId(k,path);check(allowed.includes(k),'FIELD_FORBIDDEN',path);}}
function validateProps(component,props,binding,surface,ctx,path){
 const def=kitComponents[component].props;
 shape(props,Object.keys(def),path);
 for(const [k,kind] of Object.entries(def)){
  const v=props[k],at=`${path}.${k}`;
  if(Array.isArray(kind))oneOf(v,kind,'UNSUPPORTED_TOKEN',at);
  else if(kind==='content')contentRef(v,ctx,at);
  else if(kind==='component'){localId(v,at);check(ctx.componentIds.has(v),'MISSING_REFERENCE',at);}
  else if(kind==='nav'){list(v,1,limits.navItems,at);for(const item of v){shape(item,['surfaceId','label'],at);check(ctx.surfaceIds.has(item.surfaceId),'MISSING_REFERENCE',`${at}.surfaceId`);contentRef(item.label,ctx,`${at}.label`);}}
  else if(kind==='viewFields')fieldList(v,binding.entity.fields,at);
  else if(kind==='readableFields')fieldList(v,binding.entity.fields.filter(f=>surface.audience==='staff'?f.read!=='owner':f.read==='submitter').map(f=>f.key),at);
  else if(kind==='staffWrite')fieldList(v,binding.entity.staffWrite,at);
 }
}
const accessibilityKeys=['name','role','keyboard','focusVisible','reducedMotion','textAlternatives','minTargetPx'];
function validateAccessibility(a,ctx,path){
 // Every custom component must declare how it meets the kit's accessibility floor; a missing or weaker declaration is
 // refused rather than defaulted. Declarations are reviewed claims, verified by the browser evaluation slice.
 check(plain(a),'ACCESSIBILITY_REQUIRED',path);
 check(Object.keys(a).every(k=>accessibilityKeys.includes(k)),'UNKNOWN_FIELD',path);
 check(accessibilityKeys.every(k=>Object.hasOwn(a,k)),'ACCESSIBILITY_REQUIRED',path);
 contentRef(a.name,ctx,`${path}.name`);
 oneOf(a.role,['region','figure','form','group','list','img'],'ACCESSIBILITY_REQUIRED',`${path}.role`);
 oneOf(a.keyboard,['operable','not-interactive'],'ACCESSIBILITY_REQUIRED',`${path}.keyboard`);
 check(a.focusVisible===true,'ACCESSIBILITY_REQUIRED',`${path}.focusVisible`);
 check(a.reducedMotion==='respected','ACCESSIBILITY_REQUIRED',`${path}.reducedMotion`);
 oneOf(a.textAlternatives,['provided','no-images'],'ACCESSIBILITY_REQUIRED',`${path}.textAlternatives`);
 integer(a.minTargetPx,24,96,`${path}.minTargetPx`,'ACCESSIBILITY_REQUIRED');
}
/** Level 3: a small custom frontend component declaration. Its bytes live in a separate private immutable artifact
 * (validateComponentArtifact); the specification pins only the digest and sizes. */
export function validateComponent(input,ctx,path='component'){
 check(plain(input),'INVALID_SHAPE',path);
 forbiddenKeys(input,path);
 check(Object.hasOwn(input,'accessibility'),'ACCESSIBILITY_REQUIRED',`${path}.accessibility`);
 shape(input,['id','contractVersion','revision','artifact','capabilities','uses','accessibility','frame'],path);
 const c=input;
 localId(c.id,`${path}.id`);
 check(c.contractVersion===componentContractVersion,'UNSUPPORTED_VERSION',`${path}.contractVersion`);
 integer(c.revision,1,1e6,`${path}.revision`);
 shape(c.artifact,['digest','scriptBytes','styleBytes'],`${path}.artifact`);hex64(c.artifact.digest,`${path}.artifact.digest`);
 integer(c.artifact.scriptBytes,0,limits.scriptBytes,`${path}.artifact.scriptBytes`,'TOO_LARGE');
 integer(c.artifact.styleBytes,0,limits.styleBytes,`${path}.artifact.styleBytes`,'TOO_LARGE');
 list(c.capabilities,0,1,`${path}.capabilities`);
 for(const cap of c.capabilities)check(cap==='modules','FORBIDDEN_CAPABILITY',`${path}.capabilities`);
 list(c.uses,0,limits.componentUses,`${path}.uses`);unique(c.uses.map(u=>u?.alias),`${path}.uses`);
 check(!c.uses.length||c.capabilities.includes('modules'),'UNDECLARED_CAPABILITY',`${path}.capabilities`);
 const uses=c.uses.map((u,n)=>{
  const at=`${path}.uses.${n}`;forbiddenKeys(u,at);shape(u,['alias','instanceId','operation','target'],at);localId(u.alias,`${at}.alias`);
  const bound=validateBinding({instanceId:u.instanceId,operation:u.operation,target:u.target},ctx,at);
  check(!moduleOperations[u.operation].write||customWriteOperations.includes(u.operation),'CUSTOM_WRITE_FORBIDDEN',`${at}.operation`);
  return {...u,instance:bound.instance};
 });
 validateAccessibility(c.accessibility,ctx,`${path}.accessibility`);
 shape(c.frame,['minHeight','maxHeight'],`${path}.frame`);
 integer(c.frame.minHeight,limits.frameMinHeight,limits.frameMaxHeight,`${path}.frame.minHeight`);
 integer(c.frame.maxHeight,c.frame.minHeight,limits.frameMaxHeight,`${path}.frame.maxHeight`);
 return uses;
}

// Static content checks are defense in depth against obvious misuse and review noise; the enforced boundary is the
// opaque-origin sandbox and its CSP (componentFrameHeaders). Matches fail closed, including inside comments/strings.
export const scriptRules=Object.freeze([
 ['network',/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|WebTransport|RTCPeerConnection|sendBeacon|importScripts)\b/],
 ['dynamic-code',/\beval\b|\bFunction\s*\(|\bimport\s*\(|^\s*(?:import|export)\b|\bWebAssembly\b|\bset(?:Timeout|Interval)\s*\(\s*['"`]/m],
 ['storage',/\b(?:localStorage|sessionStorage|indexedDB|caches|cookieStore)\b|\bdocument\s*\.\s*cookie\b|\bnavigator\s*\.\s*storage\b/],
 ['credentials',/\bnavigator\s*\.\s*credentials\b|\bPublicKeyCredential\b|\bAuthorization\b|\bbearer\b|\bapi[_-]?key\b/i],
 ['frame-escape',/\b(?:window|self|globalThis)\s*\.\s*(?:parent|top|opener|frames|location|open)\b|(?<![.\w])(?:parent|top|opener|frames)\s*\.|\bpostMessage\b|(?<![.\w])location\s*[.=]|\bdocument\s*\.\s*(?:location|domain)\b/],
 ['html-sink',/\b(?:innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|DOMParser|srcdoc)\b|\bdocument\s*\.\s*write/],
 ['workers',/\b(?:Worker|SharedWorker|serviceWorker)\b/],
 ['inference',/\b(?:openai|anthropic|claude|gpt|gemini|llm|inference|AI_GATEWAY|workers-ai)\b|\bai\s*\.\s*run\b/i],
 ['absolute-url',/[a-z][a-z0-9+.-]*:\/\/|['"`]\s*(?:javascript|data|blob):/i],
 ['platform-route',/\/modules\b|\/api\/|whumpo\.(?:com|site)/i],
 ['device',/\bnavigator\s*\.\s*(?:geolocation|mediaDevices|clipboard|bluetooth|usb|serial|hid)\b|\b(?:Notification|PaymentRequest)\b/],
]);
export const styleRules=Object.freeze([
 ['remote-resource',/@import|\burl\s*\(|image-set\s*\(|@font-face/i],
 ['legacy-script',/expression\s*\(|behavior\s*:|-moz-binding|javascript:/i],
 ['markup',/<\/?\s*(?:style|script)/i],
]);
const hidden=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/;
export const artifactDigest=a=>sha256(canonical({script:a.script,style:a.style}));
export function validateComponentArtifact(input,declaration){
 shape(input,['script','style'],'artifact');
 check(typeof input.script==='string'&&typeof input.style==='string','INVALID_SHAPE','artifact');
 const scriptBytes=Buffer.byteLength(input.script),styleBytes=Buffer.byteLength(input.style);
 check(scriptBytes<=limits.scriptBytes,'TOO_LARGE','artifact.script');check(styleBytes<=limits.styleBytes,'TOO_LARGE','artifact.style');
 for(const [field,value] of [['script',input.script],['style',input.style]])check(!hidden.test(value),'DISALLOWED_CONTENT',`artifact.${field}:hidden-character`);
 for(const [rule,pattern] of scriptRules)check(!pattern.test(input.script),'DISALLOWED_CONTENT',`artifact.script:${rule}`);
 for(const [rule,pattern] of styleRules)check(!pattern.test(input.style),'DISALLOWED_CONTENT',`artifact.style:${rule}`);
 check(declaration.artifact.digest===artifactDigest(input)&&declaration.artifact.scriptBytes===scriptBytes&&declaration.artifact.styleBytes===styleBytes,'DIGEST_MISMATCH','artifact');
 return {digest:declaration.artifact.digest,scriptBytes,styleBytes};
}

const tuple=(instanceId,operation)=>`${instanceId}:${operation}`;
/** Whole presentation v1, validated against its own specification's content and instances. */
export function validatePresentation(input,spec,catalog){
 const p=copy(input,limits.presentationBytes,'presentation');
 check(plain(p),'INVALID_SHAPE','presentation');
 check(p.contractVersion===presentationContractVersion,'UNSUPPORTED_VERSION','presentation.contractVersion');
 shape(p,['contractVersion','kit','template','design','uses','surfaces','components'],'presentation');
 const ctx=context(spec,catalog);
 pin(p.kit,'presentation-kit','presentation.kit');
 check(samePin(p.kit,catalog.kit),'STALE_KIT_VERSION','presentation.kit');
 if(p.template!==null){
  pin(p.template,null,'presentation.template');
  const entry=catalog.templates.find(t=>t.name===p.template.name&&t.version===p.template.version);
  check(entry&&entry.state==='available','UNAVAILABLE','presentation.template');
  check(samePin(p.template,entry),'STALE_TEMPLATE_VERSION','presentation.template');
 }
 validateDesign(p.design);
 // Maintained module dependencies: declared explicitly, separately from the kit and template pins.
 list(p.uses,0,8,'presentation.uses');unique(p.uses.map(u=>u?.instanceId),'presentation.uses');
 const declared=new Set();
 for(const u of p.uses){
  forbiddenKeys(u,'presentation.uses');shape(u,['instanceId','operations'],'presentation.uses');
  const instance=instanceOf(ctx,u.instanceId,'presentation.uses.instanceId');
  list(u.operations,1,9,'presentation.uses.operations');unique(u.operations,'presentation.uses.operations');
  for(const op of u.operations){
   check(Object.hasOwn(moduleOperations,op),'UNSUPPORTED_OPERATION','presentation.uses.operations');
   check(Object.hasOwn(presentableOperations,op),'OPERATION_NOT_PRESENTABLE','presentation.uses.operations');
   check(moduleOperations[op].kind===instance.kind,'UNSUPPORTED_OPERATION','presentation.uses.operations kind');
   declared.add(tuple(u.instanceId,op));
  }
 }
 list(p.surfaces,1,limits.surfaces,'presentation.surfaces');unique(p.surfaces.map(s=>s?.id),'presentation.surfaces');unique(p.surfaces.map(s=>s?.path),'presentation.surfaces.path');
 list(p.components,0,limits.components,'presentation.components');unique(p.components.map(c=>c?.id),'presentation.components');
 ctx.surfaceIds=new Set(p.surfaces.map(s=>s.id));ctx.componentIds=new Set(p.components.map(c=>c.id));
 const componentUses=new Map(p.components.map((c,n)=>[c?.id,validateComponent(c,ctx,`presentation.components.${n}`)]));
 const access=[...ctx.instances.values()].find(i=>i.kind==='access');
 const required=new Set(),placed=new Set();let total=0;
 const requireAudience=(instance,operation,target,audience,path)=>{
  check(audienceAllows(instance,operation,target,audience),'AUDIENCE_EXCEEDS_POLICY',path);
  required.add(tuple(instance.id,operation));
 };
 for(const s of p.surfaces){
  shape(s,['id','path','audience','title','regions'],'presentation.surfaces');localId(s.id,'surfaces.id');
  check(typeof s.path==='string'&&/^(?:\/|\/[a-z][a-z0-9-]{0,39})$/.test(s.path)&&!reservedPaths.includes(s.path),'INCOMPATIBLE','surfaces.path');
  oneOf(s.audience,audiences,'INVALID_AUDIENCE','surfaces.audience');
  // Visitor and staff surfaces resolve principals only through the project's access instance, never workspace roles.
  check(s.audience==='public'||access,'MISSING_DEPENDENCY','surfaces.audience access');
  check(s.audience!=='staff'||access.config.roles.includes('staff'),'MISSING_DEPENDENCY','surfaces.audience staff role');
  contentRef(s.title,ctx,'surfaces.title');
  list(s.regions,1,limits.regions,'surfaces.regions');unique(s.regions.map(r=>r?.id),'surfaces.regions');
  let mains=0,h1=0;
  for(const r of s.regions){
   shape(r,['id','landmark','placements'],'surfaces.regions');localId(r.id,'regions.id');oneOf(r.landmark,landmarks,'INVALID_LANDMARK','regions.landmark');
   if(r.landmark==='main')mains++;
   list(r.placements,0,limits.placements,'regions.placements');unique(r.placements.map(x=>x?.id),'regions.placements');
   for(const x of r.placements){
    total++;forbiddenKeys(x,'placements');shape(x,['id','component','binding','props'],'placements');localId(x.id,'placements.id');
    check(Object.hasOwn(kitComponents,x.component),'UNSUPPORTED_COMPONENT','placements.component');
    const def=kitComponents[x.component];let binding=null;
    if(def.op===null)check(x.binding===null,'COMPONENT_BINDING_MISMATCH','placements.binding');
    else{
     check(plain(x.binding),'COMPONENT_BINDING_MISMATCH','placements.binding');
     check(x.binding.operation===def.op,'COMPONENT_BINDING_MISMATCH','placements.binding.operation');
     binding=validateBinding(x.binding,ctx,'placements.binding');
     requireAudience(binding.instance,def.op,x.binding.target,s.audience,'placements.binding');
    }
    validateProps(x.component,x.props,binding,s,ctx,'placements.props');
    if(x.component==='heading@1'&&x.props.level===1)h1++;
    if(x.component==='custom@1'){
     placed.add(x.props.componentId);
     for(const u of componentUses.get(x.props.componentId))requireAudience(u.instance,u.operation,u.target,s.audience,`components.${x.props.componentId}.uses.${u.alias}`);
    }
   }
  }
  // Landmark and heading structure is part of the frozen floor: one main region and one level-1 heading per surface.
  check(mains===1,'ACCESSIBILITY_REQUIRED',`surfaces.${s.id}.main`);check(h1===1,'ACCESSIBILITY_REQUIRED',`surfaces.${s.id}.h1`);
 }
 check(total<=limits.placementsTotal,'TOO_LARGE','placements');
 for(const id of ctx.componentIds)check(placed.has(id),'UNUSED_COMPONENT',`components.${id}`);
 for(const t of required)check(declared.has(t),'UNDECLARED_DEPENDENCY',t);
 for(const t of declared)check(required.has(t),'UNUSED_DEPENDENCY',t);
 return p;
}

/** Functional footprint: the exact (instance, operation, static target) tuples a presentation can reach. */
export function apiFootprint(input){
 const p=input,rows=new Set();
 for(const s of p.surfaces)for(const r of s.regions)for(const x of r.placements)if(x.binding)rows.add(`${x.binding.instanceId}:${x.binding.operation}:${canonical(x.binding.target)}`);
 for(const c of p.components)for(const u of c.uses)rows.add(`${u.instanceId}:${u.operation}:${canonical(u.target)}`);
 return [...rows].sort();
}
/** Visual fingerprint: template, tokens and layout structure, deliberately excluding bindings and uses. */
export function presentationFingerprint(p){
 return sha256(canonical({template:p.template,design:p.design,surfaces:p.surfaces.map(s=>({path:s.path,regions:s.regions.map(r=>({landmark:r.landmark,
  placements:r.placements.map(x=>({component:x.component,props:Object.fromEntries(Object.entries(x.props).filter(([,v])=>typeof v==='number'||['grid','carousel','lightbox','masonry','table','cards','list','stacked','two-column','top-bar','side-rail','tabs'].includes(v)))}))}))})),
  components:p.components.map(c=>c.artifact.digest)}));
}
export function designDistance(a,b){
 const leaves=(v,prefix='')=>plain(v)?Object.entries(v).flatMap(([k,x])=>leaves(x,`${prefix}.${k}`)):[[prefix,canonical(v)]];
 const left=new Map(leaves(a)),right=new Map(leaves(b));
 return [...left].filter(([k,v])=>right.get(k)!==v).length;
}
/** Accessibility evaluation that never reads bindings or uses, so it is independent of functional reuse. */
export function accessibilityReport(p){
 const d=p.design.palette,round=x=>Math.round(x*100)/100;
 return {contrast:{text:round(contrast(d.ink,d.paper)),muted:round(contrast(d.muted,d.paper)),onAccent:round(contrast(d.onAccent,d.accent)),accentBoundary:round(contrast(d.accent,d.paper))},
  surfaces:p.surfaces.map(s=>({id:s.id,mainLandmarks:s.regions.filter(r=>r.landmark==='main').length,
   levelOneHeadings:s.regions.flatMap(r=>r.placements).filter(x=>x.component==='heading@1'&&x.props.level===1).length})),
  components:p.components.map(c=>({id:c.id,...c.accessibility})),reducedMotion:'honored-by-kit'};
}

/** Normalized service identity, ignoring ids and labels, used to refuse duplicate (forked) instances. */
function serviceIdentity(i){
 const strip=v=>Array.isArray(v)?v.map(strip):plain(v)?Object.fromEntries(Object.entries(v).filter(([k])=>!['id','label','recordId','uploadCollectionId'].includes(k)).map(([k,x])=>[k,strip(x)])):v;
 return canonical({kind:i.kind,module:i.module?.name??null,config:strip(i.config)});
}
/** Reports module changes and presentation changes separately. A presentation change never edits an instance; a
 * duplicate of an existing maintained instance (a fork made to vary presentation) is refused. */
export function classifySpecificationChange(before,after){
 const prior=new Map(before.instances.map(i=>[i.id,i])),next=new Map(after.instances.map(i=>[i.id,i]));
 const changed=[...new Set([...prior.keys(),...next.keys()])].filter(id=>!prior.has(id)||!next.has(id)||!same(prior.get(id),next.get(id))).sort();
 const existing=new Set(before.instances.map(serviceIdentity));
 for(const id of changed)if(!prior.has(id)&&next.has(id))check(!existing.has(serviceIdentity(next.get(id))),'FORK_FOR_PRESENTATION',`instances.${id}`);
 const a=before.presentation,b=after.presentation;
 const flat=p=>new Set((p?.uses??[]).flatMap(u=>u.operations.map(op=>tuple(u.instanceId,op))));
 const ua=flat(a),ub=flat(b);
 const byId=rows=>new Map((rows??[]).map(r=>[r.id,r]));
 const diffIds=(x,y)=>{const m=byId(x),n=byId(y);return [...new Set([...m.keys(),...n.keys()])].filter(id=>!m.has(id)||!n.has(id)||!same(m.get(id),n.get(id))).sort();};
 const result={
  modules:{changed},
  template:same(a?.template??null,b?.template??null)?'unchanged':'changed',
  kit:same(a?.kit??null,b?.kit??null)?'unchanged':'changed',
  dependencies:{added:[...ub].filter(t=>!ua.has(t)).sort(),removed:[...ua].filter(t=>!ub.has(t)).sort()},
  presentation:{design:!same(a?.design??null,b?.design??null),surfaces:diffIds(a?.surfaces,b?.surfaces),components:diffIds(a?.components,b?.components)},
 };
 const reviews=new Set();
 if(changed.length)reviews.add('modules');
 if(!same(a,b))reviews.add('presentation');
 if(result.template==='changed'||result.kit==='changed')reviews.add('template');
 if(result.dependencies.added.length||result.dependencies.removed.length)reviews.add('dependencies');
 if(result.presentation.components.length)reviews.add('custom-component');
 result.reviews=[...reviews].sort();
 return result;
}

const presentationOperations=['presentation.setDesign','presentation.setTemplate','presentation.setUses','presentation.putSurface','presentation.removeSurface','presentation.putComponent','presentation.removeComponent'];
/** Applies presentation operations to a detached candidate. Module instances, pins and the activation registry
 * (configRevision) are passed through untouched; module changes need the separate WH-124 operations and reviews. */
export function changePresentation(state,operations,catalog){
 list(operations,1,8,'operations');
 const spec=state.spec,next=structuredClone(spec.presentation);
 check(next!==null,'MISSING_REFERENCE','presentation');
 const put=(rows,row)=>{check(plain(row),'INVALID_SHAPE','operation');const at=rows.findIndex(r=>r.id===row.id);if(at<0)rows.push(structuredClone(row));else rows[at]=structuredClone(row);};
 const drop=(rows,id)=>{const at=rows.findIndex(r=>r.id===id);check(at>=0,'MISSING_REFERENCE','operation');rows.splice(at,1);};
 for(const op of operations){
  check(plain(op)&&typeof op.type==='string','INVALID_SHAPE','operations');
  check(presentationOperations.includes(op.type),/^(?:modules|records)\./.test(op.type)?'PRESENTATION_CANNOT_CHANGE_MODULES':'UNSUPPORTED_OPERATION','operations.type');
  switch(op.type){
   case 'presentation.setDesign':shape(op,['type','design'],'operation');next.design=structuredClone(op.design);break;
   case 'presentation.setTemplate':shape(op,['type','template'],'operation');next.template=structuredClone(op.template);break;
   case 'presentation.setUses':shape(op,['type','uses'],'operation');next.uses=structuredClone(op.uses);break;
   case 'presentation.putSurface':shape(op,['type','surface'],'operation');put(next.surfaces,op.surface);break;
   case 'presentation.removeSurface':shape(op,['type','surfaceId'],'operation');drop(next.surfaces,op.surfaceId);break;
   case 'presentation.putComponent':shape(op,['type','component'],'operation');put(next.components,op.component);break;
   case 'presentation.removeComponent':shape(op,['type','componentId'],'operation');drop(next.components,op.componentId);break;
  }
 }
 validatePresentation(next,spec,catalog);
 check(!same(spec.presentation,next),'NO_CHANGE','operations');
 const after={...spec,presentation:next};
 const classification=classifySpecificationChange(spec,after);
 check(!classification.modules.changed.length,'PRESENTATION_CANNOT_CHANGE_MODULES','instances');
 return {state:{spec:after,registry:state.registry},classification};
}

/** What the owner-maintenance agent may load for a focused edit: the target and the contracts it uses, never other
 * components' source, unrelated surfaces or instances, registry internals, visitor data or credentials. */
function operationContract(instance,operation,target){
 const c=instance.config,t=target??{};
 const fields=(schema,keys)=>schema.fields.filter(f=>!keys||keys.includes(f.key)).map(f=>({key:f.key,label:f.label,type:f.type,optional:f.optional}));
 switch(operation){
  case 'forms.submit':{const f=c.forms.find(x=>x.id===t.formId);return {fields:fields(c.schemas.find(s=>s.id===f.recordId))};}
  case 'records.view':{const v=c.views.find(x=>x.id===t.viewId);return {fields:fields(c.schemas.find(s=>s.id===v.recordId),v.fields),scope:v.scope,limit:v.limit};}
  case 'records.get':case 'records.update':{const s=c.schemas.find(x=>x.id===t.recordId);return {fields:fields(s),staffWrite:[...s.staffWrite]};}
  case 'files.putBytes':case 'files.read':case 'files.gallery':{const x=c.collections.find(y=>y.id===t.collectionId);return {mediaTypes:[...x.mediaTypes],maxBytes:x.maxBytes};}
  default:return {};
 }
}
export function focusedEditContext(state,target,artifacts={}){
 const p=state.spec.presentation,instances=new Map(state.spec.instances.map(i=>[i.id,i]));
 const contract=(instanceId,operation,t)=>({instanceId,kind:instances.get(instanceId).kind,operation,target:t,contract:operationContract(instances.get(instanceId),operation,t)});
 if(Object.hasOwn(target,'componentId')){
  shape(target,['componentId'],'target');
  const c=p.components.find(x=>x.id===target.componentId);check(c,'MISSING_REFERENCE','componentId');
  // Only this component's own artifact bytes are loaded; other components are not even listed.
  const artifact=Object.hasOwn(artifacts,c.artifact.digest)?structuredClone(artifacts[c.artifact.digest]):null;
  return {kit:p.kit,design:p.design,component:structuredClone(c),artifact,contracts:c.uses.map(u=>contract(u.instanceId,u.operation,u.target)),frameApi:frameApiVersion};
 }
 shape(target,['surfaceId','placementId'],'target');
 const s=p.surfaces.find(x=>x.id===target.surfaceId);check(s,'MISSING_REFERENCE','surfaceId');
 const x=s.regions.flatMap(r=>r.placements).find(y=>y.id===target.placementId);check(x,'MISSING_REFERENCE','placementId');
 return {kit:p.kit,design:p.design,surface:{id:s.id,path:s.path,audience:s.audience},placement:structuredClone(x),
  contracts:x.binding?[contract(x.binding.instanceId,x.binding.operation,x.binding.target)]:[]};
}
/** Focused-edit preservation: only the targeted component or placement may differ; anything else, including the
 * declared dependencies, is an unfocused edit that needs its own reviewed change. */
export function assertFocusedEdit(before,after,target){
 const strip=p=>{
  const q=structuredClone(p);
  if(target.componentId){q.components=q.components.filter(c=>c.id!==target.componentId);}
  else for(const s of q.surfaces)if(s.id===target.surfaceId)for(const r of s.regions)r.placements=r.placements.map(x=>x.id===target.placementId?{id:x.id}:x);
  return q;
 };
 check(same(strip(before),strip(after)),'UNFOCUSED_EDIT','presentation');
 return true;
}

/** Deterministic client manifest: the kit, template, design CSS and, per used instance, the public resource id and
 * configRevision the browser envelope must carry. Registry rows are server-owned and never edited here. */
export function compileManifest(state,catalog){
 const spec=state.spec,p=validatePresentation(spec.presentation,spec,catalog);
 const resource=id=>{const r=state.registry[id];check(r,'UNAVAILABLE',`registry.${id}`);return {resourceId:r.resourceId,configRevision:r.configRevision};};
 const manifest={contractVersion:presentationContractVersion,kit:p.kit,template:p.template,designCss:designCss(p.design),
  instances:Object.fromEntries(p.uses.map(u=>u.instanceId).sort().map(id=>[id,resource(id)])),
  surfaces:p.surfaces.map(s=>({id:s.id,path:s.path,audience:s.audience,regions:s.regions})),
  components:Object.fromEntries(p.components.map(c=>[c.id,{revision:c.revision,artifactDigest:c.artifact.digest,
   uses:Object.fromEntries(c.uses.map(u=>[u.alias,{operation:u.operation,target:u.target,...resource(u.instanceId)}]))}]))};
 return {manifest,digest:sha256(canonical(manifest))};
}
/** A compiled client is stale as soon as any used instance advances configRevision; it must be recompiled and
 * re-reviewed, never silently retargeted. */
export function checkManifestCurrent(manifest,registry){
 for(const [id,pinned] of Object.entries(manifest.instances)){
  const r=registry[id];check(r&&r.resourceId===pinned.resourceId,'NOT_FOUND',`registry.${id}`);
  check(r.configRevision===pinned.configRevision,'STALE_CONFIGURATION',`registry.${id}`);
 }
 return true;
}

/** Host bridge (frame API v1). The sandboxed component posts {alias, target, input}; the platform-authored host page
 * owns every envelope field and the request id, merges only the operation's runtime target keys, and the result must
 * still pass the whumpo-modules v1 envelope check before a same-origin POST. The server decides authority. */
export function bridgeRequest(manifest,componentId,message,requestId){
 const component=manifest.components[componentId];check(component,'MISSING_REFERENCE','componentId');
 check(plain(message),'INVALID_SHAPE','message');
 for(const k of Object.keys(message)){
  check(!['api','version','operation','resourceId','configRevision','requestId'].includes(k),'BRIDGE_FIELD',`message.${k}`);
  check(!authorityKeys.includes(k),'AUTHORITY_FIELD',`message.${k}`);
 }
 shape(message,['alias','target','input'],'message');
 check(typeof message.alias==='string'&&Object.hasOwn(component.uses,message.alias),'UNDECLARED_DEPENDENCY','message.alias');
 const use=component.uses[message.alias],rules=presentableOperations[use.operation];
 let target=use.target;
 if(message.target!==null){
  check(plain(message.target),'INVALID_SHAPE','message.target');
  for(const k of Object.keys(message.target)){
   check(!authorityKeys.includes(k),'AUTHORITY_FIELD',`message.target.${k}`);
   check(!rules.target.includes(k),'BRIDGE_FIELD',`message.target.${k}`);
   check(rules.dynamic.includes(k),'UNKNOWN_FIELD',`message.target.${k}`);
  }
  target={...(use.target??{}),...message.target};
 }
 const write=moduleOperations[use.operation].write;
 return validateRequest({api:'whumpo-modules',version:1,operation:use.operation,resourceId:use.resourceId,configRevision:use.configRevision,
  requestId:write?requestId:null,target,input:message.input});
}

/** Frozen frame boundary. The visitor host CSP below matches src/app-host.ts at this contract's baseline; a surface
 * that places a custom component adds only `frame-src 'self'`. The component document is served at a same-origin
 * path with a CSP `sandbox` header and no allow-same-origin, so it runs in an opaque origin without cookies, storage
 * or any network permission. */
export const visitorHostPolicy="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
export const hostPolicy=hasCustomComponent=>visitorHostPolicy+(hasCustomComponent?"; frame-src 'self'":'');
export const frameSandbox='allow-scripts';
const cspHash=text=>`'sha256-${createHash('sha256').update(text).digest('base64')}'`;
export function componentFrameHeaders(artifact,bootstrap){
 const csp=['sandbox allow-scripts',"default-src 'none'",`script-src ${cspHash(bootstrap)} ${cspHash(artifact.script)}`,`style-src ${cspHash(artifact.style)}`,
  'img-src blob:',"connect-src 'none'","font-src 'none'","media-src 'none'","frame-src 'none'","worker-src 'none'","manifest-src 'none'",
  "form-action 'none'","base-uri 'none'","frame-ancestors 'self'","require-trusted-types-for 'script'","trusted-types 'none'"].join('; ');
 return {'content-type':'text/html; charset=utf-8','content-security-policy':csp,'cache-control':'private, no-store','x-content-type-options':'nosniff',
  'referrer-policy':'no-referrer','x-frame-options':'SAMEORIGIN','cross-origin-resource-policy':'same-origin','permissions-policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=()'};
}
