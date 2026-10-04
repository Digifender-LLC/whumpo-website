import {chatLocationId,type ChatLocation} from './chat-location';
/** URL values are locators only; ambiguous or repeated targets are refused. */
export function chatLocationTarget(search:string):ChatLocation|null{
 const params=new URLSearchParams(search),kinds=(['interaction','turn'] as const).filter(kind=>params.has(kind));
 if(kinds.length!==1)return null;
 const kind=kinds[0],values=params.getAll(kind);
 return values.length===1&&chatLocationId(values[0])?{kind,id:values[0]}:null;
}
/** Callback query text never supplies a destination or a success assertion. */
export function providerReturn(search:string):{view:'chat'|'connections'|'billing';notice:string;interactionId?:string}|undefined{
 const params=new URLSearchParams(search);
 if(params.has('connection')){
  const target=chatLocationTarget(search),id=target?.kind==='interaction'?target.id:null,known=params.get('connection')==='github'||params.get('connection')==='cloudflare';
  const interactionId=known&&id?id:undefined;
  return {view:interactionId?'chat':'connections',...(interactionId?{interactionId}:{}),notice:params.has('connection_error')||params.has('error')?'Authorization needs a status check. Your saved connection may be unchanged or its outcome unconfirmed.':'Checking the latest connection status…'};
 }
 if(params.has('checkout'))return {view:'billing',notice:params.get('checkout')==='canceled'?'Checkout was canceled. Check your latest balance here.':'Checking your latest balance…'};
}
/** One strict project locator, accepted only when the current owned-project
 * read lists it. `stale` marks a link the current account cannot use. */
export function selectedProject(search:string,projects:readonly {id:string}[]|undefined):{project:string;stale:boolean}{
 const values=new URLSearchParams(search).getAll('project');if(!values.length)return {project:'',stale:false};
 const value=values.length===1&&chatLocationId(values[0])?values[0]:null;
 if(!projects)return {project:'',stale:!value};
 return value&&projects.some(project=>project.id===value)?{project:value,stale:false}:{project:'',stale:true};
}
