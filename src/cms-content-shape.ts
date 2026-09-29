// First content profile: native portable-text paragraphs, without HTML or embedded code.
export const cmsItemId=/^[0-9A-HJKMNP-TV-Z]{26}$/;
export function cmsDraftBody(title:unknown,text:unknown){
 if(typeof title!=='string'||!title.trim()||title.length>100||typeof text!=='string'||!text.trim()||new TextEncoder().encode(text).length>2400)throw new Error('Use a title of 1–100 characters and body text up to 2400 UTF-8 bytes');
 const body={status:'draft',data:{title,content:[{_type:'block',_key:'paragraph',style:'normal',markDefs:[],children:[{_type:'span',_key:'text',text,marks:[]}]}]}};
 if(new TextEncoder().encode(JSON.stringify(body)).length>4096)throw new Error('Encoded CMS draft exceeds 4096 bytes');
 return body;
}
export function validCMSDraft(body:string){try{const value=JSON.parse(body),text=value?.data?.content?.[0]?.children?.[0]?.text;return JSON.stringify(value)===JSON.stringify(cmsDraftBody(value?.data?.title,text));}catch{return false;}}
export function cmsEditBody(title:unknown,text:unknown,revision:unknown){
 if(typeof revision!=='string'||!/^[A-Za-z0-9+/=_-]{4,256}$/.test(revision))throw new Error('Read the draft and use its current revision token');
 const body={...cmsDraftBody(title,text),_rev:revision};
 if(new TextEncoder().encode(JSON.stringify(body)).length>4096)throw new Error('Encoded CMS edit exceeds 4096 bytes');
 return body;
}
// Omitting status is essential: EmDash stages revision data without changing live metadata.
export function cmsStagedEditBody(title:unknown,text:unknown,revision:unknown){
 const {status,...body}=cmsEditBody(title,text,revision);return body;
}
export function validCMSEdit(body:string){try{const v=JSON.parse(body);return [cmsEditBody,cmsStagedEditBody].some(shape=>JSON.stringify(v)===JSON.stringify(shape(v?.data?.title,v?.data?.content?.[0]?.children?.[0]?.text,v?._rev)));}catch{return false;}}
