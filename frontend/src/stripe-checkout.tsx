import {useEffect,useMemo,useRef,useState} from 'react';
import type {FormEvent} from 'react';
import {ArrowLeft,Loader2,Lock} from 'lucide-react';
import {CheckoutElementsProvider,PaymentElement,useCheckoutElements} from '@stripe/react-stripe-js/checkout';
import {loadStripe} from '@stripe/stripe-js/pure';
import type {Appearance,Stripe} from '@stripe/stripe-js';
import {Button} from './components/ui/button';
import {Skeleton} from './components/ui/skeleton';

// This module is imported lazily (React.lazy in subscription-panel), so Stripe.js is requested only where a card is collected.
export type CheckoutSummary={
  kind:'subscription'|'payment-method';
  planName?:string;
  price?:string;
  interval?:'month'|'year';
};

// Elements render in Stripe's iframe, which cannot read our CSS. Map Whumpo's tokens (light or dark) into the Appearance API.
function appearance():Appearance{
  const root=document.documentElement,css=getComputedStyle(root),token=(name:string)=>css.getPropertyValue(name).trim();
  const dark=root.classList.contains('dark');
  return {
    theme:dark?'night':'stripe',
    variables:{
      colorPrimary:token('--link'),colorBackground:token('--surface-raised'),colorText:token('--ink'),colorTextSecondary:token('--ink-muted'),
      colorDanger:token('--attention-ink'),fontFamily:'Inter, ui-sans-serif, system-ui, sans-serif',borderRadius:'12px',spacingUnit:'4px',focusBoxShadow:'none',focusOutline:'2px solid '+token('--focus-ring'),
    },
    rules:{
      '.Input':{border:'1px solid '+token('--line-strong'),padding:'12px',fontSize:'16px'},
      '.Label':{fontWeight:'500'},
      '.Error':{fontSize:'14px'},
    },
  };
}

let stripeKey='',stripePromise:Promise<Stripe|null>|undefined;
function stripeFor(key:string){
  // pk_test_ only: real-money mode is not reachable from the client either.
  if(!/^pk_test_[A-Za-z0-9]+$/.test(key))return Promise.resolve(null);
  if(key!==stripeKey||!stripePromise){stripeKey=key;stripePromise=loadStripe(key).catch(()=>{stripePromise=undefined;return null;});}
  return stripePromise;
}

function Form({summary,amount,onDone,onBack}:{summary:CheckoutSummary;amount:string;onDone:()=>void|Promise<void>;onBack:()=>void}){
  const state=useCheckoutElements(),[busy,setBusy]=useState(false),[error,setError]=useState(''),locked=useRef(false),alert=useRef<HTMLParagraphElement>(null);
  // Errors sit beside the form; focus moves to them so keyboard and screen-reader users land on the cause.
  useEffect(()=>{if(error)alert.current?.focus();},[error]);
  if(state.type==='loading')return <div role="status" className="space-y-3"><span className="sr-only">Loading the secure payment form…</span><Skeleton className="h-12 rounded-md"/><Skeleton className="h-12 rounded-md"/><Skeleton className="h-12 rounded-md"/></div>;
  if(state.type==='error')return <div className="space-y-3"><p ref={alert} tabIndex={-1} role="alert" className="rounded-md border border-attention-ink/40 bg-attention-soft p-3 text-body-sm font-medium text-attention-ink">{state.error.message||'The payment form could not start.'} Nothing was charged.</p><Button type="button" variant="secondary" className="min-h-11" onClick={onBack}><ArrowLeft className="size-4" aria-hidden="true"/>Back</Button></div>;
  const {checkout}=state,subscribe=summary.kind==='subscription';
  async function submit(event:FormEvent){
    event.preventDefault();
    if(locked.current)return; // double-submit guard: the ref flips before React re-renders the disabled state
    locked.current=true;setBusy(true);setError('');
    try{
      // 'if_required' keeps cards on this page; Stripe opens its own 3D Secure challenge and only redirects for redirect-based methods.
      const result=await checkout.confirm({redirect:'if_required'});
      if(result.type==='error')setError(result.error.message||'The payment could not be completed.');
      else await onDone();
    }catch{setError('The payment could not be completed. Check your connection and try again.');}
    finally{locked.current=false;setBusy(false);}
  }
  return <form onSubmit={e=>void submit(e)} className="space-y-4" aria-busy={busy}>
    <PaymentElement options={{layout:'accordion'}}/>
    {error&&<p ref={alert} tabIndex={-1} role="alert" className="rounded-md border border-attention-ink/40 bg-attention-soft p-3 text-body-sm font-medium text-attention-ink">{error} Check the details, or try another card.</p>}
    <Button type="submit" size="lg" className="h-auto min-h-12 w-full whitespace-normal py-3 text-center" disabled={!checkout.canConfirm||busy}>
      {busy?<><Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true"/>Processing…</>:<><Lock className="size-4" aria-hidden="true"/>{subscribe?`Subscribe · ${amount}`:'Save card'}</>}
    </Button>
    <p className="flex items-center gap-1.5 text-caption text-ink-muted"><Lock className="size-3.5 shrink-0" aria-hidden="true"/>Card details go straight to Stripe and never reach Whumpo.</p>
    <Button type="button" variant="quiet" className="min-h-11" disabled={busy} onClick={onBack}><ArrowLeft className="size-4" aria-hidden="true"/>{subscribe?'Back to plans':'Back to billing'}</Button>
  </form>;
}

export default function StripeCheckout({clientSecret,publishableKey,summary,amount,onDone,onBack}:{clientSecret:string;publishableKey:string;summary:CheckoutSummary;amount:string;onDone:()=>void|Promise<void>;onBack:()=>void}){
  const [stripe,setStripe]=useState<Stripe|null|undefined>(undefined),[attempt,setAttempt]=useState(0),heading=useRef<HTMLHeadingElement>(null);
  const theme=document.documentElement.classList.contains('dark'),options=useMemo(()=>({clientSecret,elementsOptions:{appearance:appearance()}}),[clientSecret,theme]);
  useEffect(()=>{let live=true;setStripe(undefined);void stripeFor(publishableKey).then(s=>{if(live)setStripe(s);});return()=>{live=false;};},[publishableKey,attempt]);
  useEffect(()=>{heading.current?.focus();},[]);
  const subscribe=summary.kind==='subscription';
  return <section aria-labelledby="checkout-heading" className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
    <div className="min-w-0 space-y-3 rounded-lg bg-surface-sunken p-4 sm:p-5">
      <h3 id="checkout-heading" ref={heading} tabIndex={-1} className="text-heading">{subscribe?'Order summary':'Update payment method'}</h3>
      {subscribe?<>
        <p className="text-body-sm text-ink-muted">Whumpo {summary.planName}</p>
        <p className="text-title text-ink">{summary.price}<span className="text-body-sm font-normal text-ink-muted"> / {summary.interval}</span></p>
        <ul className="list-disc space-y-1 pl-5 text-body-sm text-ink-muted"><li>Renews every {summary.interval} until you cancel.</li><li>Cancel any time in Billing; access continues to the end of the paid period.</li><li>Charged today: <strong className="text-ink">{summary.price}</strong></li></ul>
      </>:<p className="text-body-sm text-ink-muted">Your new card replaces the one on file for this subscription and for future invoices. Nothing is charged now.</p>}
      <p className="inline-block rounded-full bg-spark-soft px-2.5 py-1 text-caption font-bold uppercase tracking-wider text-spark-ink">Stripe sandbox · no real charges</p>
      <p className="text-caption text-ink-muted">Use a Stripe test card, for example 4242 4242 4242 4242 with any future date and any CVC.</p>
    </div>
    <div className="min-w-0">
      {stripe===undefined?<div role="status" className="space-y-3"><span className="sr-only">Loading the secure payment form…</span><Skeleton className="h-12 rounded-md"/><Skeleton className="h-12 rounded-md"/><Skeleton className="h-12 rounded-md"/></div>
      :stripe===null?<div className="space-y-3"><p role="alert" className="rounded-md border border-attention-ink/40 bg-attention-soft p-3 text-body-sm font-medium text-attention-ink">The secure payment form could not load. Check your connection or content blocker. Nothing was charged.</p><div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11" onClick={()=>setAttempt(n=>n+1)}>Try again</Button><Button type="button" variant="secondary" className="min-h-11" onClick={onBack}><ArrowLeft className="size-4" aria-hidden="true"/>Back</Button></div></div>
      :<CheckoutElementsProvider stripe={stripe} options={options}><Form summary={summary} amount={amount} onDone={onDone} onBack={onBack}/></CheckoutElementsProvider>}
    </div>
  </section>;
}
