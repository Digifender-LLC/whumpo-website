/** WH-018 slice 1: stop-new-work state machine and guards. Pure: each call returns a new record or throws a ClosureError
 * with a stable code. No clock, storage or provider access; time and facts are inputs. The durable table, the owner
 * session lookup and every external cleanup step belong to later slices and must repeat these predicates in their own
 * committing statements.
 *
 * requested -> reviewed -> confirmed -> quiescing -> closed, plus cancelled (owner, before closed) and failed (system). */
import {check,plain,isCount,settleFirstKeys,buildReview,checkCounts,type Counts} from './review';

export const states=Object.freeze(['requested','reviewed','confirmed','quiescing','closed','cancelled','failed'] as const);
export type State=typeof states[number];
export const terminalStates:readonly State[]=Object.freeze(['closed','cancelled','failed']);
export const events=Object.freeze(['review','confirm','quiesce','close','cancel','fail'] as const);
export type EventName=typeof events[number];
export const refusalCodes=Object.freeze(['invalid-input','invalid-inventory','unknown-category','unknown-class','invalid-lifecycle','invalid-transition','terminal-state','stale-revision','owner-required','fresh-auth-required','review-mismatch','preservation-hold','provider-work-open','billing-pending','inventory-stale'] as const);
/** Same window as the identity engine's fresh-passkey proof (10 minutes). */
export const freshAuthMs=10*60000;

export type Closure={accountId:string;state:State;revision:number;requestedAt:number;at:number;reviewDigest:string|null;quiescedAt:number|null;failure:string|null;history:State[]};
export type Facts={counts:Counts;pendingBilling:number;observedAt:number};
export type Actor='owner'|'system'|'model';
export type Input={event:EventName;actor:Actor;at:number;expectedRevision:number;
 classes?:unknown;counts?:unknown;freshAuthAt?:number;reviewDigest?:string;facts?:Facts;failure?:string};

const time=isCount;
export function requestClosure(accountId:unknown,at:unknown):Closure {
 check(typeof accountId==='string'&&accountId.length>0&&accountId.length<=128&&time(at),'invalid-input');
 return {accountId,state:'requested',revision:1,requestedAt:at,at,reviewDigest:null,quiescedAt:null,failure:null,history:['requested']};
}

/** The close guards. Facts must be observed after stop-new-work began, or the final inventory is stale. A hold blocks
 * confirm as well (see transition); open provider work and pending billing block close only, because they settle while
 * quiescing. */
export function checkClosable(facts:Facts,quiescedAt:number):void {
 check(plain(facts)&&time(facts.observedAt)&&time(facts.pendingBilling),'invalid-input','facts');
 checkCounts(facts.counts);
 check(facts.observedAt>=quiescedAt,'inventory-stale');
 check(!facts.counts.activePreservationHolds,'preservation-hold');
 check(!settleFirstKeys.some(k=>facts.counts[k]),'provider-work-open');
 check(facts.pendingBilling===0,'billing-pending');
}

export function transition(rec:Closure,input:Input):Closure {
 check(plain(input)&&events.includes(input.event)&&time(input.at)&&Number.isSafeInteger(input.expectedRevision)&&['owner','system','model'].includes(input.actor),'invalid-input');
 check(!terminalStates.includes(rec.state),'terminal-state',rec.state);
 check(input.expectedRevision===rec.revision,'stale-revision');
 check(input.at>=rec.at,'invalid-input','time went backwards');
 const next=(state:State,extra:Partial<Closure>={}):Closure=>({...rec,...extra,state,revision:rec.revision+1,at:input.at,history:[...rec.history,state]});
 // A model, a link or a system job never approves or abandons a closure on the owner's behalf.
 const owner=()=>check(input.actor==='owner','owner-required');
 switch(input.event){
  case 'review':
   check(rec.state==='requested','invalid-transition');owner();
   return next('reviewed',{reviewDigest:buildReview(input.counts,input.classes).digest});
  case 'confirm':{
   check(rec.state==='reviewed','invalid-transition');owner();
   check(time(input.freshAuthAt)&&input.freshAuthAt<=input.at&&input.at-input.freshAuthAt<=freshAuthMs,'fresh-auth-required');
   const review=buildReview(input.counts,input.classes);
   check(!review.blockers.includes('preservation-hold'),'preservation-hold');
   // Both the digest the owner saw and the inventory now must equal the reviewed one.
   check(input.reviewDigest===rec.reviewDigest&&review.digest===rec.reviewDigest,'review-mismatch');
   return next('confirmed');
  }
  case 'quiesce':check(rec.state==='confirmed'&&input.actor==='system','invalid-transition');return next('quiescing',{quiescedAt:input.at});
  case 'close':
   check(rec.state==='quiescing'&&input.actor==='system','invalid-transition');
   checkClosable(input.facts as Facts,rec.quiescedAt as number);
   return next('closed');
  case 'cancel':check(['requested','reviewed','confirmed','quiescing'].includes(rec.state),'invalid-transition');owner();return next('cancelled');
  case 'fail':
   check(['confirmed','quiescing'].includes(rec.state)&&input.actor==='system','invalid-transition');
   check(typeof input.failure==='string'&&/^[a-z-]{1,64}$/.test(input.failure),'invalid-input','failure code');
   return next('failed',{failure:input.failure});
 }
}
