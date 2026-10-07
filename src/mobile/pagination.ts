import {hashToken} from '../security';
import {MobileError} from './protocol';
/** A cursor is a position, never authority. Its scope binds the owner, route and search.
 * Every page still repeats owner predicates in the admitted database transaction. */
export async function pageQuery(url:URL,user:string,search=false){
 const params=url.searchParams;
 if([...params.keys()].some(k=>!['limit','cursor',...(search?['q']:[])].includes(k)||params.getAll(k).length!==1))throw new MobileError('invalid_request');
 const value=params.get('limit')??'25',query=params.get('q')??'';
 if(!/^(?:[1-9]|[1-4][0-9]|50)$/.test(value)||query.length>100||/[\x00-\x1f\x7f]/.test(query))throw new MobileError('invalid_request');
 const scope=await hashToken(JSON.stringify([user,url.pathname,query])),encoded=params.get('cursor');let position:unknown=null;
 if(encoded!==null){
  try{
   if(!/^[A-Za-z0-9_-]{1,256}$/.test(encoded))throw Error();
   const raw=atob(encoded.replace(/-/g,'+').replace(/_/g,'/')),data=JSON.parse(raw);
   if(!Array.isArray(data)||data.length!==2||data[0]!==scope)throw Error();position=data[1];
  }catch{throw new MobileError('invalid_cursor');}
 }
 return {limit:Number(value),query,position,cursor:(next:unknown)=>btoa(JSON.stringify([scope,next])).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
}
export function tuplePosition(value:unknown,activity=false):[string,string]|null{
 if(value===null)return null;
 if(!Array.isArray(value)||value.length!==2||typeof value[0]!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value[0])||!Number.isFinite(Date.parse(value[0]))||typeof value[1]!=='string'||!(activity?/^[A-Za-z0-9:_-]{1,80}$/:/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/).test(value[1]))throw new MobileError('invalid_cursor');
 return value as [string,string];
}
