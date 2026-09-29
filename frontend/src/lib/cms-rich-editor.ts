import {renderCMSRichText} from '../../../src/cms-rich-text';
export type RichSpan={_type:'span';_key?:string;text:string;marks:string[]};
export type RichBlock={_type:'block';_key?:string;style?:string;listItem?:'bullet'|'number';level?:number;markDefs:{_type:'link';_key:string;href:string}[];children:RichSpan[]};
export function richEditable(snapshot:unknown):{title:string;content:RichBlock[]}|null{
 try{
  const s=snapshot as {revision:string;item:{status:string;data:{title:string;content:RichBlock[]}}};
  if(!['draft','published'].includes(s.item.status)||typeof s.revision!=='string'||typeof s.item.data.title!=='string'||s.item.data.title.length>100)return null;
  renderCMSRichText(s.item.data.content);
  if(s.item.data.content.some(b=>b._key!==undefined&&typeof b._key!=='string'||b.children.some(c=>c._key!==undefined&&typeof c._key!=='string')))return null;
  return {title:s.item.data.title,content:structuredClone(s.item.data.content)};
 }catch{return null;}
}
export function newRichBlock():RichBlock{return {_type:'block',_key:crypto.randomUUID(),style:'normal',markDefs:[],children:[{_type:'span',_key:crypto.randomUUID(),text:'',marks:[]}]};}
/** Change a link on this text section only, retaining any definition shared by other sections. */
export function setRichLink(block:RichBlock,index:number,href:string):RichBlock{
 const next=structuredClone(block),span=next.children[index];
 const old=new Set(next.markDefs.map(d=>d._key)),removed=new Set(span.marks.filter(mark=>old.has(mark)));span.marks=span.marks.filter(mark=>!old.has(mark));
 if(href){const key=crypto.randomUUID();next.markDefs.push({_type:'link',_key:key,href});span.marks.push(key);}
 next.markDefs=next.markDefs.filter(d=>!removed.has(d._key)||next.children.some(s=>s.marks.includes(d._key)));
 return next;
}
