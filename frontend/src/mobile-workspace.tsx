import {QueryRecovery} from './query-recovery';
import {useEffect,useState} from 'react';
import {Link,useRouterState} from '@tanstack/react-router';
import {MessageCircle,LayoutDashboard,PanelsTopLeft,Settings,ArrowRight,History,ShieldAlert,LifeBuoy,KeyRound,CircleHelp} from 'lucide-react';
import {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription} from './components/ui/dialog';
import {useWorkspace} from './workspace';
import {SignOutButton} from './account-help';
import {essentialDestinations,navigationSection,pageNavigationLabel,pageAccessibleName,type EssentialView} from './lib/workspace-navigation';

/** Follow the visible viewport so the composer remains above a phone keyboard. */
export function useMobileViewport(){
 useEffect(()=>{
  const viewport=window.visualViewport,media=matchMedia('(max-width: 760px)');
  let resting=window.innerHeight,width=window.innerWidth,keyboard=false;
  const update=()=>{
   if(width!==window.innerWidth){width=window.innerWidth;resting=window.innerHeight;keyboard=false;}
   if(!media.matches){resting=window.innerHeight;keyboard=false;document.documentElement.style.removeProperty('--workspace-height');document.documentElement.style.removeProperty('--workspace-bottom');document.documentElement.classList.remove('phone-keyboard');return;}
   // Pinch zoom changes the visible region, not the workspace layout. Keep its
   // unzoomed geometry so magnification does not move the user's target away.
   if(viewport&&Math.abs(viewport.scale-1)>0.01)return;
   const height=viewport?.height??window.innerHeight;
   const bottom=Math.max(0,window.innerHeight-height-(viewport?.offsetTop??0));
   const editing=document.activeElement instanceof HTMLElement&&document.activeElement.matches('textarea,input:not([type=checkbox]):not([type=radio]):not([type=file]),[contenteditable=true]');
   // Some current browsers resize the layout viewport as well. Retain its
   // resting height until the keyboard closes, including after button focus.
   keyboard=(bottom>120||resting-height>120)&&(editing||keyboard);
   if(!keyboard&&!editing)resting=window.innerHeight;
   document.documentElement.style.setProperty('--workspace-height',height+'px');
   document.documentElement.style.setProperty('--workspace-bottom',bottom+'px');
   // The keyboard can remain visible after focus moves onto a sheet button.
   document.documentElement.classList.toggle('phone-keyboard',keyboard);
  };
  update();viewport?.addEventListener('resize',update);viewport?.addEventListener('scroll',update);window.addEventListener('resize',update);document.addEventListener('focusin',update);document.addEventListener('focusout',update);media.addEventListener('change',update);
  return()=>{viewport?.removeEventListener('resize',update);viewport?.removeEventListener('scroll',update);window.removeEventListener('resize',update);document.removeEventListener('focusin',update);document.removeEventListener('focusout',update);media.removeEventListener('change',update);document.documentElement.style.removeProperty('--workspace-height');document.documentElement.style.removeProperty('--workspace-bottom');document.documentElement.classList.remove('phone-keyboard')};
 },[]);
}
const essentialIcons:Record<EssentialView,typeof History>={'saved-work':History,safety:ShieldAlert,support:LifeBuoy,security:KeyRound};
/** Fixed desktop controls. They never come from the generated layout and stay
 * visible while optional pages scroll in their own region. */
export function EssentialNavigation(){
 return <nav aria-label="Help and account" className="sidebar-essentials shrink-0 flex flex-col gap-1 border-t pt-4 mt-4">
  {essentialDestinations.map(item=>{const Icon=essentialIcons[item.view];return <Link key={item.view} to="/workspace/$view" params={{view:item.view}} search={{}} aria-label={item.label} className="flex gap-3 items-center rounded-md px-3 py-2.5 text-body-sm text-ink transition-colors duration-fast ease-standard hover:bg-action-soft"><Icon className="size-5 shrink-0"/><span className="sidebar-label">{item.label}</span></Link>;})}
  <SignOutButton className="sidebar-sign-out justify-start gap-3 px-3 min-h-11 h-auto whitespace-normal border-0 shadow-none bg-transparent font-normal"/>
 </nav>;
}
export function MobileNavigation({view,avatar}:{view:string;avatar:string}){
 const {dashboard,dashboardRead}=useWorkspace();const [sheet,setSheet]=useState<'pages'|'help'|null>(null);
 const section=navigationSection(view);
 const pathname=useRouterState({select:s=>s.location.pathname});useEffect(()=>setSheet(null),[pathname]);
 return <Dialog open={!!sheet} onOpenChange={open=>{if(!open)setSheet(null);}}><nav className="mobile-navigation" aria-label="Mobile workspace">
  <Link activeOptions={{exact:true}} to="/workspace" search={{signup:false}} aria-current={section==='chat'?'page':undefined}><MessageCircle/><span>Chat</span></Link>
  <Link to="/workspace/$view" params={{view:'dashboard'}} aria-current={section==='dashboard'?'page':undefined}><LayoutDashboard/><span>Dashboard</span></Link>
  <DialogTrigger asChild><button aria-label="Your pages" aria-haspopup="dialog" data-active={section==='pages'||undefined} onClick={()=>setSheet('pages')}><PanelsTopLeft/><span>Your pages</span></button></DialogTrigger>
  <Link to="/workspace/$view" params={{view:'settings'}} aria-current={section==='settings'?'page':undefined}><Settings/><span>Settings</span></Link>
  <DialogTrigger asChild><button aria-label="Help and account" aria-haspopup="dialog" data-active={section==='help'||undefined} onClick={()=>setSheet('help')}><CircleHelp/><span>Help</span></button></DialogTrigger>
 </nav>
 {sheet==='help'?<DialogContent data-recovery-surface tabIndex={-1} className="mobile-pages-sheet"><DialogTitle>Help and account</DialogTitle><DialogDescription>These controls work without Chat or the AI assistant.</DialogDescription><ul className="space-y-2">
  {essentialDestinations.map(item=>{const Icon=essentialIcons[item.view];return <li key={item.view}><Link to="/workspace/$view" params={{view:item.view}} search={{}} onClick={()=>setSheet(null)} className="flex min-h-14 items-center gap-4 rounded-md border px-4 py-2 transition-colors duration-fast ease-standard hover:bg-action-soft data-[status=active]:border-action data-[status=active]:bg-action-soft"><Icon className="size-5 shrink-0"/><span className="min-w-0"><span className="block font-medium">{item.label}</span><span className="block text-body-sm text-ink-muted">{item.hint}</span></span></Link></li>;})}
  <li><Link to="/workspace/$view" params={{view:'profile'}} onClick={()=>setSheet(null)} className="flex min-h-14 items-center gap-4 rounded-md border px-4 py-2 transition-colors duration-fast ease-standard hover:bg-action-soft data-[status=active]:border-action data-[status=active]:bg-action-soft"><img src={avatar} alt="" className="size-6 rounded-full shrink-0"/><span className="font-medium">Your profile</span></Link></li>
  <li><SignOutButton className="w-full min-h-14 h-auto justify-start gap-4 whitespace-normal rounded-md px-4"/></li>
 </ul></DialogContent>
 :<DialogContent data-recovery-surface tabIndex={-1} className="mobile-pages-sheet"><DialogTitle>Your pages</DialogTitle><DialogDescription>Optional pages Whumpo made for your work. Chat can do everything they do.</DialogDescription><div className="space-y-2"><QueryRecovery name="pages" {...dashboardRead} hasData={!!dashboard}/>{!dashboard?null:dashboard.layout.tabs.length?dashboard.layout.tabs.map(tab=><Link key={tab.id} aria-label={pageAccessibleName(tab.label)} to="/workspace/$view" params={{view:tab.id}} onClick={()=>setSheet(null)} className="flex min-h-14 items-center justify-between gap-4 rounded-md border px-4 font-medium transition-colors duration-fast ease-standard hover:bg-action-soft data-[status=active]:border-action data-[status=active]:bg-action-soft"><span>{pageNavigationLabel(tab.label)}</span><ArrowRight className="size-4 shrink-0"/></Link>):<div className="rounded-lg bg-action-soft p-5"><p className="font-semibold">A page made for your work.</p><p className="text-body-sm text-ink-muted mt-2">Ask Whumpo to build a custom page around your workflow.</p><Link to="/workspace" search={{signup:false}} onClick={()=>setSheet(null)} className="mt-3 inline-flex min-h-12 items-center gap-3 font-semibold">Back to Chat <ArrowRight className="size-4"/></Link></div>}</div></DialogContent>}
 </Dialog>;
}
