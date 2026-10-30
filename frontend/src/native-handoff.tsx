import {useState} from 'react';
import {ArrowRight,Smartphone} from 'lucide-react';
import {Button} from './components/ui/button';
import {Brand} from './components/brand';
import {IdentityGate} from './identity/flow';
import {IdentityClientError,identityCeremony,identityRequest} from './lib/identity';

// /workspace/native/{token}: the browser half of the Android handoff. IdentityGate does sign-in, signup, enrollment and recovery exactly as on the web;
// only a ready account reaches the button. The one-time code is issued by the server and is never shown, stored or logged here.
function Return({token}:{token:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function open(){
  setBusy(true);setError('');
  try{
   const complete=()=>identityRequest<{returnUrl:string}>('handoff/complete',{browserToken:token});
   // A recent sign-in is already fresh; otherwise the server asks for a new passkey check once.
   const done=await complete().catch(async error=>{
    if(!(error instanceof IdentityClientError)||error.code!=='proof_required')throw error;
    await identityCeremony('reauth');return complete();
   });
   window.location.assign(done.returnUrl);
  }catch(cause){
   setError(cause instanceof IdentityClientError&&cause.code==='identity_incomplete'?cause.message
    :cause instanceof IdentityClientError&&cause.code==='identity_changed'?'This link has expired or was already used. Go back to the app and start again.'
    :cause instanceof Error?cause.message:'This step could not finish. Go back to the app and start again.');
   setBusy(false);
  }
 }
 return <main className="auth-screen min-h-dvh grid place-items-center px-4 py-12"><div className="max-w-md w-full space-y-6"><Brand/>
  <span className="inline-flex rounded-md bg-action-soft p-3"><Smartphone className="size-6"/></span>
  <h1 className="text-display">Continue in the Whumpo app.</h1>
  <p className="text-ink-muted">Verify your passkey, then your phone opens the app signed in. Whumpo never shows or stores the sign-in code.</p>
  {error&&<p role="alert" className="rounded-md border border-attention-ink/30 bg-attention-soft p-4 text-sm">{error}</p>}
  <Button className="w-full h-12" disabled={busy} onClick={()=>void open()}>Open the Whumpo app <ArrowRight className="size-4"/></Button>
 </div></main>;
}
export function NativeHandoff({token}:{token:string}){
 return /^[a-f0-9]{64}$/.test(token)?<IdentityGate><Return token={token}/></IdentityGate>:<main className="min-h-dvh grid place-items-center px-4"><p>This link is not valid. Go back to the app and start again.</p></main>;
}
