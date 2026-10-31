import {useEffect,useRef,useState} from 'react';
import {Copy,Download} from 'lucide-react';
import {send,APIError,resetWorkspaceClient} from './lib/api';
import {identityCeremony} from './lib/identity';
import {invalidateIdentity} from './lib/identity-invalidation';
import {Button} from './components/ui/button';
import {Deadline} from './lib/time-ago';

const alertBox='rounded-md border border-attention-ink/40 bg-attention-soft p-4 text-body-sm text-attention-ink';

/** WH-203/WH-204 owner security review (docs/email-change-and-compromise.md sections 3 and 3.2). Direct control, never Chat. */
type Snapshot={reviewId:string;expiresAt:number;credentials:string[];sessions:{sessionId:string;credentialId:string;issuedAt:number}[];kitGeneration:number;pendingEmailChange:{changeId:string;expiresAt:number}|null;connections:{connectionId:string;provider:string;access:string;revocation:string}[]};
type Kit={offer:{offerId:string;generation:number;expiresAt:number};key:string;filename:string;text:string};
export type Receipt={reviewId:string;epoch:number;stage:string;revokedCredentials:string[];kitRotated:boolean;pendingEmailChange:'cancelled'|null;connections:{connectionId:string;access:string;revocation:string}[];sessionsRevoked:'all'};
type Payload={requestId:string;reviewId:string;revokeCredentials:string[];revokeConnections:string[];rotateKit:{offerId:string}|null};
export type Step='start'|'select'|'kit'|'confirm'|'done';
type View={step:Step;busy:boolean;status:string;error:string;snap:Snapshot|null;dropKeys:string[];dropConns:string[];kit:Kit|null;kitSaved:boolean;kitSkipped:boolean;ack:boolean;receipt:Receipt|null;resume:boolean};
type Handlers={start():void;toggleKey(id:string):void;toggleConn(id:string):void;toSelectDone():void;makeKit():void;skipKit():void;saved():void;copy():void;download():void;setAck(v:boolean):void;commit():void;back(step:Step):void;signIn():void};

const providerName=(p:string)=>p==='github'?'GitHub':p==='cloudflare'?'Cloudflare':p;
const keyLabel=(id:string,i:number)=>'Passkey '+(i+1)+' (ends '+id.slice(-6)+')';
const revocationText=(s:string)=>s==='queued'?'access ended here, removal at the provider is queued':s==='revoked'?'removed at the provider':'access ended here, provider removal is being checked';

/** Plain-language text for every adapter code. `goto` is where the owner can safely continue; null keeps the step. */
export function reviewError(e:unknown):{text:string;goto:Step|null;keepAttempt:boolean}{
 const code=e instanceof APIError?e.code:undefined;
 switch(code){
  case 'review_limit':return {text:'This account has reached its limit of stored security reviews, so a new one cannot start right now. Nothing was changed. Try again later or contact support.',goto:'start',keepAttempt:false};
  case 'review_too_large':return {text:'This account has too many items for one review. Nothing was changed. Contact support.',goto:'start',keepAttempt:false};
  case 'stale_review':case 'unknown_review':case 'unknown_offer':return {text:'Your account changed or this review expired. Nothing was changed. Start a new review.',goto:'start',keepAttempt:false};
  case 'invalid_selection':return {text:'One of your choices is no longer part of this review. Nothing was changed. Check your choices and try again.',goto:'select',keepAttempt:false};
  case 'kit_not_saved':return {text:'The new recovery kit is not marked as saved yet. Save it, then confirm that you saved it.',goto:'kit',keepAttempt:false};
  case 'kit_offer_exists':return {text:'A replacement kit was already created for this review and cannot be shown again. Keep your current kit, or start a new review.',goto:null,keepAttempt:false};
  case 'request_conflict':return {text:'That request was already used with different choices. Start a new review.',goto:'start',keepAttempt:false};
  case 'proof_required':case 'identity_changed':return {text:'Verify your passkey to continue. Nothing was changed. Select the button again to verify.',goto:null,keepAttempt:true};
  case 'rate_limited':return {text:'Too many attempts. Wait a few minutes, then try again. Nothing was changed.',goto:null,keepAttempt:true};
  case 'delivery_unavailable':return {text:'Email notices are not connected yet. Nothing was changed.',goto:null,keepAttempt:false};
  case 'client_upgrade_required':return {text:'Update Whumpo, then try again.',goto:null,keepAttempt:true};
  default:return {text:e instanceof APIError&&e.status<500?e.message:'We could not confirm the result. If you secured your account, sign in again and select Check result; the same request is safe to repeat.',goto:null,keepAttempt:true};
 }
}

const heading='text-heading focus-visible:outline-2 focus-visible:outline-ring';
export function SecurityReviewView({v,on}:{v:View;on:Handlers}){
 const head=useRef<HTMLHeadingElement>(null),first=useRef(true);
 useEffect(()=>{if(first.current){first.current=false;return;}head.current?.focus();},[v.step]);
 const snap=v.snap,rotating=!!v.kit&&v.kitSaved,ready=v.kitSaved||v.kitSkipped;
 const h=(t:string,hide=false)=><h3 ref={head} tabIndex={-1} className={heading+(hide?' sr-only':'')}>{t}</h3>;
 return <div className="grid gap-5 min-w-0">
  {v.step==='start'&&<div className="grid gap-3">{h('Secure my account',true)}
   <p className="text-body-sm">Use this if you think a passkey, recovery kit, email account or connection may be exposed. You will check your passkey, choose what to remove, and be signed out everywhere.</p>
   <details className="text-body-sm text-ink-muted"><summary className="min-h-11 cursor-pointer py-3 font-medium text-ink">What to know</summary><p>This restores control of your account. It does not recover encrypted content.</p></details>
   {v.resume&&<p className="text-body-sm">A security review may not have finished. Check its result; the same request is safe to repeat.</p>}
   <div className="flex flex-wrap gap-3"><Button className="min-h-11 h-auto max-w-full whitespace-normal" disabled={v.busy} onClick={on.start}>{v.resume?'Check result':'Secure my account'}</Button></div></div>}
  {v.step==='select'&&snap&&<form className="grid gap-5" onSubmit={e=>{e.preventDefault();on.toSelectDone()}}>{h('Choose what to keep')}
   <p className="text-body-sm">This review is valid until <Deadline value={snap.expiresAt}/>. Every sign-in on every device ends when you finish.</p>
   <fieldset className="grid gap-3"><legend className="text-body-sm font-medium">Passkeys</legend><p className="text-body-sm text-ink-muted">All are kept unless you remove them. Remove one only if you do not recognise it or no longer hold it.</p>
    {snap.credentials.map((id,i)=><label key={id} className="flex items-start gap-3 text-body-sm min-h-11"><input type="checkbox" className="mt-1" checked={v.dropKeys.includes(id)} onChange={()=>on.toggleKey(id)}/><span>Remove {keyLabel(id,i)}<span className="block text-ink-muted">Signed in {snap.sessions.filter(s=>s.credentialId===id).length} time(s) right now</span></span></label>)}</fieldset>
   <fieldset className="grid gap-3"><legend className="text-body-sm font-medium">Connections</legend>
    {snap.connections.length?<><p className="text-body-sm text-ink-muted">All are chosen for removal, because a connection could still act for you. Access ends here at once and Whumpo asks the provider to remove it.</p>
     {snap.connections.map(c=><label key={c.connectionId} className="flex items-start gap-3 text-body-sm min-h-11"><input type="checkbox" className="mt-1" checked={v.dropConns.includes(c.connectionId)} onChange={()=>on.toggleConn(c.connectionId)}/><span>Remove {providerName(c.provider)} connection<span className="block text-ink-muted">{c.access==='active'?'Access is on':'Access is already off'}</span></span></label>)}</>:<p className="text-body-sm text-ink-muted">You have no provider connections.</p>}</fieldset>
   {snap.pendingEmailChange&&<p className="text-body-sm">An email change is waiting for confirmation. It will be cancelled.</p>}
   {v.dropKeys.length===snap.credentials.length&&<p className={alertBox} role="alert">You chose to remove every passkey. You will need your saved recovery kit to get back in.</p>}
   <div className="flex flex-wrap gap-3"><Button className="min-h-11 h-auto max-w-full whitespace-normal" disabled={v.busy}>Continue</Button><Button type="button" variant="secondary" className="min-h-11 h-auto max-w-full whitespace-normal" disabled={v.busy} onClick={()=>on.back('start')}>Cancel</Button></div></form>}
  {v.step==='kit'&&<div className="grid gap-4">{h('Replace your recovery kit')}
   <p className="text-body-sm">A new kit replaces the one you have now, and the old kit stops working. Keep it private and apart from your passkeys. It cannot be shown again.</p>
   {!v.kit&&<div className="flex flex-wrap gap-3"><Button className="min-h-11 h-auto max-w-full whitespace-normal" disabled={v.busy} onClick={on.makeKit}>Create new recovery kit</Button><Button type="button" variant="secondary" className="min-h-11 h-auto max-w-full whitespace-normal" disabled={v.busy} onClick={on.skipKit}>Keep my current kit</Button></div>}
   {v.kit&&<><div className="grid sm:grid-cols-2 gap-2"><Button type="button" variant="secondary" className="min-h-11 h-auto max-w-full whitespace-normal" onClick={on.download}><Download className="size-4"/>Download</Button><Button type="button" variant="secondary" className="min-h-11 h-auto max-w-full whitespace-normal" onClick={on.copy}><Copy className="size-4"/>Copy</Button></div>
    <details className="rounded-md border p-4"><summary className="cursor-pointer text-body-sm font-medium">Show private recovery key</summary><p className="font-mono text-body-sm break-all select-all mt-4">{v.kit.key}</p></details>
    {v.kitSaved?<p className="text-body-sm text-ready-ink">Saved. Continue when you are ready.</p>:<Button className="min-h-11 h-auto max-w-full whitespace-normal" disabled={v.busy} onClick={on.saved}>I have saved my new recovery kit</Button>}
    <div className="flex flex-wrap gap-3"><Button variant={v.kitSaved?'primary':'secondary'} className="min-h-11 h-auto max-w-full whitespace-normal" disabled={v.busy||!v.kitSaved} onClick={()=>on.back('confirm')}>Continue</Button><Button type="button" variant="secondary" className="min-h-11 h-auto max-w-full whitespace-normal" disabled={v.busy} onClick={on.skipKit}>Keep my current kit instead</Button></div></>}
   <Button type="button" variant="quiet" className="min-h-11 h-auto max-w-full whitespace-normal justify-self-start" disabled={v.busy} onClick={()=>on.back('select')}>Back</Button></div>}
  {v.step==='confirm'&&snap&&<form className="grid gap-4" onSubmit={e=>{e.preventDefault();on.commit()}}>{h('Confirm')}
   <ul className="text-body-sm list-disc pl-5 grid gap-1"><li>You will be signed out on every device, including this one.</li>
    <li>{v.dropKeys.length?'Passkeys removed: '+v.dropKeys.length+' of '+snap.credentials.length+'.':'No passkeys will be removed.'}</li>
    <li>{v.dropConns.length?'Connections removed: '+v.dropConns.length+' of '+snap.connections.length+'.':'No connections will be removed.'}</li>
    <li>{rotating?'Your recovery kit will be replaced by the one you just saved.':'Your current recovery kit stays.'}</li>
    {snap.pendingEmailChange&&<li>The waiting email change will be cancelled.</li>}</ul>
   {v.dropKeys.length===snap.credentials.length&&<p className={alertBox} role="alert">No passkey will remain. Your saved recovery kit is the only way back in.</p>}
   <label className="flex items-start gap-3 text-body-sm min-h-11"><input type="checkbox" className="mt-1" checked={v.ack} onChange={e=>on.setAck(e.target.checked)}/><span>I understand this cannot be undone and I will be signed out everywhere.</span></label>
   <div className="flex flex-wrap gap-3"><Button className="min-h-11 h-auto max-w-full whitespace-normal" disabled={v.busy||!v.ack||!ready}>Secure my account now</Button><Button type="button" variant="secondary" className="min-h-11 h-auto max-w-full whitespace-normal" disabled={v.busy} onClick={()=>on.back('kit')}>Back</Button></div></form>}
  {v.step==='done'&&v.receipt&&<div className="grid gap-3">{h('Your account is secured')}
   <ul className="text-body-sm list-disc pl-5 grid gap-1"><li>You are signed out everywhere.</li>
    <li>Passkeys removed: {v.receipt.revokedCredentials.length}.</li>
    <li>{v.receipt.kitRotated?'Your recovery kit was replaced. The old kit no longer works.':'Your recovery kit was not changed.'}</li>
    {v.receipt.pendingEmailChange&&<li>The waiting email change was cancelled.</li>}
    {v.receipt.connections.map(c=><li key={c.connectionId}>Connection removed: {revocationText(c.revocation)}.</li>)}
    {v.receipt.stage==='recovering'&&<li>No passkey remains. Use your saved recovery kit to get back in.</li>}</ul>
   <p className="text-body-sm text-ink-muted">This restores control of your account. It does not recover encrypted content.</p>
   <Button className="min-h-11 h-auto max-w-full whitespace-normal justify-self-start" onClick={on.signIn}>Continue to sign-in</Button></div>}
  <p role="status" aria-live="polite" className="text-body-sm text-ink-muted">{v.status}</p>
  {v.error&&<p role="alert" className={alertBox}>{v.error}</p>}
 </div>;
}

const storeKey='whumpo.security-review.commit';
const stored={read():Payload|null{try{return JSON.parse(sessionStorage.getItem(storeKey)??'null')}catch{return null}},write(p:Payload|null){try{if(p)sessionStorage.setItem(storeKey,JSON.stringify(p));else sessionStorage.removeItem(storeKey)}catch{/* private mode: the in-page request ID still holds */}}};
const path='/account/security/review/';

export function SecurityReviewSettings(){
 const [v,set]=useState<View>(()=>({step:'start',busy:false,status:'',error:'',snap:null,dropKeys:[],dropConns:[],kit:null,kitSaved:false,kitSkipped:false,ack:false,receipt:null,resume:stored.read()!==null}));
 const patch=(p:Partial<View>)=>set(s=>({...s,...p}));
 // One request ID per attempt; a lost reply replays it (also across a new sign-in, via sessionStorage).
 const attempt=useRef<Payload|null>(stored.read()),fresh=useRef(true);
 async function guard(work:()=>Promise<void>,status:string){
  patch({busy:true,error:'',status});
  try{if(fresh.current){try{await identityCeremony('reauth')}catch(e){patch({error:e instanceof Error?e.message:'The passkey step was not completed. Nothing was changed.',status:''});return}fresh.current=false;}await work();patch({status:''});}
  catch(e){const r=reviewError(e);if(e instanceof APIError&&(e.code==='proof_required'||e.code==='identity_changed'))fresh.current=true;if(!r.keepAttempt){attempt.current=null;stored.write(null);}patch({error:r.text,status:'',...(r.goto?{step:r.goto,...(r.goto==='start'?{snap:null,kit:null,kitSaved:false,kitSkipped:false,ack:false,resume:false}:{}),...(r.goto==='kit'?{kitSaved:false}:{})}:{})});}
  finally{patch({busy:false})}
 }
 // A changed choice is a new request; an unchanged retry keeps its ID.
 const drop=()=>{attempt.current=null;stored.write(null)};
 const toggle=(list:string[],id:string)=>list.includes(id)?list.filter(x=>x!==id):[...list,id];
 async function commit(payload:Payload){
  const r=await send<{receipt?:Receipt;status?:string}>(path+'commit',{version:1,...payload});
  if(r.status==='delivery_unavailable'||!r.receipt)throw new APIError('',503,'delivery_unavailable');
  attempt.current=null;stored.write(null);patch({step:'done',receipt:r.receipt,resume:false,status:'Your account is secured.'});
 }
 const on:Handlers={
  start:()=>void guard(async()=>{
   if(attempt.current)return commit(attempt.current); // earlier attempt: replay the same request ID
   const s=await send<Snapshot>(path+'prepare',{version:1});
   patch({step:'select',snap:s,dropKeys:[],dropConns:s.connections.map(c=>c.connectionId),kit:null,kitSaved:false,kitSkipped:false,ack:false,status:'Review ready.'});
  },'Checking your passkey.'),
  toggleKey:id=>{drop();set(s=>({...s,dropKeys:toggle(s.dropKeys,id)}))},toggleConn:id=>{drop();set(s=>({...s,dropConns:toggle(s.dropConns,id)}))},
  toSelectDone:()=>{drop();patch({step:'kit',error:''})},
  makeKit:()=>void guard(async()=>{const k=await send<Kit>(path+'kit',{version:1,reviewId:v.snap!.reviewId});patch({kit:k,status:'Your new recovery kit is shown below.'});},'Creating your recovery kit.'),
  skipKit:()=>{drop();patch({kit:null,kitSaved:false,kitSkipped:true,step:'confirm',error:''})},
  saved:()=>void guard(async()=>{await send(path+'kit/save',{version:1,offerId:v.kit!.offer.offerId});drop();patch({kitSaved:true,kitSkipped:false,status:'Marked as saved.'});},'Saving.'),
  copy:()=>{navigator.clipboard.writeText(v.kit!.text).then(()=>patch({status:'Copied. Keep it private and apart from your passkeys.'}),()=>patch({status:'Copy did not finish. Use Download, or select the recovery key.'}))},
  download:()=>{const url=URL.createObjectURL(new Blob([v.kit!.text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=v.kit!.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);patch({status:'Downloaded. Keep it private and apart from your passkeys.'})},
  setAck:ack=>patch({ack}),
  commit:()=>void guard(async()=>{
   if(!attempt.current)attempt.current={requestId:crypto.randomUUID(),reviewId:v.snap!.reviewId,revokeCredentials:[...v.dropKeys],revokeConnections:[...v.dropConns],rotateKit:v.kitSaved&&v.kit?{offerId:v.kit.offer.offerId}:null};
   stored.write(attempt.current);await commit(attempt.current);
  },'Securing your account.'),
  back:step=>patch({step,error:'',status:'',...(step==='start'?{snap:null,kit:null,kitSaved:false,kitSkipped:false,ack:false}:{})}),
  signIn:()=>{resetWorkspaceClient();invalidateIdentity(true)},
 };
 return <SecurityReviewView v={v} on={on}/>;
}
