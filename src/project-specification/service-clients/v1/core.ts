import {backendFormConfig} from '../../../backend-form-config';
import {backendFormScript,backendFormScriptPolicy,renderBackendForm} from '../../../backend-form-render';
import type {BackendForm} from '../../../backend-form-shape';
import {publishedHTML} from '../../../published-html';
import {previewHeaders,renderSite,siteConfig} from '../../../components';
import {canonicalJSON,copyJSON,jsonDigest,requireSpec as check,sha256,shape} from '../../v1/json';

/** A companion to content@1, not a reinterpretation of record-bound v1 forms. */
export type ServiceClientSpecification={
 schemaVersion:1;
 contact:null|{component:'contact-link@1'};
 statelessForm:null|{component:'stateless-form@1';config:BackendForm};
};
export type ServiceClientTarget={
 projectId:string;
 website:{versionId:string;digest:string};
 publication:{revision:number;versionId:string|null};
 contact:{revision:number;active:boolean};
 backend:null|{revision:number;reviewId:string;versionId:string;digest:string};
 form:{revision:number;reviewId:string|null;active:boolean};
};
const uuid=(value:unknown,path:string)=>check(typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value),'INVALID_ID',path);
const hash=(value:unknown,path:string)=>check(typeof value==='string'&&/^[0-9a-f]{64}$/.test(value),'INVALID_DIGEST',path);
const revision=(value:unknown,path:string)=>check(Number.isSafeInteger(value)&&Number(value)>=0,'INVALID_REVISION',path);
export function validateServiceClientSpecification(input:unknown):ServiceClientSpecification {
 const spec=copyJSON(input,6144);shape(spec,['schemaVersion','contact','statelessForm']);
 check(spec.schemaVersion===1,'UNSUPPORTED_VERSION','schemaVersion');
 if(spec.contact!==null){shape(spec.contact,['component'],'contact');check(spec.contact.component==='contact-link@1','UNSUPPORTED_DELIVERY','contact.component');}
 if(spec.statelessForm!==null){
  shape(spec.statelessForm,['component','config'],'statelessForm');check(spec.statelessForm.component==='stateless-form@1','UNSUPPORTED_DELIVERY','statelessForm.component');
  try{spec.statelessForm.config=backendFormConfig(spec.statelessForm.config);}catch{check(false,'INCOMPATIBLE','statelessForm.config');}
 }
 return spec as ServiceClientSpecification;
}
export function validateServiceClientTarget(input:unknown):ServiceClientTarget {
 const t=copyJSON(input,4096);shape(t,['projectId','website','publication','contact','backend','form'],'target');uuid(t.projectId,'target.projectId');
 shape(t.website,['versionId','digest'],'target.website');uuid(t.website.versionId,'target.website.versionId');hash(t.website.digest,'target.website.digest');
 shape(t.publication,['revision','versionId'],'target.publication');revision(t.publication.revision,'target.publication.revision');if(t.publication.versionId!==null)uuid(t.publication.versionId,'target.publication.versionId');
 shape(t.contact,['revision','active'],'target.contact');revision(t.contact.revision,'target.contact.revision');check(typeof t.contact.active==='boolean','INVALID_SHAPE','target.contact.active');
 shape(t.form,['revision','reviewId','active'],'target.form');revision(t.form.revision,'target.form.revision');if(t.form.reviewId!==null)uuid(t.form.reviewId,'target.form.reviewId');check(typeof t.form.active==='boolean','INVALID_SHAPE','target.form.active');
 if(t.backend!==null){shape(t.backend,['revision','reviewId','versionId','digest'],'target.backend');revision(t.backend.revision,'target.backend.revision');check(Number(t.backend.revision)>0,'INVALID_REVISION','target.backend.revision');uuid(t.backend.reviewId,'target.backend.reviewId');uuid(t.backend.versionId,'target.backend.versionId');hash(t.backend.digest,'target.backend.digest');}
 check(!t.contact.active||t.contact.revision!==0&&t.publication.versionId!==null,'INCOMPATIBLE','target.contact');
 check(!t.form.active||t.form.revision!==0&&t.form.reviewId!==null&&t.backend!==null&&t.publication.versionId!==null,'INCOMPATIBLE','target.form');
 return t as ServiceClientTarget;
}

/** Pure compilation. A well-shaped target is NOT proof of current tenant authority. */
export async function renderServiceClients(input:unknown,targetInput:unknown,websiteInput:unknown){
 const specification=validateServiceClientSpecification(input),target=validateServiceClientTarget(targetInput);
 const website=copyJSON(websiteInput,49152);shape(website,['componentId','config','html'],'website');
 check(website.componentId==='site-page@1','UNSUPPORTED_DELIVERY','website.componentId');
 const html=website.html;
 check(typeof html==='string'&&new TextEncoder().encode(html).length<=32768,'INPUT_TOO_LARGE','website.html');
 check(await sha256(html)===target.website.digest,'ARTIFACT_MISMATCH','website.digest');
 try{const config=siteConfig(website.config);check(canonicalJSON(config)===canonicalJSON(website.config)&&renderSite(config)===html,'ARTIFACT_MISMATCH','website.config');}catch{check(false,'ARTIFACT_MISMATCH','website.config');}
 check(!specification.statelessForm||target.backend!==null,'MISSING_AUTHORITY','statelessForm');
 const form=specification.statelessForm?{config_json:canonicalJSON(specification.statelessForm.config,4096),backend_publication_id:target.backend!.reviewId}:null;
 const candidate=publishedHTML(html,specification.contact!==null,target.projectId,form);
 // Preview is visually representative but has no script, endpoint or navigable contact link.
 let inert='';
 if(specification.statelessForm){
  inert+=renderBackendForm(specification.statelessForm.config,target.projectId,target.backend!.reviewId)
   .replace(`<script>${backendFormScript}</script>`,'')
   .replace(/<form [^>]*>/,'<form><fieldset disabled style="border:0;margin:0;padding:0;min-width:0">')
   .replace('</form>','</fieldset></form>');
 }
 if(specification.contact)inert+='<section aria-label="Contact" style="margin:40px 0"><h2>Get in touch</h2><p>Contact us ↗</p><p>Contact intake requires its separate approval.</p></section>';
 const preview=html.replace('</main>',inert+'</main>');
 const artifacts=[];
 for(const [kind,value] of [['private-preview',preview],['release-candidate',candidate]] as const){
  const bytes=new TextEncoder().encode(value).length;check(bytes<=49152,'OUTPUT_TOO_LARGE','artifacts');
  artifacts.push({kind,path:'/',mediaType:'text/html; charset=utf-8',bytes,digest:await sha256(value),html:value});
 }
 const services=[];
 if(specification.contact)services.push({component:'contact-link@1',destination:`https://whumpo.com/contact/${target.projectId}`,method:'GET',intake:'name-email-message',recordAccess:'owner-inbox',activation:'separate-contact-review'});
 if(specification.statelessForm)services.push({component:'stateless-form@1',destination:`https://${target.projectId}.whumpo.site/backend/${target.backend!.reviewId}`,method:'POST',mediaType:'application/json',credentials:'omit',recordAccess:'none',activation:'separate-backend-form-review'});
 return {specification,target,specificationDigest:await jsonDigest(specification,6144),targetDigest:await jsonDigest(target,4096),artifacts,services,
  previewHeaders:{...previewHeaders},candidateScriptPolicy:form?await backendFormScriptPolicy():null,
  requiredReviews:['website-publication',...(specification.contact||target.contact.active?['contact-settings']:[]),...(specification.statelessForm||target.form.active?['backend-form-settings']:[])]};
}
