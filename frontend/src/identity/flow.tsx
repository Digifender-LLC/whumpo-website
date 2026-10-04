import {identityActionFocus} from './focus';
import {resetWorkspaceClient} from '../lib/api';
import {clearChatRecovery,scopeChatRecovery} from '../lib/chat-recovery';
import {fenceIdentityRequests,observeIdentityChanges} from '../lib/identity-invalidation';
import {createContext,useContext,useCallback,useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowRight,KeyRound,ShieldCheck} from 'lucide-react';
import {Button} from '../components/ui/button';
import {Input} from '../components/ui/input';
import {Label} from '../components/ui/label';
import {Brand} from '../components/brand';
import {LegalLinks} from '../legal-links';
import {IdentityKit} from './kit';
import {lockoutContact} from '../../../src/support-shape';
import {IdentityClientError,identityChanged,identityRequest,identityState,identityIntent,identityCeremony,sameIdentityReview,type IdentityState,type PreparedIdentityKit} from '../lib/identity';

function useIdentity(){
 const [state,setState]=useState<IdentityState|null>(null),[loaded,setLoaded]=useState(false),[verified,setVerified]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lastIdentity=useRef<string|null|undefined>(undefined);
 const locked=useRef(false),active=useRef(true),sequence=useRef(0),actionSequence=useRef(0),uncertain=useRef(false),checking=useRef(false);
 const [finishedAction,setFinishedAction]=useState(0),pendingFocus=useRef<{finish:ReturnType<typeof identityActionFocus>;sequence:number}|null>(null);
 useLayoutEffect(()=>{const pending=pendingFocus.current;pendingFocus.current=null;pending?.finish(()=>active.current&&pending.sequence===actionSequence.current);},[finishedAction]);
 const reload=useCallback(async()=>{
  const seq=++sequence.current;checking.current=true;
  try{
   const result=await identityState();
   if(!active.current||seq!==sequence.current)throw identityChanged();
   const identity=result.identity,next=identity?[identity.accountId,identity.purpose,identity.expectedEpoch,identity.attemptId].join(':'):null;
   if(next!==lastIdentity.current){
    fenceIdentityRequests();resetWorkspaceClient();
    if(lastIdentity.current!==undefined||identity?.purpose!=='workspace')clearChatRecovery();
    else scopeChatRecovery(identity.accountId);
    lastIdentity.current=next;
   }
   setState(identity);setLoaded(true);setVerified(true);setError('');uncertain.current=false;
   return identity;
  }catch(error){
   if(active.current&&seq===sequence.current){
    // A failed check cannot keep private panels or current actions on screen.
    // Preserve tab-local drafts until a confirmed identity change or sign-out.
    fenceIdentityRequests();resetWorkspaceClient();setState(null);setLoaded(true);setVerified(false);
    setError(error instanceof Error?error.message:'Account access could not be checked.');
   }
   throw error;
  }finally{if(seq===sequence.current)checking.current=false;}
 },[]);
 async function run(fn:()=>Promise<unknown>,exit=false){
  if(locked.current)return;
  if(uncertain.current&&fn!==reload&&!exit){setError('Check saved progress before continuing. The last change may already be saved.');return;}
  const seq=++actionSequence.current,finishFocus=identityActionFocus();locked.current=true;setBusy(true);setError('');
  try{await fn();}catch(error){if(active.current&&seq===actionSequence.current){if(error instanceof IdentityClientError&&error.code==='uncertain')uncertain.current=true;setError(error instanceof Error?error.message:'This step could not finish. Check saved progress.');}}
  finally{
   if(active.current&&seq===actionSequence.current){
    locked.current=false;pendingFocus.current?.finish(()=>false);pendingFocus.current={finish:finishFocus,sequence:seq};
    setBusy(false);setFinishedAction(value=>value+1);
   }else finishFocus(()=>false);
  }
 }
 useEffect(()=>{
  active.current=true;
  const changed=()=>{
   sequence.current++;actionSequence.current++;locked.current=false;uncertain.current=false;
   resetWorkspaceClient();clearChatRecovery();setState(null);setLoaded(false);setVerified(false);setBusy(false);setError('');
   void reload().catch(()=>{});
  };
  // Focus and visibility can fire together. Rechecking is read-only and does not
  // replace an in-flight ceremony or erase drafts when access is unchanged.
  const recheck=()=>{if(document.visibilityState==='visible'&&!locked.current&&!checking.current)void reload().catch(()=>{});};
  const restored=(event:PageTransitionEvent)=>{if(event.persisted)recheck();};
  window.addEventListener('whumpo:identity-changed',changed);
  window.addEventListener('focus',recheck);document.addEventListener('visibilitychange',recheck);window.addEventListener('pageshow',restored);
  const stop=observeIdentityChanges();void reload().catch(()=>{});
  return()=>{active.current=false;sequence.current++;actionSequence.current++;fenceIdentityRequests();pendingFocus.current?.finish(()=>false);pendingFocus.current=null;stop();window.removeEventListener('whumpo:identity-changed',changed);window.removeEventListener('focus',recheck);document.removeEventListener('visibilitychange',recheck);window.removeEventListener('pageshow',restored);};
 },[reload]);
 return {state,loaded,verified,busy,error,reload,run};
}
type Control=ReturnType<typeof useIdentity>;
const identityViewKey=(state:IdentityState)=>[state.accountId,state.purpose,state.expectedEpoch,state.attemptId].join(':');
const IdentityContext=createContext<Control|null>(null);
function Help(){return <details className="border-t pt-5 text-sm text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Passkeys and recovery help</summary><div className="mt-4 space-y-3"><p>Use two distinct passkeys. A synced copy of the same passkey counts once. For the second, choose a different passkey provider or an optional security key. No hardware purchase is required.</p><p>If a step is interrupted, sign in with a saved passkey to resume. During secured recovery, your saved new kit can also resume progress.</p><p>If the only passkey from unfinished signup is lost, there is no active kit to recover that pending account. Email, invitations, and support cannot unlock it.</p><p>Locked out of an active account? Email <a className="underline text-foreground" href={'mailto:'+lockoutContact}>{lockoutContact}</a>. Email does not replace your passkeys or recovery kit, and no response time is promised. Never send your recovery key.</p></div></details>}
function Status({control:c}:{control:Control}){return <>{c.busy&&<p role="status" className="text-sm text-muted-foreground">One moment…</p>}{c.error&&<div role="alert" data-identity-error tabIndex={-1} className="rounded-md border border-destructive/30 bg-attention-soft p-4 text-sm space-y-3"><p>{c.error}</p><Button variant="secondary" className="h-auto min-h-11 max-w-full whitespace-normal py-2" disabled={c.busy} onClick={()=>void c.run(c.reload)}>Check saved progress</Button></div>}</>}
function Frame({children}:{children:ReactNode}){return <div className="auth-screen min-h-dvh grid lg:grid-cols-2"><section className="p-5 sm:p-10 flex flex-col"><Brand/><main className="max-w-md w-full mx-auto py-10 sm:py-16 space-y-6">{children}<LegalLinks/></main></section><aside className="hero-sky hidden lg:flex items-center justify-center flex-col px-12"><img src="/brand/whumpo-mascot.png" className="max-w-[460px] w-full" alt=""/><h2 className="text-3xl font-bold text-ink mt-8">Your ideas belong here.</h2><p className="text-ink-muted mt-3">Big ideas. Less work.</p></aside></div>}
/** Identity resolves before profile, welcome or workspace components mount. */
export function IdentityGate({children,signup=false}:{children:ReactNode;signup?:boolean}){
 const c=useIdentity(),[initialSignup,setInitialSignup]=useState(signup);
 useEffect(()=>{if(c.state)setInitialSignup(false);},[c.state]);
 if(!c.loaded)return <Frame><p role="status">Checking account access…</p></Frame>;
 if(!c.verified)return <Frame><h1 data-identity-step tabIndex={-1} className="text-3xl font-bold">Let’s check your account access.</h1><p className="text-muted-foreground">Whumpo could not confirm your current sign-in. Your saved work has not been changed. Check again to continue.</p><Status control={c}/><Button variant="secondary" disabled={c.busy} onClick={()=>void c.run(async()=>{clearChatRecovery();await identityRequest('logout');await c.reload();},true)}>Sign out</Button><Help/></Frame>;
 return <IdentityContext.Provider value={c}>{c.state?.purpose==='workspace'?<IdentityWorkspace key={identityViewKey(c.state)}>{children}</IdentityWorkspace>:<Frame>{c.state?<IdentityProgress key={identityViewKey(c.state)} control={c}/>:<IdentityEntry control={c} signup={initialSignup}/>}<Status control={c}/><Help/></Frame>}</IdentityContext.Provider>;
}
function IdentityWorkspace({children}:{children:ReactNode}){return children;}
function SecurityContent({control:c}:{control:Control}){return <div className="max-w-xl space-y-6">{!c.loaded?<p role="status">Loading account security…</p>:c.state?<IdentityProgress key={identityViewKey(c.state)} control={c}/>:c.verified?<IdentityEntry control={c}/>:<p>Account access could not be checked.</p>}<Status control={c}/><Help/></div>}
function IndependentSecurity(){const c=useIdentity();return <SecurityContent control={c}/>;}
/** The admitted workspace account for fixed identity-only pages; null elsewhere. */
export function useWorkspaceAccount(){const c=useContext(IdentityContext);return c?.state?.purpose==='workspace'?c.state.accountId:null;}
/** The single workspace sign-out: the shared identity controller clears device
 * recovery, private queries and views when its readback confirms the change. */
export function useSignOut(){
 const c=useContext(IdentityContext),[error,setError]=useState('');
 if(!c)throw Error('Sign-out needs the current identity workspace.');
 return {busy:c.busy,error,signOut:()=>c.run(async()=>{
  setError('');
  try{await identityRequest('logout');}catch(cause){setError(cause instanceof Error?cause.message:'Sign-out could not be confirmed. Check saved progress.');throw cause;}
  await c.reload();
 },true)};
}
export function IdentitySecurity(){const c=useContext(IdentityContext);return c?<SecurityContent control={c}/>:<IndependentSecurity/>;}
type VerificationWidget={render:(element:HTMLElement,options:Record<string,unknown>)=>string;remove:(id:string)=>void;getResponse:(id:string)=>string;reset:(id:string)=>void};
const verificationWindow=window as unknown as {turnstile?:VerificationWidget;whumpoIdentityVerificationReady?:()=>void};
function IdentityEntry({control:c,signup=false}:{control:Control;signup?:boolean}){
 const [mode,setMode]=useState<'login'|'signup'|'recovery'>(signup?'signup':'login'),[siteKey,setSiteKey]=useState(''),[verificationError,setVerificationError]=useState('');
 const heading=useRef<HTMLHeadingElement>(null),slot=useRef<HTMLDivElement>(null),widget=useRef<string|undefined>(undefined);
 useEffect(()=>{if(document.activeElement===document.body)heading.current?.focus();},[]);
 useEffect(()=>{if(mode!=='signup')return;let active=true;void identityRequest<{turnstileSiteKey:string}>('config').then(result=>{if(active)setSiteKey(result.turnstileSiteKey)}).catch(()=>{if(active)setVerificationError('Verification could not load. Refresh this page.');});return()=>{active=false;};},[mode]);
 useEffect(()=>{
  if(mode!=='signup'||!siteKey)return;let canceled=false;
  const mount=()=>{if(!canceled&&slot.current&&verificationWindow.turnstile)widget.current=verificationWindow.turnstile.render(slot.current,{sitekey:siteKey,action:'register',theme:'auto',size:'flexible'});};
  if(verificationWindow.turnstile)mount();else{verificationWindow.whumpoIdentityVerificationReady=mount;if(!document.querySelector('script[data-turnstile]')){const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=whumpoIdentityVerificationReady';script.dataset.turnstile='true';script.onerror=()=>setVerificationError('Verification could not load. Refresh this page.');document.head.append(script);}}
  return()=>{canceled=true;if(widget.current)verificationWindow.turnstile?.remove(widget.current);widget.current=undefined;};
 },[mode,siteKey]);
 return <><span className="inline-flex rounded-md bg-secondary p-3"><KeyRound className="size-6"/></span><h1 ref={heading} data-identity-step tabIndex={-1} className="text-3xl sm:text-4xl font-bold focus-visible:outline-2 focus-visible:outline-ring">{mode==='signup'?'A little hello. A big beginning.':mode==='recovery'?'Let’s recover your account.':'Welcome back.'}</h1><p className="text-muted-foreground">{mode==='signup'?'Before your first project, save two passkeys and a private recovery kit. You can pause and return with a saved passkey.':mode==='recovery'?'Your current kit opens a private recovery flow. You’ll review lost passkeys and save replacements before returning to your workspace.':'Sign in with a passkey to open your workspace or resume account setup.'}</p>
 {mode==='login'?<Button className="w-full h-12" disabled={c.busy} onClick={()=>void c.run(async()=>{await identityCeremony('login');await c.reload();})}>Sign in with a passkey <ArrowRight className="size-4"/></Button>:<form key={mode} className="space-y-5" onSubmit={e=>{e.preventDefault();const form=e.currentTarget,fields=new FormData(form),email=String(fields.get('email')).trim();const key=String(fields.get('key')??'').trim();if(mode==='recovery')(form.elements.namedItem('key') as HTMLInputElement).value='';void c.run(async()=>{try{if(mode==='signup')await identityCeremony('signup',{email,inviteCode:String(fields.get('inviteCode')).trim(),usBased:fields.get('usBased')==='yes',turnstileToken:widget.current?verificationWindow.turnstile?.getResponse(widget.current):''});else await identityRequest('recovery/start',{email,key});await c.reload();}finally{if(widget.current)verificationWindow.turnstile?.reset(widget.current);}});}}>
 <div className="space-y-2"><Label htmlFor="identity-email">Email</Label><Input id="identity-email" name="email" type="email" autoComplete="email" maxLength={254} required disabled={c.busy}/></div>
 {mode==='signup'?<><div className="space-y-2"><Label htmlFor="identity-invite">Invitation code</Label><Input id="identity-invite" name="inviteCode" autoComplete="off" maxLength={128} required disabled={c.busy}/></div><label className="flex gap-3 rounded-md border p-4 text-sm leading-6"><input type="checkbox" name="usBased" value="yes" required disabled={c.busy} className="mt-1 size-4 shrink-0"/><span>I am based in the United States, or registering for a US-based organization.</span></label><div ref={slot}/>{verificationError&&<p role="alert" className="text-sm text-destructive">{verificationError}</p>}</>:<div className="space-y-2"><Label htmlFor="identity-key">Recovery key</Label><Input id="identity-key" name="key" type="password" autoComplete="off" spellCheck={false} autoCapitalize="none" minLength={64} maxLength={64} required disabled={c.busy}/><p className="text-xs text-muted-foreground">Enter the key from your current Whumpo recovery kit. Keep it out of Chat.</p></div>}
 <Button className="w-full h-12" disabled={c.busy||(mode==='signup'&&(!siteKey||!!verificationError))}>{mode==='signup'?'Create my first passkey':'Start account recovery'}</Button></form>}
 <div className="flex flex-col gap-2">{mode!=='login'&&<Button variant="quiet" disabled={c.busy} onClick={()=>void c.run(async()=>setMode('login'))}>Sign in with a saved passkey</Button>}{mode==='login'&&<><Button variant="quiet" disabled={c.busy} onClick={()=>void c.run(async()=>setMode('recovery'))}>Use my recovery kit</Button><Button variant="link" disabled={c.busy} onClick={()=>void c.run(async()=>setMode('signup'))}>Have an invitation? Create an account</Button></>}<Button variant="quiet" disabled={c.busy} onClick={()=>void c.run(async()=>{await identityRequest('logout');await c.reload();},true)}>Clear this browser’s sign-in</Button></div></>;
}
function IdentityProgress({control:c}:{control:Control}){
 const s=c.state!,[prepared,setPrepared]=useState<PreparedIdentityKit|null>(null),[name,setName]=useState(''),[editingReview,setEditingReview]=useState(false),[mode,setMode]=useState<'all'|'some'|'none'|null>(null),[lost,setLost]=useState<string[]>([]),[confirmation,setConfirmation]=useState<'cancel'|'secure'|string|null>(null);
 const secretLifetime=useRef(0);
 useEffect(()=>{const clear=()=>{secretLifetime.current++;setPrepared(null);};window.addEventListener('pagehide',clear);return()=>{secretLifetime.current++;window.removeEventListener('pagehide',clear);};},[]);
 useEffect(()=>{if(prepared?.offer?.id!==s.kit.offer?.id)setPrepared(null);},[s.kit.offer?.id,prepared?.offer?.id]);
 const checked=async()=>{await identityCeremony('reauth');const now=await c.reload();if(!now||!sameIdentityReview(s,now))throw Error('Your account changed. Review its current state before continuing.');return now;};
 const offer=s.kit.offer,review=s.recovery?.review,needsReview=s.purpose==='recovery'&&(!review||editingReview),secured=!!review?.secured;
 const intent=(state=s)=>identityIntent(state),offered=(state=s)=>{if(!offer)throw Error('Prepare and save a current kit first.');return {...intent(state),offerId:offer.id,generation:offer.generation}};
 const refresh=async()=>{setPrepared(null);setConfirmation(null);setEditingReview(false);setMode(null);setLost([]);await c.reload();};
 const prepare=async()=>{const state=s.purpose==='workspace'||secured?await checked():s;setPrepared(null);const lifetime=secretLifetime.current;const kit=await identityRequest<PreparedIdentityKit>('kit/prepare',intent(state));await c.reload();if(lifetime===secretLifetime.current)setPrepared(kit);};
 async function signOut(){setPrepared(null);await identityRequest('logout');await c.reload();}
 const title=s.purpose==='enrollment'?'Make this account yours.':s.purpose==='recovery'?'Recover your account.':'Account security';
 const canAdd=s.purpose!=='recovery'||secured;
 return <><span className="inline-flex rounded-md bg-secondary p-3"><ShieldCheck className="size-6"/></span><h1 data-identity-step tabIndex={-1} className="text-3xl font-bold focus-visible:outline-2 focus-visible:outline-ring">{title}</h1><p className="text-sm text-muted-foreground break-words">{s.email}</p>
 {s.purpose==='enrollment'&&<p className="text-muted-foreground">Save two distinct passkeys, then your recovery kit. Your profile and first project come next.</p>}
 {s.purpose==='recovery'&&<p className="text-muted-foreground">{secured?'Your account is secured. Finish adding replacement passkeys to return to your workspace.':'Review which passkeys are lost or unsafe. Your workspace stays closed throughout recovery.'}</p>}
 {needsReview?<section className="space-y-4"><fieldset className="space-y-3"><legend className="font-semibold mb-3">Which passkeys are lost or unsafe?</legend>{(['all','some','none'] as const).map(value=><label key={value} className="flex gap-3 items-start rounded-md border p-4 cursor-pointer"><input type="radio" name="identity-loss" value={value} disabled={c.busy||(value!=='all'&&s.keys.filter(k=>k.status==='active').length===0)} checked={mode===value} onChange={()=>{setMode(value);setLost([]);}} className="mt-1"/><span><strong className="block">{value==='all'?'All passkeys':value==='some'?'Some passkeys':'None'}</strong><span className="text-sm text-muted-foreground">{value==='all'?'Remove every passkey in this review.':value==='some'?'Choose exactly which passkeys to remove.':'Keep your current passkeys and add a replacement.'}</span></span></label>)}</fieldset>
 {mode==='none'&&<p className="text-sm text-muted-foreground">If a passkey works, ordinary sign-in and Account security are simpler. Recovery still requires a new passkey.</p>}
 {mode==='some'&&<fieldset className="space-y-2"><legend className="font-semibold mb-3">Passkeys to remove</legend>{s.keys.filter(k=>k.status==='active').map(k=><label key={k.id} className="flex items-start gap-3 p-3 rounded-md border"><input type="checkbox" disabled={c.busy} checked={lost.includes(k.id)} onChange={e=>setLost(v=>e.target.checked?[...v,k.id]:v.filter(id=>id!==k.id))}/><span className="break-words min-w-0">{k.name}</span></label>)}</fieldset>}
 <Button disabled={c.busy||!mode||(mode==='some'&&(!lost.length||lost.length>=s.keys.filter(k=>k.status==='active').length))} onClick={()=>void c.run(async()=>{await identityRequest('recovery/review',{...intent(),mode,lostIds:mode==='all'?s.keys.filter(k=>k.status==='active').map(k=>k.id):mode==='some'?lost:[]});await refresh();})}>Review these passkeys</Button>{editingReview&&<Button variant="quiet" disabled={c.busy} onClick={()=>void c.run(async()=>setEditingReview(false))}>Keep current review</Button>}</section>:<>
 {review&&<section className="rounded-md border p-4 space-y-3"><h2 data-identity-step tabIndex={-1} className="font-semibold focus-visible:outline-2 focus-visible:outline-ring">{secured?'Saved recovery review':'Review before securing'}</h2><p className="text-sm">{review.lostIds.length} {review.lostIds.length===1?'passkey':'passkeys'} {secured?'removed':'will be removed'} · {review.retainedIds.length} retained</p>{!secured&&<ul className="text-sm list-disc pl-5">{s.keys.filter(k=>review.lostIds.includes(k.id)).map(k=><li key={k.id}>{k.name}</li>)}</ul>}<Button variant="secondary" disabled={c.busy} onClick={()=>void c.run(async()=>{setPrepared(null);setEditingReview(true);setMode(null);setLost([]);})}>Change loss review</Button></section>}
 {canAdd&&<section className="space-y-4"><h2 className="text-xl font-bold">Your passkeys</h2><ul className="space-y-3">{s.keys.map(k=><li key={k.id} className="flex items-center justify-between gap-3 border rounded-md p-4"><div className="min-w-0"><p className="font-medium break-words">{k.name}</p><p className="text-xs text-muted-foreground">{k.status==='staged'?'Saved for this setup':s.purpose==='recovery'?'Retained for recovery':'Active'} · {new Date(k.created_at*1000).toLocaleDateString()}</p></div>{s.purpose!=='enrollment'&&<Button variant="quiet" disabled={c.busy} onClick={()=>void c.run(async()=>setConfirmation(k.id))}>Remove</Button>}</li>)}</ul>
 <form className="space-y-3" onSubmit={e=>{e.preventDefault();void c.run(async()=>{const state=s.purpose==='workspace'?await checked():s;await identityCeremony('add',{requestId:crypto.randomUUID(),attemptId:state.attemptId,expectedRevision:state.expectedRevision,name:name.trim()});setName('');await refresh();});}}><Label htmlFor="identity-passkey-name">Name your {s.keys.length?'next':'replacement'} passkey</Label><Input id="identity-passkey-name" value={name} onChange={e=>setName(e.target.value)} placeholder="My phone or password manager" maxLength={100} required disabled={c.busy||s.keys.length>=10}/><Button disabled={c.busy||!name.trim()||s.keys.length>=10}>Add a passkey</Button></form></section>}
 {(s.purpose!=='enrollment'||s.keys.length>=2)&&<section className="border-t pt-6 space-y-4">{offer?<IdentityKit prepared={prepared} offer={offer} busy={c.busy} onSaved={()=>void c.run(async()=>{await identityRequest('kit/save',{...offered(),saved:true});setPrepared(null);await c.reload();})} onReplace={()=>void c.run(prepare)}/>:<><h2 className="text-xl font-bold">{s.kit.activeGeneration?'Recovery kit':'Your private backup'}</h2>{s.kit.activeGeneration>0&&<p className="text-sm text-muted-foreground">Active kit: generation {s.kit.activeGeneration}. Its key cannot be shown again.</p>}<Button variant="secondary" disabled={c.busy} onClick={()=>void c.run(prepare)}>{s.kit.activeGeneration&&secured||s.purpose==='workspace'?'Replace recovery kit':'Prepare recovery kit'}</Button></>}
 {offer?.saved&&s.purpose==='enrollment'&&<Button className="w-full min-h-12 whitespace-normal" disabled={c.busy} onClick={()=>void c.run(async()=>{const state=await checked();await identityRequest('enrollment/complete',offered(state));await refresh();})}>Verify a passkey and finish setup</Button>}
 {offer?.saved&&s.purpose==='recovery'&&!secured&&<Button className="w-full min-h-12" disabled={c.busy} onClick={()=>void c.run(async()=>setConfirmation('secure'))}>Secure my account</Button>}
 {offer?.saved&&(s.purpose==='workspace'||secured)&&<Button disabled={c.busy} onClick={()=>void c.run(async()=>{const state=await checked();await identityRequest('kit/rotate',offered(state));await refresh();})}>Activate this kit</Button>}
 </section>}
 {s.recovery?.canComplete&&<Button className="w-full min-h-12 whitespace-normal" disabled={c.busy} onClick={()=>void c.run(async()=>{await identityCeremony('recovery/complete',{...intent(),reviewId:review!.id,generation:s.kit.activeGeneration});await refresh();})}>Verify a replacement and finish recovery</Button>}
 {secured&&!s.recovery?.canComplete&&<p className="text-sm text-muted-foreground">{review.mode==='all'?'Save two new passkeys to finish.':'Save at least one new passkey. A retained passkey and a new replacement are both required.'}</p>}
 </>}
 {confirmation&&<section role="region" aria-label="Confirm account change" className="rounded-md border border-destructive/40 p-5 space-y-4"><h2 data-identity-step tabIndex={-1} className="font-bold focus-visible:outline-2 focus-visible:outline-ring">{confirmation==='cancel'?'Cancel unfinished signup?':confirmation==='secure'?'Secure your account now?':'Remove this passkey?'}</h2><p className="text-sm">{confirmation==='cancel'?'Your pending account and its passkeys will be deleted. Your invitation remains spent.':confirmation==='secure'?'This activates the new kit, removes exactly the reviewed lost passkeys, and signs out every existing session. Keep the new kit you saved.':`“${s.keys.find(k=>k.id===confirmation)?.name}” will stop working and all sessions will be signed out. ${s.keys.length===1?'This is your last passkey. Your current recovery kit will be required to regain access.':'Keep a working passkey and your recovery kit available.'}`}</p><div className="flex gap-3 flex-wrap"><Button variant="secondary" disabled={c.busy} onClick={()=>void c.run(async()=>setConfirmation(null))}>Go back</Button><Button disabled={c.busy} onClick={()=>void c.run(async()=>{if(confirmation==='cancel')await identityRequest('enrollment/cancel',{...intent(),confirmation:'cancel-enrollment'});else if(confirmation==='secure')await identityRequest('recovery/secure',{...offered(),reviewId:review!.id,confirmation:'secure-account'});else{const state=await checked();await identityRequest('passkey/remove',{...intent(state),credentialId:confirmation,confirmation:'remove-passkey'});}await refresh();})}>{confirmation==='cancel'?'Delete pending account':confirmation==='secure'?'Confirm and secure':'Verify and remove'}</Button></div></section>}
 <div className="border-t pt-4 flex flex-wrap gap-2"><Button variant="quiet" disabled={c.busy} onClick={()=>void c.run(c.reload)}>Check saved progress</Button><Button variant="quiet" disabled={c.busy} onClick={()=>void c.run(signOut,true)}>Sign out</Button>{s.purpose==='enrollment'&&<Button variant="quiet" disabled={c.busy} onClick={()=>void c.run(async()=>setConfirmation('cancel'))}>Cancel signup</Button>}</div></>;
}
