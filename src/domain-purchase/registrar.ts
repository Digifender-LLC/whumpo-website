/** WH-193 registrar adapter interface and the synthetic in-memory registrar used by tests. A real adapter (WH-195)
 * implements the same three calls, keeps its credentials in a Worker secret binding and parses provider responses
 * into these shapes. check and lookup are read-only; register is the only purchase call. */
export type RegistrarCheck=
 |{name:string;registrable:true;premium:boolean;currency:'USD';registrationWholesaleCents:number;renewalWholesaleCents:number;termsVersion:string}
 |{name:string;registrable:false;reason:string};
export type RegisterRequest={hostname:string;orderRef:string;acknowledgePremium:boolean;autoRenew:false;privacy:'redaction'};
/** Anything other than a well-formed `registered` naming this order, or a definite `rejected`, is an unknown outcome. */
export type RegisterResult=
 |{kind:'registered';hostname:string;orderRef:string;expiresAt:number;chargedWholesaleCents:number}
 |{kind:'rejected';code:string}
 |{kind:'pending'};
/** Transfer-out (WH-196). `beginTransferOut` is the one mutation (unlock for transfer and stop auto-renew), claimed once per request; `authCode` is a read. */
export type TransferOutRequest={hostname:string;requestRef:string};
export type TransferOutResult=|{kind:'unlocked'}|{kind:'rejected';code:string}|{kind:'pending'};
/** "not-found" and "in_progress" are never proof either way. `unlocked` is the transfer lock as the registrar reports it. */
export type RegistrarLookup=
 |{status:'registered';orderRef:string|null;expiresAt:number;renewal:{currency:'USD';wholesaleCents:number};unlocked?:boolean}
 |{status:'failed'|'in_progress';orderRef:string|null}
 |{status:'not-found'};
export interface RegistrarAdapter {
 readonly adapterId:string;
 readonly adapterVersion:number;
 /** Real-time availability and price check. Read-only. */
 check(name:string):Promise<RegistrarCheck>;
 /** The single purchase call. Auto-renew off, privacy redaction, explicit premium acknowledgement, order ID as client reference. */
 register(request:RegisterRequest):Promise<RegisterResult|unknown>;
 /** Read-only lookup by name (registration, attributed workflow or nothing), including the current renewal price. */
 lookup(name:string):Promise<RegistrarLookup>;
 /** Unlock a registration for transfer-out. Anything other than a well-formed `unlocked` or `rejected` is an unknown outcome and is reconciled by `lookup`, never repeated. */
 beginTransferOut(request:TransferOutRequest):Promise<TransferOutResult|unknown>;
 /** Read the transfer authorization code of an unlocked registration. Read-only and repeatable; the caller shows it to the owner and nowhere else. */
 authCode(name:string):Promise<{code:string}|{unavailable:true}|unknown>;
}

type SyntheticPrice={registration:number;renewal:number;premium?:boolean;terms?:string};
type SyntheticOutcome='ok'|'rejected'|'pending'|'timeout-before'|'timeout-after'|'malformed';
type SyntheticTransfer='ok'|'rejected'|'timeout-before'|'timeout-after';
const year=365*86400000;
/** Synthetic in-memory registrar: synthetic names and prices only, no network. Counts every call so tests can prove
 * that register is called at most once per order. `next` scripts the next register outcome. */
export function createSyntheticRegistrar({adapterId='synthetic-registrar',adapterVersion=1,prices={},clock=()=>0}:{adapterId?:string;adapterVersion?:number;prices?:Record<string,SyntheticPrice>;clock?:()=>number}={}){
 const s={prices:structuredClone(prices),registrations:{} as Record<string,{orderRef:string|null;createdAt:number;expiresAt:number}>,workflows:{} as Record<string,{orderRef:string;status:'in_progress'|'succeeded'|'failed'}>,script:[] as SyntheticOutcome[],transferScript:[] as SyntheticTransfer[],unlocked:new Set<string>()};
 const calls={check:0,register:0,lookup:0,transferOut:0,authCode:0},registerLog:string[]=[];
 const record=(hostname:string,orderRef:string|null)=>{const now=clock();return s.registrations[hostname]={orderRef,createdAt:now,expiresAt:now+year};};
 return {
  adapterId,adapterVersion,calls,registerLog,
  setPrice(name:string,price:Partial<SyntheticPrice>){s.prices[name]={...s.prices[name],...price} as SyntheticPrice;},
  /** Someone else registers the name. */
  takeBy(name:string,orderRef:string|null=null){record(name,orderRef);},
  next(kind:SyntheticOutcome){s.script.push(kind);},
  nextTransfer(kind:SyntheticTransfer){s.transferScript.push(kind);},
  /** The owner took the name to another registrar. */
  completeTransfer(name:string){delete s.registrations[name];s.unlocked.delete(name);},
  finishPending(name:string,ok:boolean){const w=s.workflows[name];if(!w)return;w.status=ok?'succeeded':'failed';if(ok)record(name,w.orderRef);},
  async check(name:string):Promise<RegistrarCheck>{
   calls.check++;const p=s.prices[name];
   if(!p||s.registrations[name])return {name,registrable:false,reason:'domain_unavailable'};
   return {name,registrable:true,premium:!!p.premium,currency:'USD',registrationWholesaleCents:p.registration,renewalWholesaleCents:p.renewal,termsVersion:p.terms??'synthetic-terms-1'};
  },
  async register({hostname,orderRef,acknowledgePremium}:RegisterRequest):Promise<unknown>{
   calls.register++;registerLog.push(hostname);
   const kind=s.script.shift()??'ok',p=s.prices[hostname];
   if(kind==='rejected'||!p||s.registrations[hostname]||(p.premium&&!acknowledgePremium))return {kind:'rejected',code:'domain_unavailable'};
   if(kind==='timeout-before')throw Error('synthetic timeout before the registrar acted');
   if(kind==='timeout-after'){record(hostname,orderRef);throw Error('synthetic timeout after the registrar acted');}
   if(kind==='pending'){s.workflows[hostname]={orderRef,status:'in_progress'};return {kind:'pending'};}
   if(kind==='malformed'){record(hostname,orderRef);return {kind:'registered'};}
   const done=record(hostname,orderRef);
   return {kind:'registered',hostname,orderRef,expiresAt:done.expiresAt,chargedWholesaleCents:p.registration};
  },
  async beginTransferOut({hostname}:TransferOutRequest):Promise<unknown>{
   calls.transferOut++;
   const kind=s.transferScript.shift()??'ok';
   if(kind==='rejected'||!s.registrations[hostname])return {kind:'rejected',code:'transfer_locked'};
   if(kind==='timeout-before')throw Error('synthetic timeout before the registrar acted');
   s.unlocked.add(hostname);
   if(kind==='timeout-after')throw Error('synthetic timeout after the registrar acted');
   return {kind:'unlocked'};
  },
  async authCode(name:string):Promise<unknown>{
   calls.authCode++;
   return s.registrations[name]&&s.unlocked.has(name)?{code:`SYNTHETIC-AUTH-${name}`}:{unavailable:true};
  },
  async lookup(name:string):Promise<RegistrarLookup>{
   calls.lookup++;
   const reg=s.registrations[name],p=s.prices[name];
   if(reg)return {status:'registered',orderRef:reg.orderRef,expiresAt:reg.expiresAt,renewal:{currency:'USD',wholesaleCents:p?.renewal??0},unlocked:s.unlocked.has(name)};
   const w=s.workflows[name];if(w)return {status:w.status==='failed'?'failed':'in_progress',orderRef:w.orderRef};
   return {status:'not-found'};
  },
 } satisfies RegistrarAdapter&Record<string,unknown>;
}
