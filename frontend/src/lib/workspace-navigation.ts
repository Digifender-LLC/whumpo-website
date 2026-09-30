import {findWorkspacePage,type WorkspaceNavigation} from '../../../src/workspace-navigation';
type Page={id:string;label:string};
/** Callback query text never supplies a destination or a success assertion. */
export function providerReturn(search:string):{view:'connections'|'billing';notice:string}|undefined{
 const params=new URLSearchParams(search);
 if(params.has('connection'))return {view:'connections',notice:params.has('connection_error')||params.has('error')?'The connection was not completed. You can try again here.':'Checking the latest connection status…'};
 if(params.has('checkout'))return {view:'billing',notice:params.get('checkout')==='canceled'?'Checkout was canceled. Check your latest balance here.':'Checking your latest balance…'};
}
/** Load dynamic destinations freshly; static controls require no account-data read. */
export async function resolveWorkspaceNavigation(destination:WorkspaceNavigation,loadPages:()=>Promise<Page[]>):Promise<{view:string;notice?:never;clear:true}|{view?:never;notice:string;clear:boolean}>{
 if(destination.view!=='page'&&destination.view!=='pages')return {view:destination.view==='appearance'?'settings':destination.view,clear:true};
 const pages=await loadPages();
 if(destination.view==='pages')return {notice:pages.length?'Your pages: '+pages.map(page=>page.label).join(', '):'Ask Whumpo to build a custom page around your workflow.',clear:true};
 const page='label' in destination?findWorkspacePage(pages,destination.label):undefined;
 return page?{view:page.id,clear:true}:{notice:'Choose one unique page name from Your pages.',clear:false};
}
