/** Bounded, deterministic JSON. Never invokes accessors or toJSON hooks. */
export class SpecificationError extends Error {
 constructor(readonly code:string,readonly path='request'){super(`${code}: ${path}`);}
}
export function requireSpec(condition:unknown,code:string,path:string):asserts condition {
 if(!condition)throw new SpecificationError(code,path);
}
export function plain(value:unknown):value is Record<string,unknown> {
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
}
export function shape(value:unknown,keys:readonly string[],path='request'):asserts value is Record<string,unknown> {
 requireSpec(plain(value),'INVALID_SHAPE',path);
 requireSpec(Object.keys(value).every(key=>keys.includes(key)),'UNKNOWN_FIELD',path);
 requireSpec(keys.every(key=>Object.hasOwn(value,key)),'MISSING_FIELD',path);
}
export function canonicalJSON(value:unknown,maxBytes=32768):string {
 const encoder=new TextEncoder(),parts:string[]=[];
 let bytes=0;
 function add(part:string){bytes+=encoder.encode(part).length;requireSpec(bytes<=maxBytes,'INPUT_TOO_LARGE','json');parts.push(part);}
 function visit(item:unknown,depth:number){
  requireSpec(depth<=32,'INPUT_TOO_DEEP','json');
  if(item===null||typeof item==='boolean'){add(JSON.stringify(item));return;}
  if(typeof item==='string'){requireSpec(item.length<=maxBytes,'INPUT_TOO_LARGE','json');add(JSON.stringify(item));return;}
  if(typeof item==='number'){requireSpec(Number.isFinite(item),'INVALID_NUMBER','json');add(JSON.stringify(item));return;}
  requireSpec(Array.isArray(item)||plain(item),'INVALID_SHAPE','json');
  const descriptors=Object.getOwnPropertyDescriptors(item);
  requireSpec(Reflect.ownKeys(item).length<=maxBytes,'INPUT_TOO_LARGE','json');
  requireSpec(Reflect.ownKeys(item).every(key=>typeof key==='string'&&Object.hasOwn(descriptors[key],'value')&&(key==='length'&&Array.isArray(item)||descriptors[key].enumerable)),'INVALID_SHAPE','json');
  if(Array.isArray(item)){
   requireSpec(item.length<=maxBytes,'INPUT_TOO_LARGE','json');
   requireSpec(Object.keys(descriptors).length===item.length+1,'INVALID_SHAPE','json');
   add('[');
   for(let i=0;i<item.length;i++){requireSpec(Object.hasOwn(descriptors,String(i)),'INVALID_SHAPE','json');if(i)add(',');visit(descriptors[String(i)].value,depth+1);}
   add(']');return;
  }
  add('{');const keys=Object.keys(descriptors).sort();
  for(let i=0;i<keys.length;i++){
   const key=keys[i];requireSpec(key.length<=maxBytes,'INPUT_TOO_LARGE','json');
   if(i)add(',');add(JSON.stringify(key));add(':');visit(descriptors[key].value,depth+1);
  }
  add('}');
 }
 visit(value,0);return parts.join('');
}
export function copyJSON<T>(value:T,maxBytes=32768):T{return JSON.parse(canonicalJSON(value,maxBytes)) as T;}
export async function sha256(text:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export const jsonDigest=(value:unknown,maxBytes=32768)=>sha256(canonicalJSON(value,maxBytes));
