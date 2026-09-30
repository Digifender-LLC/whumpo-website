import {renderSite,previewHeaders,siteConfig} from '../../components';
import {canonicalJSON,copyJSON,jsonDigest,requireSpec,sha256,shape} from './json';
import {changeSpecification,projectPage,specificationDifference,validateSpecification} from './schema';
import type {ProjectSpecification} from './types';

/** Pure rendering core. Only the catalog wrapper can issue an accepted compiler lock. */
export async function renderContentSpecification(input:unknown){
 const spec=validateSpecification(input);
 requireSpec(spec.pages.every(page=>page.audience==='public'),'UNSUPPORTED_DELIVERY','pages.audience');
 requireSpec(spec.modules.length===1&&spec.modules[0].id==='content','UNAVAILABLE_CAPABILITY','modules');
 const artifacts=[];
 for(const page of spec.pages){
  const html=renderSite(projectPage(spec,page.id)),bytes=new TextEncoder().encode(html).length;
  requireSpec(bytes<=32768,'OUTPUT_TOO_LARGE','pages');
  artifacts.push({pageId:page.id,path:page.path,component:page.component,audience:page.audience,mediaType:'text/html; charset=utf-8',bytes,digest:await sha256(html),html});
 }
 return {specification:spec,specificationDigest:await jsonDigest(spec),artifacts,previewHeaders:{...previewHeaders}};
}

/** Evidence only. Storage code must load and authorize the original version before calling. */
export async function importLegacySitePage(input:unknown){
 // Guard size/prototypes before inspecting untrusted configuration or string fields.
 const source=copyJSON(input,49152);
 shape(source,['versionId','componentId','config','html','digest'],'legacy');
 requireSpec(typeof source.versionId==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(source.versionId),'INVALID_ID','legacy.versionId');
 requireSpec(source.componentId==='site-page@1','UNSUPPORTED_LEGACY','legacy.componentId');
 requireSpec(typeof source.html==='string'&&new TextEncoder().encode(source.html).length<=32768,'INVALID_TEXT','legacy.html');
 requireSpec(typeof source.digest==='string'&&/^[0-9a-f]{64}$/.test(source.digest),'INVALID_DIGEST','legacy.digest');
 requireSpec(await sha256(source.html)===source.digest,'ARTIFACT_MISMATCH','legacy.digest');
 let config:ReturnType<typeof siteConfig>;
 try{config=siteConfig(source.config);}catch{requireSpec(false,'INCOMPATIBLE','legacy.config');}
 // Existing saved versions use normalized config; never silently normalize an import.
 requireSpec(canonicalJSON(config)===canonicalJSON(source.config),'NON_CANONICAL_LEGACY','legacy.config');
 requireSpec(renderSite(config)===source.html,'ARTIFACT_MISMATCH','legacy.html');
 const content=[{id:'headline',text:config.headline},{id:'description',text:config.description},{id:'about-title',text:config.aboutTitle},{id:'about-text',text:config.aboutText}];
 const sections=config.sections.map((section,index)=>{
  const heading=`section-${index+1}-heading`,text=`section-${index+1}-text`;
  content.push({id:heading,text:section.heading},{id:text,text:section.text});return {heading,text};
 });
 const spec:ProjectSpecification={schemaVersion:1,name:config.name,design:{theme:config.theme},modules:[{id:'content',version:1}],content,
  pages:[{id:'home',path:'/',component:'site-page@1',audience:'public',headline:'headline',description:'description',aboutTitle:'about-title',aboutText:'about-text',sections}],
  records:[],forms:[],files:[],access:{roles:[]},integrations:[],rules:[]};
 const result=await renderContentSpecification(spec);
 requireSpec(result.artifacts[0].html===source.html,'ARTIFACT_MISMATCH','legacy.projection');
 return {specification:result.specification,origin:{versionId:source.versionId,componentId:source.componentId,htmlDigest:source.digest,configDigest:await jsonDigest(config)}};
}

export async function renderContentChange(before:unknown,operations:unknown){
 const base=await renderContentSpecification(before),changed=changeSpecification(base.specification,operations);
 const next=await renderContentSpecification(changed.spec);
 return {baseDigest:base.specificationDigest,next,diff:specificationDifference(base.specification,next.specification),requiredReviews:changed.reviews};
}
