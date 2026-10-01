import {editableCMS} from './cms-plain-text';
type RecordValue=Record<string,unknown>;
const record=(value:unknown):RecordValue|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as RecordValue:null;
const text=(value:unknown,max=160)=>typeof value==='string'?value.slice(0,max):'';
const id=(value:unknown)=>typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value)?value:'';
const receiptNote='Saved operation receipt; it does not establish the current publication state. Open the publishing desk to read current content.';
function excerpt(value:unknown){
 if(!Array.isArray(value))return 'The body cannot be displayed here. Open the publishing desk to inspect it.';
 const paragraphs:string[]=[];let omitted=false,shortened=false;
 for(const entry of value.slice(0,30)){
  const block=record(entry);
  if(block?._type!=='block'||!Array.isArray(block.children)){omitted=true;continue;}
  const spans=block.children.slice(0,100).map(record);if(block.children.length>100)shortened=true;
  if(spans.some(span=>typeof span?.text==='string'&&span.text.length>8000))shortened=true;
  if(spans.some(span=>span?._type!=='span'||typeof span.text!=='string'))omitted=true;
  paragraphs.push(spans.filter(span=>span?._type==='span'&&typeof span.text==='string').map(span=>text(span!.text,8000)).join(''));
 }
 const content=paragraphs.join('\n\n');
 return content.slice(0,8000)+(shortened||content.length>8000||value.length>30?'\n\n[Content shortened for Chat.]':'')+(omitted?'\n\n[Some non-text content is omitted. Open the publishing desk to inspect the full content.]':'');
}
/** Present only known result fields; never dump provider objects or unknown metadata. */
export function describeCMSContent(result:unknown):string{
 // Review descriptions are already authored by the server's review handlers.
 if(typeof result==='string')return result;
 if(Array.isArray(result)){
  if(!result.length)return 'No saved content or requests were found.';
  const lines=result.slice(0,100).map(value=>{
   const row=record(value);if(!row||!id(row.id))return 'An entry could not be displayed.';
   if('draft_request_id' in row){const state=row.withdrawn?'Taken offline':row.status==='published'?'Publication recorded':row.status==='approved'?'Approved; outcome needs checking':row.status==='pending'?'Awaiting your approval':'Review closed';return `${text(row.title)||'Untitled article'} · ${state}\nPublication review: ${row.id}\nContent request: ${id(row.draft_request_id)}`;}
   if('result' in row)return `Edit ${row.result?'confirmed':'needs checking'}\nEdit request: ${row.id}`;
   return `${row.collection==='pages'?'Page':'Post'} · ${row.item_id?'Saved':'Outcome needs checking'}${typeof row.created_at==='string'?' · '+row.created_at.slice(0,10):''}\nContent request: ${row.id}`;
  });
  return 'Saved CMS content and requests\n\n'+lines.join('\n\n')+(result.length>100?'\n\nMore entries are available in the publishing desk.':'')+'\n\nOpen the publishing desk to inspect current content. Unconfirmed requests should be recovered before creating replacements.';
 }
 const value=record(result);if(!value)return 'The CMS result could not be displayed. Check the existing request before trying again.';
 if(Array.isArray(value.items)&&typeof value.page==='number'&&typeof value.total==='number')return `CMS media · ${value.total} stored files · Page ${value.page}\n\n`+value.items.map(v=>{const item=record(v);return `${text(item?.filename,255)} · ${text(item?.mimeType,100)}`;}).join('\n')+(value.hasMore?`\n\nAsk for saved images page ${value.page+1} in project ${id(value.projectId)}.`:'')+'\n\nMetadata only. File upload and article-image insertion are not available yet.';
 const request=id(value.requestId),project=id(value.projectId);
 const references=[project?'Project: '+project:'',request?'Content request: '+request:''].filter(Boolean).join('\n');
 if(typeof value.preview==='string')return 'Private preview is ready. Open the preview button below; signing in is required. It loads the latest saved draft.\n\n'+references;
 const item=record(value.item);
 if(item){
  const data=record(item.data),staged=!!item.draftRevisionId;
  const status=item.status==='published'?(staged?'Private edits to a published article. These edits have not been published.':'Saved CMS content with published status. Check its publication review for public availability.'):item.status==='draft'?'Private draft. This read does not publish it.':'Saved CMS content. Publication status is unavailable.';
  return `${text(data?.title,100)||'Untitled content'}\n${status}${editableCMS(value)?'':'\nThis content cannot be safely changed by the plain-text editor. Use the publishing desk’s formatting tools when available, or preview/download to preserve it.'}\n\n${excerpt(data?.content)}\n\n${references}${typeof value.revision==='string'?'\nRevision: '+text(value.revision,256):''}`;
 }
 if(id(value.editRequestId))return `Your edit was saved privately. This operation did not change the public article.\n\n${references}\nEdit request: ${id(value.editRequestId)}${typeof value.revision==='string'?'\nRevision: '+text(value.revision,256):''}\n\n${receiptNote}`;
 if(request&&typeof value.itemId==='string'&&value.status==='draft')return `Your private ${value.collection==='pages'?'page':'post'} was saved. Review it before publishing.\n\n${references}\n\n${receiptNote}`;
 return 'The CMS result could not be displayed. Check the existing request in the publishing desk before trying again.';
}
