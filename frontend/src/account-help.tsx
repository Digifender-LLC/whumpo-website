import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Link} from '@tanstack/react-router';
import {ArrowLeft,LifeBuoy} from 'lucide-react';
import {Brand} from './components/brand';
import {Button} from './components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from './components/ui/dialog';
import {IdentitySecurity} from './identity/flow';

const HelpContext=createContext<{open:boolean;show:(trigger:HTMLButtonElement)=>void}|null>(null);
export function AccountHelp(){
 const help=useContext(HelpContext);if(!help)throw Error('Account help needs the current identity workspace.');
 return <Button data-account-help aria-haspopup="dialog" aria-expanded={help.open} variant="ghost" className="min-h-11 shrink-0" onClick={event=>help.show(event.currentTarget)}><LifeBuoy className="size-4"/>Account help</Button>;
}
/** One host outside profile/welcome/Chat reads. Their completion cannot close
 * the panel; identity changes still unmount it with the workspace authority. */
export function AccountHelpProvider({children}:{children:ReactNode}){
 const [open,setOpen]=useState(false),heading=useRef<HTMLHeadingElement>(null),opener=useRef<HTMLButtonElement|null>(null);
 function returnFocus(){
  const target=opener.current?.isConnected?opener.current:document.querySelector<HTMLElement>('button[data-account-help]')??document.querySelector<HTMLElement>('main [tabindex="-1"]')??document.querySelector<HTMLElement>('main h1,main');
  if(target){if(!target.hasAttribute('tabindex')&&!target.matches('button,a,input'))target.tabIndex=-1;target.focus();}
 }
 return <HelpContext.Provider value={{open,show:trigger=>{opener.current=trigger;setOpen(true);}}}><Dialog open={open} onOpenChange={setOpen}>
  {children}
  <DialogContent onOpenAutoFocus={event=>{event.preventDefault();heading.current?.focus();}} onCloseAutoFocus={event=>{event.preventDefault();returnFocus();}} className="account-help-dialog max-w-2xl max-h-[90dvh] flex flex-col p-5 sm:p-7 [&>button:last-child]:size-11 [&>button:last-child]:grid [&>button:last-child]:place-items-center [&>button:last-child]:right-2 [&>button:last-child]:top-2">
   <DialogHeader className="pr-10 text-left shrink-0"><DialogTitle ref={heading} tabIndex={-1}>Account help</DialogTitle><DialogDescription className="[.phone-keyboard_&]:sr-only">Manage your passkeys, recovery kit or sign-in. Closing this panel keeps your unsaved answer in place.</DialogDescription></DialogHeader>
   <div className="min-h-0 overflow-y-auto overscroll-contain space-y-6 pr-1">
    <p className="text-sm text-muted-foreground">Support works without Chat and promises no response time. Never share your recovery key in Chat or with support.</p>
    <div className="flex flex-wrap gap-3"><Button asChild variant="outline" className="min-h-11 h-auto whitespace-normal"><Link to="/workspace/$view" params={{view:'safety'}} search={{}} onClick={()=>setOpen(false)}>Site & app safety</Link></Button><Button asChild variant="outline" className="min-h-11 h-auto whitespace-normal"><Link to="/workspace/$view" params={{view:'saved-work'}} search={{}} onClick={()=>setOpen(false)}>Saved work</Link></Button><Button asChild variant="outline" className="min-h-11 h-auto whitespace-normal"><Link to="/workspace/$view" params={{view:'support'}} search={{}} onClick={()=>setOpen(false)}>Get support</Link></Button></div>
    {open&&<IdentitySecurity/>}
   </div>
  </DialogContent>
 </Dialog></HelpContext.Provider>;
}

/** This route needs identity only: a failed profile or unfinished welcome must
 * never block the owner's account recovery or sign-out controls. */
export function AccountSecurityPage(){
 const content=useRef<HTMLDivElement>(null);
 useEffect(()=>{document.title='Account security — Whumpo';if(document.activeElement===document.body)content.current?.querySelector<HTMLElement>('[data-identity-step]')?.focus();},[]);
 return <main className="min-h-dvh bg-background px-5 py-6 sm:px-8 sm:py-9"><div className="mx-auto max-w-xl space-y-7">
  <Brand/>
  <Button variant="ghost" asChild className="min-h-11"><Link to="/workspace" search={{signup:false}}><ArrowLeft className="size-4"/>Back to Whumpo</Link></Button>
  <div ref={content}><IdentitySecurity/></div>
 </div></main>;
}
