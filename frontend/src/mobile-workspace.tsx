import {QueryRecovery} from './query-recovery';
import {useEffect,useState} from 'react';
import {Link,useRouterState} from '@tanstack/react-router';
import {MessageCircle,LayoutDashboard,PanelsTopLeft,Settings,ArrowRight} from 'lucide-react';
import {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription} from './components/ui/dialog';
import {useWorkspace} from './workspace';

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
export function MobileNavigation({view,avatar}:{view:string;avatar:string}){
 const {dashboard,dashboardRead}=useWorkspace();const [pages,setPages]=useState(false);
 const section=['billing','connections'].includes(view)?'settings':view==='security'?'profile':['cms','project','photos','inbox','domains','visitors'].includes(view)?'dashboard':view;
 const pathname=useRouterState({select:s=>s.location.pathname});useEffect(()=>setPages(false),[pathname]);
 return <Dialog open={pages} onOpenChange={setPages}><nav className="mobile-navigation" aria-label="Mobile workspace"><Link activeOptions={{exact:true}} to="/workspace" search={{signup:false}} aria-current={view==='chat'?'page':undefined}><MessageCircle/><span>Chat</span></Link><Link to="/workspace/$view" params={{view:'dashboard'}} aria-current={section==='dashboard'?'page':undefined}><LayoutDashboard/><span>Dashboard</span></Link><DialogTrigger asChild><button aria-label="Your pages" data-active={view.startsWith('tab-')||undefined}><PanelsTopLeft/><span>Your pages</span></button></DialogTrigger><Link to="/workspace/$view" params={{view:'settings'}} aria-current={section==='settings'?'page':undefined}><Settings/><span>Settings</span></Link><Link to="/workspace/$view" params={{view:'profile'}} aria-current={section==='profile'?'page':undefined}><img src={avatar} alt=""/><span>Profile</span></Link></nav><DialogContent data-recovery-surface tabIndex={-1} className="mobile-pages-sheet"><DialogTitle>Your pages</DialogTitle><DialogDescription>A workspace that grows around what you do.</DialogDescription><div className="space-y-2"><QueryRecovery name="pages" {...dashboardRead} hasData={!!dashboard}/>{!dashboard?null:dashboard.layout.tabs.length?dashboard.layout.tabs.map(tab=><Link key={tab.id} to="/workspace/$view" params={{view:tab.id}} onClick={()=>setPages(false)} className="flex min-h-14 items-center justify-between gap-4 rounded-xl border px-4 font-medium"><span>{tab.label}</span><ArrowRight className="size-4 shrink-0"/></Link>):<div className="rounded-2xl bg-secondary p-5"><p className="font-semibold">A page made for your work.</p><p className="text-sm text-muted-foreground mt-2">Ask Whumpo to build a custom page around your workflow.</p><Link to="/workspace" search={{signup:false}} onClick={()=>setPages(false)} className="mt-3 inline-flex min-h-12 items-center gap-3 font-semibold">Back to Chat <ArrowRight className="size-4"/></Link></div>}</div></DialogContent></Dialog>;
}
