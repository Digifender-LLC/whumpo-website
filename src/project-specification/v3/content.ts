import {renderSite,renderPhotoPage,previewHeaders,photoConfig} from '../../components';
import {copyJSON,jsonDigest,requireSpec,sha256} from '../v2/json';
import {changeSpecification,projectPage,specificationDifference,validateSpecification} from './schema';
import type {ProjectSpecification} from './types';

/** Pure rendering core. Only the catalog wrapper can issue an accepted compiler lock or admit module pins. */
export async function renderContentSpecification(input:unknown){
 const spec=validateSpecification(input);
 requireSpec(spec.pages.every(page=>page.audience==='public'),'UNSUPPORTED_DELIVERY','pages.audience');
 // Module configuration is described, not served: instances need WH-125 registry/activation before any compile output.
 requireSpec(spec.modules.length===1&&spec.modules[0].id==='content'&&spec.instances.length===0,'UNAVAILABLE_CAPABILITY','modules');
 const artifacts=[];
 for(const page of spec.pages){
  const {photos,...text}=projectPage(spec,page.id);
  const html=photos.length?renderPhotoPage({...text,photos}):renderSite(text),bytes=new TextEncoder().encode(html).length;
  requireSpec(bytes<=32768,'OUTPUT_TOO_LARGE','pages');
  artifacts.push({pageId:page.id,path:page.path,component:page.component,audience:page.audience,mediaType:'text/html; charset=utf-8',bytes,digest:await sha256(html),html});
 }
 return {specification:spec,specificationDigest:await jsonDigest(spec),artifacts,previewHeaders:{...previewHeaders}};
}

/** New website input only. Existing saved artifacts are never imported or converted. */
export function createContentSpecification(input:unknown):ProjectSpecification {
 const config=photoConfig(copyJSON(input,8192));
 const content=[{id:'headline',text:config.headline},{id:'description',text:config.description},{id:'about-title',text:config.aboutTitle},{id:'about-text',text:config.aboutText}];
 const sections=config.sections.map((section,index)=>{
  const heading=`section-${index+1}-heading`,text=`section-${index+1}-text`;
  content.push({id:heading,text:section.heading},{id:text,text:section.text});return {heading,text};
 });
 return validateSpecification({schemaVersion:3,name:config.name,design:{theme:config.theme},modules:[{id:'content',version:2}],content,
  pages:[{id:'home',path:'/',component:config.photos.length?'photo-page@1':'site-page@1',audience:'public',photos:config.photos,headline:'headline',description:'description',aboutTitle:'about-title',aboutText:'about-text',sections}],
  instances:[],integrations:[],rules:[]});
}

export async function renderContentChange(before:unknown,operations:unknown){
 const base=await renderContentSpecification(before),changed=changeSpecification(base.specification,operations);
 const next=await renderContentSpecification(changed.spec);
 return {baseDigest:base.specificationDigest,next,diff:specificationDifference(base.specification,next.specification),requiredReviews:changed.reviews,migration:changed.migration};
}
