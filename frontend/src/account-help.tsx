import {ReturnLink} from './navigation-links';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {Link} from '@tanstack/react-router';
import {LifeBuoy,LogOut} from 'lucide-react';
import {Brand} from './components/brand';
import {Button} from './components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from './components/ui/dialog';
import {IdentitySecurity,useSignOut} from './identity/flow';

/** Workspace sign-out through the shared identity controller; never a page-local adapter. */
export function SignOutButton({className}:{className?:string}){
 const {busy,error,signOut}=useSignOut();
 return <><Button type="button" variant="secondary" className={className??'min-h-11 h-auto whitespace-normal'} disabled={busy} onClick={()=>void signOut()}><LogOut className="size-4 shrink-0"/>Sign out</Button>{error&&<p role="alert" className="text-body-sm">{error}</p>}</>;
}
const HelpContext=createContext<{open:boolean;show:(trigger:HTMLButtonElement)=>void}|null>(null);
export function AccountHelp(){
 const help=useContext(HelpContext);if(!help)throw Error('Account help needs the current identity workspace.');
 return <Button data-account-help aria-haspopup="dialog" aria-expanded={help.open} variant="quiet" className="min-h-11 shrink-0" onClick={event=>help.show(event.currentTarget)}><LifeBuoy className="size-4"/>Account help</Button>;
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
    <p className="text-body-sm text-ink-muted">Support works without Chat. We reply on business days. Never share your recovery key in Chat or with support.</p>
    <div className="flex flex-wrap gap-3"><Button asChild variant="secondary" className="min-h-11 h-auto whitespace-normal"><Link to="/workspace/$view" params={{view:'safety'}} search={{}} onClick={()=>setOpen(false)}>Site & app safety</Link></Button><Button asChild variant="secondary" className="min-h-11 h-auto whitespace-normal"><Link to="/workspace/$view" params={{view:'saved-work'}} search={{}} onClick={()=>setOpen(false)}>Saved work</Link></Button><Button asChild variant="secondary" className="min-h-11 h-auto whitespace-normal"><Link to="/workspace/$view" params={{view:'support'}} search={{}} onClick={()=>setOpen(false)}>Get support</Link></Button></div>
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
 return <main className="min-h-dvh bg-surface px-5 py-6 sm:px-8 sm:py-9"><div className="mx-auto max-w-xl space-y-7">
  <Brand/>
  <ReturnLink/>
  <div ref={content}><IdentitySecurity/></div>
  <section aria-labelledby="account-data-link" className="space-y-2 border-t border-line pt-6"><h2 id="account-data-link" className="text-lg font-semibold">Account data and closure</h2><p className="text-body-sm text-ink-muted">Download a private copy of your data or close your account. Each step asks for a recent passkey check.</p><Button asChild variant="secondary" className="min-h-11 h-auto whitespace-normal"><Link to="/workspace/$view" params={{view:'account'}} search={{}}>Export or close account</Link></Button></section>
 </div></main>;
}
