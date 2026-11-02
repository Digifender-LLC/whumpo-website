import assert from 'node:assert/strict';
import {build} from 'esbuild';

// WH-043: customer capacity explanation data (src/capacity-explanation.ts) over the synthetic-terms ledger. Pure functions: no database, network, provider or Stripe call, nothing
// wired to a route, UI, billing or admission path.
const bundle=await build({stdin:{contents:"export * from './src/capacity-ledger';export * from './src/capacity-explanation';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const T=1_000_000,DAY=86400000;
const throws=(fn,code)=>assert.throws(fn,e=>e.code===code,String(code));
const run=(l,fn,...a)=>m[fn](l,...a).ledger;
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const base=()=>{let l=m.emptyLedger();l=run(l,'grant',{id:'m1',kind:'monthly',periodKey:'2026-11',units:100*T,at:1,expiresAt:30*DAY});l=run(l,'grant',{id:'p1',kind:'purchased',periodKey:'2026-11',units:50*T,at:1,expiresAt:null,consentRef:'consent-secret-1'});return l;};
const noBalance=e=>{
 assert.equal(e.state,'still-calculating');
 for(const k of ['balances','availableUnits','monthlyRemainingPercent','exhausted','history'])assert.equal(e[k],null,`${k} is withheld`);
 assert.match(e.text,/^Still calculating/);assert.doesNotMatch(e.text,/available|\d/,'no figure or availability wording');assert.doesNotMatch(JSON.stringify(e),/%/,'no percentage anywhere');
};

await check('partial or unknown telemetry is "still calculating" with no balance, allowance, percentage or history, even on an untouched allowance',()=>{
 const l=base();
 for(const t of ['partial','unknown']){
  const e=m.capacityExplanation(l,2,t);noBalance(e);
  assert.deepEqual(e.period,{key:'2026-11',grantedAt:1,endsAt:30*DAY},'period dates remain');assert.equal(e.nextExpiryAt,30*DAY);assert.equal(e.terms,'synthetic-proposal');
  assert.equal(e.automaticTopUp,false);assert.equal(e.automaticUpgrade,false);assert.equal(e.standardAssistance.debitsUnits,0);
 }
 throws(()=>m.capacityExplanation(l,2,'complete-ish'),'INVALID_INPUT');
});

await check('complete telemetry separates monthly, rollover and purchased units, shows held units and floors the percentage',()=>{
 let l=base();const e0=m.capacityExplanation(l,2,'complete');
 assert.equal(e0.state,'known');assert.equal(e0.monthlyRemainingPercent,100,'an untouched allowance is exactly full');assert.equal(e0.availableUnits,150*T);
 assert.equal(e0.text,'150 units available, 50 units purchased.');
 l=run(l,'reserve',{id:'w1',units:1,at:3});
 const e=m.capacityExplanation(l,4,'complete');
 assert.equal(e.monthlyRemainingPercent,99,'one micro-unit gone is no longer 100%');
 assert.deepEqual(e.balances.monthly,{units:100*T-1,allowance:100*T,expiresAt:30*DAY,expiredUnits:0});
 assert.deepEqual(e.balances.purchased,{units:50*T,expiresAt:null,expiredUnits:0});assert.equal(e.balances.rollover.units,0);
 assert.equal(e.availableUnits,m.capacityView(l,4,'complete').availableUnits);assert.equal(e.heldUnits,1);
 assert.equal(e.text,'149.99 units available, 50 units purchased, 0.01 units held for work in progress.','left rounds down, held rounds up');
});

await check('standard assistance debits zero and leaves no trace; a metered standard reservation is refused',()=>{
 const l=base();const r=m.reserve(l,{id:'s1',units:0,at:2,workClass:'standard-ai'});
 assert.equal(r.ledger,l);assert.deepEqual(m.capacityExplanation(r.ledger,3,'complete'),m.capacityExplanation(l,3,'complete'));
 throws(()=>m.reserve(l,{id:'s2',units:1,at:2,workClass:'standard-ai'}),'STANDARD_AI_NOT_METERED');
 assert.equal(m.capacityExplanation(l,3,'complete').standardAssistance.text,'Standard assistance does not use capacity.');
});

await check('history gives plain-language causes from the ledger operations and never exposes internal ids',()=>{
 let l=base();
 l=run(l,'reserve',{id:'work-secret-a',units:10*T,at:2});l=run(l,'settle',{id:'work-secret-a',actualUnits:7.5*T,at:3});
 l=run(l,'reserve',{id:'work-secret-b',units:2*T,at:4});l=run(l,'release',{id:'work-secret-b',at:5});
 l=run(l,'refund',{id:'refund-secret',reservationId:'work-secret-a',units:T,at:6});
 const e=m.capacityExplanation(l,7,'complete');
 assert.deepEqual(e.history.map(x=>[x.cause,x.units,x.text]),[
  ['monthly-allowance',100*T,'Monthly allowance for 2026-11: 100 units.'],['purchase',50*T,'Purchased with your approval: 50 units.'],
  ['held',10*T,'Held 10 units for work in progress.'],['used',7.5*T,'Finished work used 7.5 units.'],['returned',2.5*T,'2.5 units held but not needed came back.'],
  ['held',2*T,'Held 2 units for work in progress.'],['returned',2*T,'Work did not run; 2 units held came back.'],['refunded',T,'Refunded 1 unit.']]);
 assert.doesNotMatch(JSON.stringify(e),/secret|consent-/,'no consent, reservation or refund ids');
 assert.equal(e.availableUnits,150*T-6.5*T);
 assert.deepEqual(m.capacityExplanation(l,7,'complete',{historyLimit:2}).history.map(x=>x.cause),['returned','refunded'],'the latest lines are kept');
 for(const bad of [-1,201,1.5])throws(()=>m.capacityExplanation(l,7,'complete',{historyLimit:bad}),'INVALID_INPUT');
});

await check('rollover, expiry and exhaustion: carried units show their source, expired units are never shown as available, nothing is bought automatically',()=>{
 let l=run(m.emptyLedger(),'grant',{id:'m1',kind:'monthly',periodKey:'2026-11',units:100*T,at:1,expiresAt:30*DAY});
 l=run(l,'reserve',{id:'w1',units:70*T,at:2});l=run(l,'settle',{id:'w1',actualUnits:70*T,at:3});
 l=run(l,'reserve',{id:'w2',units:5*T,at:4});
 l=run(l,'rollover',{id:'nov-dec',fromPeriod:'2026-11',toPeriod:'2026-12',previousAllowance:100*T,nextAllowance:80*T,at:30*DAY,expiresAt:60*DAY});
 l=run(l,'grant',{id:'m2',kind:'monthly',periodKey:'2026-12',units:80*T,at:30*DAY,expiresAt:60*DAY});
 l=run(l,'expire',30*DAY);l=run(l,'release',{id:'w2',at:30*DAY+1});
 const e=m.capacityExplanation(l,30*DAY+2,'complete');
 assert.deepEqual(e.period,{key:'2026-12',grantedAt:30*DAY,endsAt:60*DAY});
 assert.deepEqual(e.balances.rollover,{units:25*T,fromPeriod:'2026-11',expiresAt:60*DAY,expiredUnits:0});
 assert.equal(e.balances.monthly.units,80*T);assert.equal(e.balances.monthly.expiredUnits,5*T,'a hold released after its lot expired is expired, not revived');
 assert.equal(e.availableUnits,105*T);assert.match(e.history.find(x=>x.cause==='rollover').text,/^Carried 25 units unused in 2026-11 into 2026-12\.$/);
 l=run(l,'reserve',{id:'w3',units:105*T,at:30*DAY+3});l=run(l,'settle',{id:'w3',actualUnits:105*T,at:30*DAY+4});
 const x=m.capacityExplanation(l,30*DAY+5,'complete');
 assert.equal(x.exhausted,true);assert.equal(x.availableUnits,0);assert.equal(x.monthlyRemainingPercent,0);assert.equal(x.automaticTopUp,false);
 assert.match(x.text,/^No capacity is left for metered work\. Standard assistance still costs nothing; .*nothing is bought or upgraded automatically\.$/);
 noBalance(m.capacityExplanation(l,30*DAY+5,'unknown'));
 const after=m.capacityExplanation(l,60*DAY,'complete');assert.equal(after.period,null,'no current period after the last one ends');assert.equal(after.monthlyRemainingPercent,null);
});

await check('unit formatting rounds left down and used up; invalid input and foreign ledgers are refused',()=>{
 assert.equal(m.formatUnits(0,'down'),'0');assert.equal(m.formatUnits(1,'down'),'0');assert.equal(m.formatUnits(1,'up'),'0.01');
 assert.equal(m.formatUnits(999_999,'down'),'0.99');assert.equal(m.formatUnits(999_999,'up'),'1');assert.equal(m.formatUnits(1_234_567*T+50_000,'down'),'1,234,567.05');
 for(const bad of [-1,1.5,Number.NaN,'5'])throws(()=>m.formatUnits(bad,'down'),'INVALID_INPUT');
 throws(()=>m.capacityExplanation({...base(),terms:'live'},2,'complete'),'INVALID_INPUT');throws(()=>m.capacityExplanation({...base(),version:2},2,'complete'),'INVALID_INPUT');
});

await check('seeded random runs: the explanation always agrees with the ledger and never overstates the allowance',()=>{
 let seed=43;const rnd=n=>{seed=(seed*1103515245+12345)%2147483648;return seed%n;};
 for(let round=0;round<40;round++){
  let l=run(m.emptyLedger(),'grant',{id:'m1',kind:'monthly',periodKey:'p1',units:(1+rnd(1000))*T,at:1,expiresAt:1000});
  if(rnd(2))l=run(l,'grant',{id:'b1',kind:'purchased',periodKey:'p1',units:(1+rnd(100))*T,at:1,expiresAt:null,consentRef:'c1'});
  const open=[],settled=[];
  for(let i=0,at=2;i<60;i++,at+=10){
   const k=rnd(4),id=`r${i}`;
   try{
    if(k===0){l=run(l,'reserve',{id,units:1+rnd(50*T),at});open.push(id);}
    else if(k===1&&open.length){const r=open.splice(rnd(open.length),1)[0];l=run(l,'settle',{id:r,actualUnits:rnd(l.reservations[r].units+1),at});settled.push(r);}
    else if(k===2&&open.length){l=run(l,'release',{id:open.splice(rnd(open.length),1)[0],at});}
    else if(k===3&&settled.length){const r=settled[rnd(settled.length)],c=l.reservations[r];if(c.settledUnits>c.refundedUnits)l=run(l,'refund',{id:`f${i}`,reservationId:r,units:1+rnd(c.settledUnits-c.refundedUnits),at});}
   }catch(e){if(e.code!=='INSUFFICIENT_CAPACITY')throw e;}
   const at2=at+1,e=m.capacityExplanation(l,at2,'complete'),v=m.capacityView(l,at2,'complete'),b=e.balances;
   assert.equal(e.availableUnits,v.availableUnits);assert.equal(b.monthly.units+b.rollover.units+b.purchased.units,v.availableUnits);assert.equal(e.heldUnits,v.heldUnits);
   if(at2<1000){const lot=l.lots.find(x=>x.id==='m1');assert.ok(e.monthlyRemainingPercent<=100&&(e.monthlyRemainingPercent===100)===(lot.remaining===lot.granted),'100% only when untouched');}
   noBalance(m.capacityExplanation(l,at2,rnd(2)?'partial':'unknown'));
  }
 }
});

console.log(`capacity explanation: ${cases} cases passed`);
