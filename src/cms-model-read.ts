import {cmsImageReferences} from './cms-image-block';
import {cmsRichEditBody} from './cms-content-shape';
import {editableCMS} from './cms-plain-text';
/** Explicit model projection: native metadata, live data and credentials never enter the lookup. */
export function cmsModelRead(value:unknown):string{
 const v=(value&&typeof value==='object'?value:{}) as {projectId:string;requestId:string;collection:string;revision:string;capabilities?:{structuredContent:boolean;imageContent?:boolean};item:{status:string;draftRevisionId?:unknown;data:{title:unknown;content:unknown}}};
 const reference={projectId:v.projectId,requestId:v.requestId,collection:v.collection};
 try{
  if(!['draft','published'].includes(v.item.status))throw Error('Unsupported status');
  const {data}=cmsRichEditBody(v.item.data.title,v.item.data.content,v.revision);
  return JSON.stringify({type:'cms_content_lookup',...reference,revision:v.revision,status:v.item.status,hasPrivateChanges:v.item.status==='draft'||!!v.item.draftRevisionId,plainEditing:!!editableCMS(v),structuredEditing:v.capabilities?.structuredContent===true&&(!cmsImageReferences(data.content).length||v.capabilities.imageContent===true),imageEditing:v.capabilities?.imageContent===true,title:data.title,content:data.content});
 }catch{return JSON.stringify({type:'cms_content_lookup',...reference,plainEditing:false,structuredEditing:false,reason:'Current content cannot be safely represented within the editing contract. Offer the publishing desk preview or export; do not replace or flatten it.'});}
}
