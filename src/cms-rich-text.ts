import {CMSProjectError} from './cms-projects';
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
export const escapeCMS=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const unsupported=()=>new CMSProjectError(409,'This draft needs a richer preview renderer');
const decorators:Record<string,string>={strong:'strong',em:'em',underline:'u','strike-through':'s',code:'code'};
function linkURL(value:unknown){
 if(typeof value!=='string'||value.length>2048||/[\s\\\x00-\x1f\x7f]/.test(value))throw unsupported();
 if(value.startsWith('/')&&!value.startsWith('//')||/^#[A-Za-z0-9_-]+$/.test(value))return value;
 let url:URL;try{url=new URL(value);}catch{throw unsupported();}
 if(!['https:','http:','mailto:'].includes(url.protocol)||url.username||url.password)throw unsupported();
 return value;
}
/** Render the supported native Portable Text subset without accepting customer HTML. */
export function renderCMSRichText(value:unknown){
 if(!Array.isArray(value)||value.length>30||new TextEncoder().encode(JSON.stringify(value)).length>12000)throw unsupported();
 let textBytes=0;
 const blocks=value.map(raw=>{
  const b=record(raw);if(b?._type!=='block'||!Array.isArray(b.children)||b.children.length>100||!Array.isArray(b.markDefs)||b.markDefs.length>20)throw unsupported();
  const style=b.style??'normal';if(typeof style!=='string'||!['normal','h1','h2','h3','h4','h5','h6','blockquote'].includes(style))throw unsupported();
  // Alignment and other extensions need explicit rendering support, never silent removal.
  if(Object.keys(b).some(k=>!['_type','_key','style','children','markDefs','listItem','level'].includes(k)))throw unsupported();
  const definitions=new Map<string,string>();
  for(const rawDef of b.markDefs){const def=record(rawDef);if(def?._type!=='link'||typeof def._key!=='string'||definitions.has(def._key)||Object.hasOwn(decorators,def._key)||Object.keys(def).some(k=>!['_type','_key','href'].includes(k)))throw unsupported();definitions.set(def._key,linkURL(def.href));}
  const html=b.children.map(rawSpan=>{
   const span=record(rawSpan);if(span?._type!=='span'||typeof span.text!=='string'||!Array.isArray(span.marks)||span.marks.length>6||Object.keys(span).some(k=>!['_type','_key','text','marks'].includes(k)))throw unsupported();
   textBytes+=new TextEncoder().encode(span.text).length;if(textBytes>2400)throw new CMSProjectError(409,'This draft exceeds the current preview profile');
   let content=escapeCMS(span.text),linked=false;const seen=new Set<string>();
   for(const mark of span.marks){if(typeof mark!=='string'||seen.has(mark))throw unsupported();seen.add(mark);if(Object.hasOwn(decorators,mark)){const tag=decorators[mark];content=`<${tag}>${content}</${tag}>`;}else if(definitions.has(mark)&&!linked){content=`<a href="${escapeCMS(definitions.get(mark)!)}" rel="noopener noreferrer">${content}</a>`;linked=true;}else throw unsupported();}
   return content;
  }).join('');
  if(b.listItem!==undefined){if(!['bullet','number'].includes(String(b.listItem))||!Number.isInteger(b.level??1)||Number(b.level??1)<1||Number(b.level??1)>6||style!=='normal')throw unsupported();return {html,list:String(b.listItem),level:Number(b.level??1),tag:'p'};}
  if(b.level!==undefined)throw unsupported();
  return {html,list:'',level:0,tag:style==='normal'?'p':style};
 });
 let position=0;
 function list(level:number,kind:string):string{
  const tag=kind==='bullet'?'ul':'ol';let result=`<${tag}>`;
  while(position<blocks.length&&blocks[position].level===level&&blocks[position].list===kind){
   result+='<li>'+blocks[position++].html;
   while(position<blocks.length&&blocks[position].level>level){if(blocks[position].level!==level+1)throw unsupported();result+=list(level+1,blocks[position].list);}
   result+='</li>';
  }
  return result+`</${tag}>`;
 }
 let html='';while(position<blocks.length){const b=blocks[position];if(b.list){if(b.level!==1)throw unsupported();html+=list(1,b.list);}else{html+=`<${b.tag}>${b.html}</${b.tag}>`;position++;}}
 if(new TextEncoder().encode(html).length>24000)throw new CMSProjectError(409,'This draft exceeds the current preview profile');
 return html;
}
