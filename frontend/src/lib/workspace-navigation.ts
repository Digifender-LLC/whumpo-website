import {parseSupportReference} from '../../../src/support-shape';
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
/** `/workspace` is the only Chat route. `/workspace/chat` is not an alias:
 * superseded paths resolve to `missing`, never to another page. */
export function workspaceView(pathname:string):string{
 const parts=pathname.split('/');
 if(parts[1]!=='workspace'||parts.length>4||parts.length===4&&parts[3]!=='')return 'missing';
 const segment=parts[2]??'';
 return !segment?'chat':segment==='chat'||!/^[a-z][a-z0-9-]{0,47}$/.test(segment)?'missing':segment;
}
/** Fixed, identity-only destinations. They are not part of any generated
 * layout, render without profile/Chat/dashboard reads and need no model. */
export const essentialDestinations=[
 {view:'saved-work',label:'Saved work',hint:'Pending requests, reviews and results'},
 {view:'safety',label:'Site & app safety',hint:'Take a website, backend or app offline'},
 {view:'support',label:'Support',hint:'Ask for help, even when Chat is unavailable'},
 {view:'security',label:'Account & security',hint:'Passkeys, recovery kit and sign-in'},
] as const;
export type EssentialView=typeof essentialDestinations[number]['view'];
/** The bottom bar groups views; essentials and Profile live in one Help sheet. */
export function navigationSection(view:string):'chat'|'dashboard'|'pages'|'settings'|'help'|null{
 if(view==='chat')return 'chat';
 if(view==='dashboard'||['cms','project','photos','inbox','records','domains','visitors'].includes(view))return 'dashboard';
 if(view.startsWith('tab-'))return 'pages';
 if(['settings','billing','connections'].includes(view))return 'settings';
 if(view==='profile'||essentialDestinations.some(item=>item.view===view))return 'help';
 return null;
}
const reservedLabels=new Set(['chat','dashboard','yourpages','pages','settings','help','helpandaccount','profile','yourprofile','signout','accounthelp','skiptoworkspace',...essentialDestinations.map(item=>item.label)].map(label=>normalized(label)));
function normalized(label:string){return label.toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');}
/** A generated page cannot impersonate or shadow a fixed control by name. */
export const pageSuffix='your page';
export function pageNavigationLabel(label:string){return reservedLabels.has(normalized(label))?label+' ('+pageSuffix+')':label;}
/** Screen readers get a comma pause instead of a spoken parenthesis. */
export function pageAccessibleName(label:string){return pageNavigationLabel(label)===label?label:label+', '+pageSuffix;}
const pageless=new Set(['saved-work','safety','support','security','profile','operator-safety','missing']);
let origin='dashboard';
/** Remember the last non-fixed page opened in this tab. A reload or a new tab
 * forgets it and returns to Dashboard. */
export function noteLocation(pathname:string){const view=workspaceView(pathname);if(!pageless.has(view))origin=view;}
/** Where a fixed page returns to: Chat, Settings, an agent page or Dashboard. */
export function returnTarget():{view:string;label:string}{
 const section=navigationSection(origin);
 return origin==='chat'?{view:'chat',label:'Whumpo'}:section==='settings'?{view:'settings',label:'Settings'}:section==='pages'?{view:origin,label:pageSuffix}:{view:'dashboard',label:'Dashboard'};
}
/** Error replies may carry one content-free support link. Only the exact
 * current status shape is accepted; anything else shows no link. */
export function supportReference(value:unknown):string|null{
 if(typeof value!=='string'||!value.startsWith('/workspace/support?'))return null;
 const params=new URLSearchParams(value.slice('/workspace/support?'.length)),refs=params.getAll('ref');
 if([...params.keys()].some(key=>key!=='ref')||refs.length!==1)return null;
 const parsed=parseSupportReference(refs[0]);
 return parsed?.kind==='status'?refs[0]:null;
}
