import assert from 'node:assert/strict';
import {build} from 'esbuild';

// WH-043 first slice: the capacity ledger (src/capacity-ledger.ts) with explicitly synthetic terms. Pure functions over plain data: no database, network, provider, model or
// Stripe call, no schema, nothing wired. Every operation is followed by a conservation check: units are never created or destroyed except by a grant or a rollover carry.
const bundle=await build({stdin:{contents:"export * from './src/capacity-ledger';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const T=1_000_000,DAY=86400000;
const throws=(fn,code)=>assert.throws(fn,e=>e.code===code,String(code));
const sum=(xs,f)=>xs.reduce((s,x)=>s+f(x),0);
// granted - carried-out = remaining + expired + held + consumed - refunded, summed over every lot and reservation.
const conserved=l=>{
 const granted=sum(l.lots,x=>x.granted)-sum(l.lots,x=>x.carriedUnits);
 const held=sum(Object.values(l.reservations).filter(r=>r.state==='held'),r=>r.units);
 const net=sum(Object.values(l.reservations).filter(r=>r.state==='settled'),r=>r.settledUnits-r.refundedUnits);
 assert.equal(granted,sum(l.lots,x=>x.remaining)+sum(l.lots,x=>x.expiredUnits)+held+net,'units are conserved');
 for(const x of l.lots)assert.ok(x.remaining>=0&&Number.isSafeInteger(x.remaining),'no negative or fractional balance');
 return l;
};
const run=(l,fn,...a)=>conserved(m[fn](l,...a).ledger);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const base=()=>{let l=m.emptyLedger();l=run(l,'grant',{id:'m1',kind:'monthly',periodKey:'2026-11',units:100*T,at:1,expiresAt:30*DAY});l=run(l,'grant',{id:'p1',kind:'purchased',periodKey:'2026-11',units:50*T,at:1,expiresAt:null,consentRef:'consent-1'});return l;};

await check('holds use the earliest-expiring lot first, never overdraw, and a shortfall holds nothing',async()=>{
 let l=run(base(),'reserve',{id:'r1',units:120*T,at:10});
 assert.equal(l.lots.find(x=>x.id==='m1').remaining,0);assert.equal(l.lots.find(x=>x.id==='p1').remaining,30*T,'the open-ended purchased lot is used last');
 throws(()=>m.reserve(l,{id:'r2',units:31*T,at:11}),'INSUFFICIENT_CAPACITY');
 assert.equal(Object.hasOwn(l.reservations,'r2'),false,'a refused hold leaves no trace');
 l=run(l,'reserve',{id:'r3',units:30*T,at:12});assert.equal(m.capacityView(l,13,'complete').availableUnits,0);
 throws(()=>m.reserve(l,{id:'r4',units:1,at:14}),'INSUFFICIENT_CAPACITY');
});

await check('replays are no-ops and a changed body under the same id is refused; units must be whole and bounded',async()=>{
 const l=run(base(),'reserve',{id:'r1',units:10*T,at:10});
 const again=m.reserve(l,{id:'r1',units:10*T,at:10});assert.equal(again.replayed,true);assert.equal(again.ledger,l);
 throws(()=>m.reserve(l,{id:'r1',units:11*T,at:10}),'OP_CONFLICT');
 for(const bad of [1.5,-1,Number.NaN,2e12,'5'])throws(()=>m.reserve(base(),{id:'x',units:bad,at:1}),'INVALID_INPUT');
 for(const bad of ['', 'has space','x'.repeat(65)])throws(()=>m.reserve(base(),{id:bad,units:1,at:1}),'INVALID_INPUT');
});

await check('a settlement happens exactly once: the remainder returns, a second settle or a release is refused, work beyond the hold is refused',async()=>{
 let l=run(base(),'reserve',{id:'r1',units:100*T,at:10});
 throws(()=>m.settle(l,{id:'r1',actualUnits:101*T,at:20}),'EXCEEDS_RESERVATION');
 l=run(l,'settle',{id:'r1',actualUnits:60*T,at:20});
 assert.equal(m.capacityView(l,21,'complete').availableUnits,90*T,'150 granted - 60 consumed');assert.equal(l.reservations.r1.settledUnits,60*T);
 assert.equal(m.settle(l,{id:'r1',actualUnits:60*T,at:20}).replayed,true,'the same settlement repeats as a no-op');
 throws(()=>m.settle(l,{id:'r1',actualUnits:61*T,at:20}),'OP_CONFLICT');
 throws(()=>m.settle(l,{id:'r1',actualUnits:60*T,at:99}),'OP_CONFLICT');
 throws(()=>m.release(l,{id:'r1',at:30}),'ALREADY_SETTLED');
 throws(()=>m.settle(l,{id:'ghost',actualUnits:1,at:20}),'UNKNOWN_RESERVATION');
});

await check('conservation holds through an interleaving of concurrent holds, settles, releases and refunds',async()=>{
 let l=base();const ops=[['reserve',{id:'a',units:40*T,at:10}],['reserve',{id:'b',units:70*T,at:11}],['settle',{id:'a',actualUnits:25*T,at:12}],['reserve',{id:'c',units:50*T,at:13}],['release',{id:'b',at:14}],
  ['refund',{id:'f1',reservationId:'a',units:5*T,at:15}],['settle',{id:'c',actualUnits:50*T,at:16}],['reserve',{id:'d',units:10*T,at:17}],['settle',{id:'d',actualUnits:0,at:18}]];
 for(const [fn,a] of ops)l=run(l,fn,a);
 assert.equal(sum(Object.values(l.reservations).filter(r=>r.state==='held'),r=>r.units),0);
 assert.equal(m.capacityView(l,19,'complete').availableUnits,150*T-(25*T-5*T)-50*T);
 // a replayed history in the same order reaches the same ledger
 let r=base();for(const [fn,a] of ops)r=m[fn](r,a).ledger;assert.deepEqual(r,l);
});

await check('refunds settle once, never exceed the consumption, and cannot revive an expired lot',async()=>{
 let l=run(base(),'reserve',{id:'r1',units:100*T,at:10});l=run(l,'settle',{id:'r1',actualUnits:100*T,at:11});
 l=run(l,'refund',{id:'f1',reservationId:'r1',units:30*T,at:12});assert.equal(l.reservations.r1.refundedUnits,30*T);
 assert.equal(m.refund(l,{id:'f1',reservationId:'r1',units:30*T,at:12}).replayed,true);throws(()=>m.refund(l,{id:'f1',reservationId:'r1',units:31*T,at:12}),'OP_CONFLICT');
 throws(()=>m.refund(l,{id:'f2',reservationId:'r1',units:71*T,at:13}),'REFUND_EXCEEDS_SETTLEMENT');
 throws(()=>m.refund(run(base(),'reserve',{id:'h',units:1,at:1}),{id:'f3',reservationId:'h',units:1,at:2}),'NOT_SETTLED');
 // the refunded monthly units come back after the month ended: expired, not revived
 const late=run(l,'refund',{id:'f4',reservationId:'r1',units:10*T,at:40*DAY});
 assert.equal(late.lots.find(x=>x.id==='m1').expiredUnits>=10*T,true);
});

await check('expiry loses unspent units, leaves holds alone, and returned units to an expired lot expire',async()=>{
 let l=run(base(),'reserve',{id:'r1',units:80*T,at:10});
 l=run(l,'expire',31*DAY);assert.equal(l.lots.find(x=>x.id==='m1').remaining,0);assert.equal(l.lots.find(x=>x.id==='m1').expiredUnits,20*T);assert.equal(l.reservations.r1.state,'held');
 l=run(l,'release',{id:'r1',at:32*DAY});assert.equal(l.lots.find(x=>x.id==='m1').expiredUnits,100*T,'the 80 units that came back after expiry are expired');
 assert.equal(m.capacityView(l,33*DAY,'complete').availableUnits,50*T,'only the open-ended purchased lot is live');
});

await check('rollover carries the smaller of unused fresh units and both allowances, only once, never twice over, and never after the boundary',async()=>{
 let l=run(base(),'reserve',{id:'r1',units:40*T,at:10});l=run(l,'settle',{id:'r1',actualUnits:40*T,at:11});// 60 fresh monthly units unused
 l=run(l,'rollover',{id:'ro1',fromPeriod:'2026-11',toPeriod:'2026-12',previousAllowance:100*T,nextAllowance:50*T,at:30*DAY,expiresAt:60*DAY});
 const ro=l.lots.find(x=>x.kind==='rollover');assert.equal(ro.granted,50*T,'capped by the next allowance');assert.equal(l.lots.find(x=>x.id==='m1').remaining,10*T);assert.equal(ro.expiresAt,60*DAY);
 assert.equal(m.rollover(l,{id:'ro1',fromPeriod:'2026-11',toPeriod:'2026-12',previousAllowance:100*T,nextAllowance:50*T,at:30*DAY,expiresAt:60*DAY}).replayed,true);
 throws(()=>m.rollover(l,{id:'ro2',fromPeriod:'2026-11',toPeriod:'2026-12',previousAllowance:100*T,nextAllowance:50*T,at:30*DAY,expiresAt:60*DAY}),'DUPLICATE_ROLLOVER');
 // the December rollover lot cannot carry again: only a monthly lot has a rollover source
 l=run(l,'grant',{id:'m2',kind:'monthly',periodKey:'2026-12',units:100*T,at:30*DAY,expiresAt:60*DAY});
 throws(()=>m.rollover(l,{id:'ro3',fromPeriod:'2026-12-rollover',toPeriod:'2027-01',previousAllowance:100*T,nextAllowance:100*T,at:60*DAY,expiresAt:90*DAY}),'UNKNOWN_LOT');
 const jan=run(l,'rollover',{id:'ro4',fromPeriod:'2026-12',toPeriod:'2027-01',previousAllowance:100*T,nextAllowance:100*T,at:60*DAY,expiresAt:90*DAY});
 assert.equal(jan.lots.find(x=>x.periodKey==='2027-01').granted,100*T,'a full unused December allowance carries; the November rollover units are not carried again');
 // after the boundary the units are already lost
 throws(()=>m.rollover(run(base(),'grant',{id:'m0',kind:'monthly',periodKey:'2026-10',units:5*T,at:1,expiresAt:5*DAY}),{id:'late',fromPeriod:'2026-10',toPeriod:'2026-11',previousAllowance:5*T,nextAllowance:5*T,at:6*DAY,expiresAt:9*DAY}),'LOT_EXPIRED');
 // zero unused carries nothing and creates no lot
 let z=run(base(),'reserve',{id:'all',units:100*T,at:2});z=run(z,'settle',{id:'all',actualUnits:100*T,at:3});z=run(z,'rollover',{id:'roz',fromPeriod:'2026-11',toPeriod:'2026-12',previousAllowance:100*T,nextAllowance:100*T,at:30*DAY,expiresAt:60*DAY});
 assert.equal(z.lots.some(x=>x.kind==='rollover'),false);
});

await check('standard assistance is never metered, a purchased lot needs a consent receipt, and nothing tops up or upgrades automatically',async()=>{
 const l=base();
 assert.equal(m.reserve(l,{id:'s1',units:0,at:5,workClass:'standard-ai'}).ledger,l);throws(()=>m.reserve(l,{id:'s2',units:1,at:5,workClass:'standard-ai'}),'STANDARD_AI_NOT_METERED');
 throws(()=>m.grant(m.emptyLedger(),{id:'p',kind:'purchased',periodKey:'x',units:1,at:1,expiresAt:null}),'INVALID_INPUT');
 throws(()=>m.grant(m.emptyLedger(),{id:'r',kind:'rollover',periodKey:'x',units:1,at:1,expiresAt:5}),'ROLLOVER_BY_RULE_ONLY');
 throws(()=>m.grant(m.emptyLedger(),{id:'o',kind:'monthly',periodKey:'x',units:1,at:1,expiresAt:null}),'INVALID_INPUT');
 throws(()=>m.grant(base(),{id:'dup',kind:'monthly',periodKey:'2026-11',units:1,at:1,expiresAt:5}),'DUPLICATE_PERIOD');
 assert.equal(Object.keys(m).some(k=>/topup|autoTop|upgrade|legacy|revive/i.test(k)),false,'the module offers no automatic top-up, upgrade or legacy balance entry point');
 // an exhausted ledger refuses: it does not borrow, top up or upgrade
 throws(()=>m.reserve(l,{id:'big',units:151*T,at:5}),'INSUFFICIENT_CAPACITY');assert.equal(l.lots.length,2);
});

await check('the balance view never shows full capacity on partial or unknown telemetry and labels the terms as synthetic',async()=>{
 const l=run(base(),'reserve',{id:'r1',units:10*T,at:10});
 for(const t of ['partial','unknown']){const v=m.capacityView(l,11,t);assert.equal(v.state,'unknown');assert.equal(v.availableUnits,null);assert.equal(v.byKind,null);assert.equal(v.heldUnits,10*T);assert.match(v.reason,new RegExp(t));}
 const v=m.capacityView(l,11,'complete');assert.equal(v.state,'known');assert.equal(v.terms,'synthetic-proposal');assert.deepEqual(v.byKind,{monthly:90*T,rollover:0,purchased:50*T});assert.equal(v.nextExpiry,30*DAY);
 throws(()=>m.capacityView(l,11,'full'),'INVALID_INPUT');
});

console.log(`Capacity ledger passed (${cases} cases): earliest-expiry holds with no overdraft, idempotent operations, exactly-once settlement and refunds, conservation after every operation, expiry that never revives, bounded rollover, no metering of standard assistance, no automatic top-up, and an unknown-aware balance view; synthetic terms, no database, provider or network.`);
