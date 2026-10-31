import {Suspense,lazy,useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ArrowUpRight,Check,CreditCard,RefreshCw} from 'lucide-react';
import {api,send,message,queryClient} from './lib/api';
import {Button} from './components/ui/button';
import {Skeleton} from './components/ui/skeleton';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from './components/ui/dialog';
import {StatusBadge} from './components/whumpo/status-badge';
import {publicPlans} from '../../src/plans';
import {rememberBillingReturn,takeBillingReturn} from './lib/workspace-navigation';

// Stripe.js and the Elements SDK load only when a card is actually being collected.
const StripeCheckout=lazy(()=>import('./stripe-checkout'));

type Pending={id:string;plan_id:string;interval:'month'|'year';amount_cents:number};
type Status={enabled:boolean;publishableKey:string|null;testMode:true;hasCustomer:boolean;pending:Pending|null;subscription:null|{id:string;status:string;cancel_at_period_end:number;period_end:number;payment_status:string|null;plan_id:string;interval:string;amount_cents:number};invoices:{id:string;plan_id:string;amount_cents:number;interval:string;starts_at:number;ends_at:number;hosted_url:string|null;created_at:number}[]};
type Card={brand:string;last4:string;expMonth:number;expYear:number};
type Collecting={kind:'subscription'|'payment-method';clientSecret:string;plan_id?:string;interval?:'month'|'year';amount_cents?:number};
const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(cents/100);
const date=(seconds:number)=>new Date(seconds*1000).toLocaleDateString();
const brandName=(brand:string)=>brand==='amex'?'American Express':brand.charAt(0).toUpperCase()+brand.slice(1);
const sessionOf=(clientSecret:string)=>clientSecret.split('_secret_')[0];
const alertClass='text-body-sm font-medium rounded-md border border-attention-ink/40 bg-attention-soft text-attention-ink p-3';
export function SubscriptionPanel({onboarding=false}:{onboarding?:boolean}){
 const q=useQuery({queryKey:['subscription'],queryFn:()=>api<Status>('/billing/subscription')}),[interval,setInterval]=useState<'month'|'year'>('month'),[selected,setSelected]=useState('starter'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[collecting,setCollecting]=useState<Collecting|null>(null),[confirmCancel,setConfirmCancel]=useState(false),[bankAction,setBankAction]=useState<{invoiceUrl:string|null}|null>(null);
 const attempted=useRef<Pending|null>(null),locked=useRef(false),returned=useRef(false),heading=useRef<HTMLHeadingElement>(null),wasCollecting=useRef(false),cancelTrigger=useRef<HTMLButtonElement>(null),d=q.data,plan=publicPlans.find(p=>p.id===selected)!;
 const card=useQuery({queryKey:['payment-method'],queryFn:()=>api<{card:Card|null}>('/billing/payment-method'),enabled:!!d?.enabled&&d.hasCustomer&&!onboarding});
 async function action(work:()=>Promise<void>){if(locked.current)return;locked.current=true;setBusy(true);setError('');setNotice('');setBankAction(null);try{await work();}catch(e){setError(message(e));}finally{locked.current=false;setBusy(false);}}
 async function refresh(){const latest=await send<Status>('/billing/subscription/refresh');queryClient.setQueryData(['subscription'],latest);await Promise.all([queryClient.invalidateQueries({queryKey:['billing']}),queryClient.invalidateQueries({queryKey:['dashboard']}),queryClient.invalidateQueries({queryKey:['payment-method']})]);}
 async function manage(path:string,done:string){const latest=await send<Status&{actionRequired?:{invoiceUrl:string|null}}>(path);queryClient.setQueryData(['subscription'],latest);await Promise.all([queryClient.invalidateQueries({queryKey:['billing']}),queryClient.invalidateQueries({queryKey:['dashboard']})]);setBankAction(latest.actionRequired??null);if(!latest.actionRequired)setNotice(done);}
 async function savePaymentMethod(session:string){await send('/billing/payment-method/complete',{session});await queryClient.invalidateQueries({queryKey:['payment-method']});setCollecting(null);setNotice('Your new card is saved and will be used for future invoices.');}
 // A redirect return (a redirect-based payment method, or a reload mid-3D-Secure) reconciles from the saved checkout, never from the URL.
 useEffect(()=>{
  if(!d?.enabled||returned.current)return;
  // The workspace strips the URL before this panel mounts, so it leaves the return in memory; a direct load still has it in the URL.
  const direct=new URLSearchParams(location.search);if(direct.has('checkout')||direct.has('payment_method'))rememberBillingReturn(location.search);
  const back=takeBillingReturn();
  if(!back)return;
  returned.current=true;
  const url=new URL(location.href);for(const key of ['checkout','payment_method','session_id'])url.searchParams.delete(key);history.replaceState(history.state,'',url);
  void action(async()=>{if(back.kind==='payment-method'&&back.session)await savePaymentMethod(back.session);await refresh();});
 },[d?.enabled]);
 useEffect(()=>{if(wasCollecting.current&&!collecting)heading.current?.focus();wasCollecting.current=!!collecting;},[collecting]);
 async function checkout(pending?:Pending){
  const attempt=pending??attempted.current??{id:crypto.randomUUID(),plan_id:selected,interval,amount_cents:interval==='month'?plan.monthlyCents:plan.annualCents};attempted.current=attempt;
  const result=await send<{clientSecret?:string;complete?:boolean}>('/billing/subscription/checkout',{id:attempt.id,plan:attempt.plan_id,interval:attempt.interval});
  if(result.clientSecret)setCollecting({kind:'subscription',clientSecret:result.clientSecret,plan_id:attempt.plan_id,interval:attempt.interval,amount_cents:attempt.amount_cents});
  else {await refresh();attempted.current=null;}
 }
 // A "saved checkout is refreshed" 409 means the order is spent; the next attempt must be a new order.
 async function startCheckout(pending?:Pending){try{await checkout(pending);}catch(e){if((e as {status?:number}).status===409){attempted.current=null;await refresh().catch(()=>{});}throw e;}}
 async function updateCard(){const result=await send<{clientSecret:string}>('/billing/payment-method/setup');setCollecting({kind:'payment-method',clientSecret:result.clientSecret});}
 if(q.isPending)return <div role="status" className="space-y-3"><span className="sr-only">Checking sandbox billing…</span><Skeleton className="h-40 rounded-lg"/></div>;
 if(q.error)return <div className="rounded-lg border border-attention-ink/40 bg-attention-soft p-4 sm:p-5 space-y-3"><p role="alert" className="text-body-sm font-medium text-attention-ink">{message(q.error)}</p><Button variant="secondary" className="min-h-11" onClick={()=>void q.refetch()}>Try billing again</Button>{onboarding&&<p className="text-body-sm text-ink-muted">You can still start your project on Explore below.</p>}</div>;
 const invoiceHistory=<div className="border-t pt-5"><h3 className="text-heading">Paid test invoices</h3>{!d?.invoices.length?<p className="mt-3 text-body-sm text-ink-muted">Invoices appear after Stripe confirms payment.</p>:<ul className="mt-3 divide-y">{d?.invoices.map(invoice=><li key={invoice.id} className="py-3 flex flex-wrap items-center justify-between gap-3"><div><p className="text-body-sm font-medium">{money(invoice.amount_cents)} · {date(invoice.created_at)}</p><p className="text-body-sm text-ink-muted">Access: {date(invoice.starts_at)}–{date(invoice.ends_at)}</p></div>{invoice.hosted_url&&<Button variant="secondary" className="min-h-11" asChild><a href={invoice.hosted_url} target="_blank" rel="noopener noreferrer">View invoice<ArrowUpRight className="size-4" aria-hidden="true"/></a></Button>}</li>)}</ul>}</div>;
 if(!d?.enabled||!d.publishableKey)return <section className="rounded-lg border bg-surface-raised shadow-md p-5"><h2 className="text-heading">Billing</h2><p className="mt-2 text-body-sm text-ink-muted">Checkout isn&apos;t open yet. Explore is available without a card.</p>{!onboarding&&(d?.subscription||d?.invoices.length)?<div className="mt-5 space-y-4">{d.subscription&&<p className="text-body-sm">Your last subscription: <strong>{publicPlans.find(p=>p.id===d.subscription!.plan_id)?.name}</strong>, {d.subscription.status.replaceAll('_',' ')}. Changes are paused while checkout is closed.</p>}{invoiceHistory}</div>:null}</section>;
 const sub=d.subscription,active=sub&&!['canceled','incomplete_expired'].includes(sub.status),pending=d.pending??attempted.current,subPlan=sub&&publicPlans.find(p=>p.id===sub.plan_id);
 // Only a failed or open invoice is an alarm; a draft invoice (a renewal being prepared) is not.
 const pastDue=!!sub&&!!active&&(['past_due','unpaid'].includes(sub.status)||['open','uncollectible'].includes(sub.payment_status??''));
 const manageable=!onboarding&&!!sub&&!!active;
 if(collecting){
  const p=publicPlans.find(x=>x.id===collecting.plan_id),amount=collecting.amount_cents?money(collecting.amount_cents)+'/'+collecting.interval:'';
  return <section aria-label="Sandbox checkout" className="rounded-lg border bg-surface-raised shadow-md p-4 sm:p-6 space-y-4">
   <Suspense fallback={<div role="status" className="space-y-3"><span className="sr-only">Loading the secure payment form…</span><Skeleton className="h-40 rounded-lg"/></div>}>
    <StripeCheckout clientSecret={collecting.clientSecret} publishableKey={d.publishableKey} amount={amount} summary={{kind:collecting.kind,planName:p?.name,price:collecting.amount_cents?money(collecting.amount_cents):undefined,interval:collecting.interval}}
     onBack={()=>setCollecting(null)}
     onDone={async()=>{if(collecting.kind==='subscription'){attempted.current=null;await refresh();setCollecting(null);setNotice('Payment received. Your plan updates as soon as Stripe confirms it.');}else await savePaymentMethod(sessionOf(collecting.clientSecret));}}/>
   </Suspense>
  </section>;
 }
 return <section aria-label="Sandbox billing" className="rounded-lg border bg-surface-raised shadow-md p-4 sm:p-6 space-y-5">
  <div className="flex items-start justify-between gap-3"><div><p className="inline-block rounded-full bg-spark-soft px-2.5 py-1 text-caption font-bold uppercase tracking-wider text-spark-ink">Stripe sandbox · no real charges</p><h2 ref={heading} tabIndex={-1} className="mt-2 text-heading">{onboarding?'Try a plan with your first project':'Your subscription'}</h2></div><CreditCard className="size-5 shrink-0 text-link" aria-hidden="true"/></div>
  <p className="text-body-sm text-ink-muted">{onboarding?'Optional. Keep Explore for free, or test a subscription using a Stripe test card.':'Use test cards only. These subscriptions, payments and invoices are for testing.'} Standard AI help stays included under fair use.</p>
  {notice&&<p role="status" className="text-body-sm font-medium rounded-md border border-ready-ink/40 bg-ready-soft text-ready-ink p-3">{notice}</p>}
  {sub&&<div className="rounded-md bg-surface-sunken p-4 space-y-2"><p className="font-semibold">{subPlan?.name} · {money(sub.amount_cents)}/{sub.interval==='year'?'year':'month'}</p><p><StatusBadge className="capitalize" status={(sub.status==='active'&&!sub.cancel_at_period_end&&!pastDue?'ready':['canceled','incomplete_expired'].includes(sub.status)||pastDue?'attention':'working')}>{sub.status.replaceAll('_',' ')}</StatusBadge></p><p className="text-body-sm text-ink-muted">{sub.cancel_at_period_end?'Cancellation scheduled for ':sub.status==='canceled'?'Subscription ended; paid access runs through its invoice dates. Last period ended ':'Current period ends '}{date(sub.period_end)}.</p>
   {manageable&&<p className="text-body-sm text-ink-muted" aria-live="polite">{card.isPending?'Checking the card on file…':card.data?.card?<>Card on file: <strong className="text-ink">{brandName(card.data.card.brand)} ending {card.data.card.last4}</strong>, expires {String(card.data.card.expMonth).padStart(2,'0')}/{card.data.card.expYear}.</>:card.error?'The card on file could not be read right now.':'No card on file.'}</p>}</div>}
  {bankAction&&<div role="alert" className="rounded-md border border-attention-ink/40 bg-attention-soft p-4 space-y-3"><p className="text-body-sm font-medium text-attention-ink">Your bank needs you to confirm this payment (3D Secure). It has not been charged yet.</p>{bankAction.invoiceUrl&&<Button variant="secondary" className="min-h-11" asChild><a href={bankAction.invoiceUrl} target="_blank" rel="noopener noreferrer">Open the invoice to confirm<ArrowUpRight className="size-4" aria-hidden="true"/></a></Button>}<p className="text-body-sm text-ink-muted">After confirming, use Refresh billing. You can also update your payment method and retry.</p></div>}
  {pastDue&&manageable&&<div role="alert" className="rounded-md border border-attention-ink/40 bg-attention-soft p-4 space-y-3"><p className="text-body-sm font-medium text-attention-ink">Your latest payment did not go through. Your paid access is unchanged until its end date, and it only extends once a payment succeeds.</p><div className="flex flex-wrap gap-2"><Button className="min-h-11" disabled={busy} onClick={()=>void action(updateCard)}>Update payment method</Button><Button variant="secondary" className="min-h-11" disabled={busy} onClick={()=>void action(()=>manage('/billing/subscription/retry','Payment retried. Your plan updates once Stripe confirms it.'))}>Retry payment</Button></div></div>}
  {manageable&&<div className="flex flex-wrap gap-2">
   {!pastDue&&<Button variant="secondary" className="min-h-11" disabled={busy} onClick={()=>void action(updateCard)}>Update payment method</Button>}
   {sub!.cancel_at_period_end?<Button variant="secondary" className="min-h-11" disabled={busy} onClick={()=>void action(()=>manage('/billing/subscription/resume','Subscription resumed. It will renew on '+date(sub!.period_end)+'.'))}>Resume subscription</Button>:<Button ref={cancelTrigger} variant="quiet" className="min-h-11" disabled={busy} onClick={()=>setConfirmCancel(true)}>Cancel subscription</Button>}
  </div>}
  <Dialog open={confirmCancel} onOpenChange={v=>{if(!busy)setConfirmCancel(v);}}><DialogContent onCloseAutoFocus={e=>{e.preventDefault();(cancelTrigger.current??heading.current)?.focus();}}><DialogHeader><DialogTitle>Cancel your subscription?</DialogTitle><DialogDescription>{sub?`Your ${subPlan?.name} plan stays active until ${date(sub.period_end)}. It will not renew after that, and your account returns to Explore. You are not charged again, and you can resume any time before ${date(sub.period_end)}.`:''}</DialogDescription></DialogHeader>{error&&<p role="alert" className={alertClass}>{error}</p>}<DialogFooter><Button variant="secondary" className="min-h-11" disabled={busy} onClick={()=>setConfirmCancel(false)}>Keep subscription</Button><Button variant="destructive" className="min-h-11" disabled={busy} onClick={()=>void action(async()=>{await manage('/billing/subscription/cancel','Cancellation scheduled. Your plan stays active until '+date(sub!.period_end)+'.');setConfirmCancel(false);})}>Cancel at end of period</Button></DialogFooter></DialogContent></Dialog>
  {pending&&!active&&<div className="space-y-3 rounded-md border p-4"><p className="text-body-sm">Your {publicPlans.find(p=>p.id===pending.plan_id)?.name} checkout is saved: {money(pending.amount_cents)}/{pending.interval==='year'?'year':'month'}.</p><Button className="min-h-11" disabled={busy} onClick={()=>void action(()=>startCheckout(pending))}>Resume test checkout<ArrowUpRight className="size-4" aria-hidden="true"/></Button><details className="text-body-sm text-ink-muted"><summary className="min-h-11 cursor-pointer py-3 font-medium text-ink">What to know</summary><p>Leaving the payment form does not cancel an open checkout. It expires after one hour; refresh to check its status.</p></details></div>}
  {!active&&!pending&&<details open={!onboarding} className="space-y-4"><summary className="min-h-11 flex cursor-pointer items-center font-medium">{onboarding?'Choose an optional test plan':'Choose a sandbox plan'}</summary>
   <div role="group" aria-label="Billing interval" className="grid grid-cols-2 gap-2">{(['month','year'] as const).map(value=><Button key={value} className="min-h-11" variant={interval===value?'primary':'secondary'} aria-pressed={interval===value} disabled={busy} onClick={()=>setInterval(value)}>{value==='month'?'Monthly':'Annual'}</Button>)}</div>
   {interval==='year'&&<p className="text-caption text-ink-muted">Annual billing saves two months compared with monthly billing.</p>}
   <fieldset disabled={busy} className="grid gap-2 sm:grid-cols-2"><legend className="sr-only">Sandbox plan</legend>{publicPlans.filter(p=>p.monthlyCents).map(p=><label key={p.id} className={'min-h-20 cursor-pointer rounded-md border-2 p-4 flex items-center gap-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus-ring '+(selected===p.id?'border-link bg-action-soft':'border-line-strong')}><input type="radio" name={onboarding?'welcome-plan':'billing-plan'} value={p.id} checked={selected===p.id} onChange={()=>setSelected(p.id)} className="size-4 shrink-0"/><span><span className="block font-semibold">{p.name}</span><span className="text-body-sm text-ink-muted">{money(interval==='month'?p.monthlyCents:p.annualCents)}/{interval==='month'?'month':'year'}</span></span>{selected===p.id&&<Check className="size-4 ml-auto text-link" aria-hidden="true"/>}</label>)}</fieldset>
   <p className="text-body-sm">Test subscription: <strong>{money(interval==='month'?plan.monthlyCents:plan.annualCents)} every {interval==='month'?'month':'year'}</strong>, until canceled. You will review the order and confirm on the next step.</p>
   <details className="text-body-sm text-ink-muted"><summary className="min-h-11 cursor-pointer py-3 font-medium text-ink">What to know</summary><p>Domain benefits, advanced model credits and resource top-ups are not included in this sandbox purchase.</p></details>
   <Button className="h-auto min-h-12 w-full whitespace-normal py-3 text-center" disabled={busy} onClick={()=>void action(()=>startCheckout())}>Continue to payment<ArrowUpRight className="size-4" aria-hidden="true"/></Button>
  </details>}
  {(!onboarding||d.hasCustomer||pending)&&<div className="flex flex-wrap gap-2"><Button variant="secondary" className="min-h-11" disabled={busy} onClick={()=>void action(refresh)}><RefreshCw aria-hidden="true" className={'size-4 '+(busy?'motion-safe:animate-spin':'')}/>Refresh billing</Button></div>}
  {error&&!confirmCancel&&<p role="alert" className={alertClass}>{error}</p>}
  {!onboarding&&invoiceHistory}
 </section>;
}
