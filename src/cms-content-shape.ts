import {validateCMSRichContent} from './cms-rich-text';
// One current Portable Text body contract for new writes and exact request recovery.
export const cmsItemId=/^[0-9A-HJKMNP-TV-Z]{26}$/;
export function cmsDraftBody(title:unknown,text:unknown){
 if(typeof title!=='string'||!title.trim()||title.length>100||typeof text!=='string'||!text.trim()||new TextEncoder().encode(text).length>2400)throw new Error('Use a title of 1–100 characters and body text up to 2400 UTF-8 bytes');
 const body={status:'draft',data:{title,content:[{_type:'block',_key:'paragraph',style:'normal',markDefs:[],children:[{_type:'span',_key:'text',text,marks:[]}]}]}};
 if(new TextEncoder().encode(JSON.stringify(body)).length>4096)throw new Error('Encoded CMS draft exceeds 4096 bytes');
 return body;
}
export function validCMSDraft(body:string){try{const value=JSON.parse(body);return JSON.stringify(value)===JSON.stringify(cmsRichDraftBody(value?.data?.title,value?.data?.content,value?.data?.excerpt));}catch{return false;}}
// Both input modes produce the current staged body. Status is never part of an edit.
export function cmsStagedEditBody(title:unknown,text:unknown,revision:unknown){
 return cmsRichEditBody(title,cmsDraftBody(title,text).data.content,revision);
}
export function validCMSEdit(body:string){
 try{const v=JSON.parse(body);return JSON.stringify(v)===JSON.stringify(cmsRichEditBody(v?.data?.title,v?.data?.content,v?._rev));}catch{return false;}
}
/** Explicit complete Portable Text replacement; callers must preserve unrequested content. */
export function cmsRichDraftBody(title:unknown,content:unknown,excerpt?:unknown){
 if(typeof title!=='string'||!title.trim()||title.length>100)throw new Error('Use a title of 1–100 characters');
 validateCMSRichContent(content);
 if(!(content as {_type:string;children?:{text:string}[]}[]).some(block=>block._type==='block'&&block.children?.some(span=>span.text.trim())))throw new Error('Provide article text');
 if(excerpt!==undefined&&(typeof excerpt!=='string'||excerpt.length>512))throw new Error('Use an excerpt up to 512 characters');
 const body={status:'draft',data:{title,content,...(excerpt===undefined?{}:{excerpt:excerpt as string})}};
 if(new TextEncoder().encode(JSON.stringify(body)).length>4096)throw new Error('Encoded CMS draft exceeds 4096 bytes');
 return body;
}
export function cmsRichEditBody(title:unknown,content:unknown,revision:unknown){
 if(typeof revision!=='string'||!/^[A-Za-z0-9+/=_-]{4,256}$/.test(revision))throw new Error('Read the draft and use its current revision token');
 const {data}=cmsRichDraftBody(title,content),body={data,_rev:revision};
 if(new TextEncoder().encode(JSON.stringify(body)).length>4096)throw new Error('Encoded CMS edit exceeds 4096 bytes');
 return body;
}
