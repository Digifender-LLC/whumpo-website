// Navigation is deterministic and free. Never infer a mutation from a request
// to open a page, and never intercept a longer task that merely mentions it.
export type WorkspaceDestination='chat'|'dashboard'|'settings'|'profile'|'billing'|'appearance'|'pages'|'cms'|'connections'|'domains'|'photos'|'inbox'|'security'|'visitors';
export type WorkspaceNavigation={view:WorkspaceDestination}|{view:'page';label:string};
export function workspaceNavigation(input:string):WorkspaceNavigation|undefined{
 const value=input.trim().replace(/\s+/g,' ').toLowerCase();
 const aliases:Record<string,WorkspaceDestination>={connections:'connections','external connections':'connections','connected accounts':'connections','github connection':'connections','cloudflare connection':'connections',domains:'domains','domain settings':'domains',photos:'photos','project photos':'photos',files:'photos',inbox:'inbox','contact inbox':'inbox',security:'security',passkeys:'security','sign-in security':'security','visitor access':'visitors',visitors:'visitors',publishing:'cms','publishing desk':'cms','cms dashboard':'cms',chat:'chat',dashboard:'dashboard',settings:'settings',profile:'profile',billing:'billing',appearance:'appearance',pages:'pages','custom pages':'pages','billing settings':'billing','usage details':'billing','theme settings':'appearance','site settings':'settings','account settings':'profile'};
 const command=value.match(/^\/(chat|dashboard|settings|profile|billing|appearance|pages|publishing)$/);
 if(command)return {view:aliases[command[1]]};
 const phrase=value.match(/^(?:open|show|go to)(?: my| the)? (.+?)[.!?]?$/);
 if(phrase&&Object.hasOwn(aliases,phrase[1]))return {view:aliases[phrase[1]]};
 const page=input.trim().match(/^\/page\s+(.{1,40})$/i)??input.trim().match(/^(?:open|show|go to)(?: my| the)? (?:page|tab)\s+(.{1,40})$/i);
 if(page)return {view:'page',label:page[1].trim()};
}
export function findWorkspacePage(tabs:{id:string;label:string}[],label:string){
 const matches=tabs.filter(tab=>tab.label.trim().toLowerCase()===label.trim().toLowerCase());
 return matches.length===1?matches[0]:undefined;
}
export const workspaceNavigationHelp='Open Chat, Dashboard, Settings or Profile from the sidebar. In chat, use /chat, /dashboard, /settings, /profile, /appearance, /billing or /publishing. /pages lists custom pages; /page PAGE_NAME opens one in the workspace. These navigation commands use no AI units. Profile holds personal details and sign-in security; Settings holds appearance, billing, usage and external connections. Say “open my domains”, “open project photos”, “open contact inbox”, “open external connections”, “open passkeys” or “open visitor access” to reach those controls. Opening a page changes no settings.';
