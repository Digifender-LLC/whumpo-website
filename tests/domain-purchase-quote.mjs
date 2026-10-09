import assert from 'node:assert/strict';import {build} from 'esbuild';import {createHash} from 'node:crypto';
// WH-193 v1 domain purchase quote checks against src/domain-purchase/quote.ts with the synthetic registrar. Offline:
// no registrar, payment, database, network or model. Order/consent state is covered by tests/domain-purchase-contract.mjs.
const code=await build({stdin:{contents:"export * from './src/domain-purchase/quote';export {createSyntheticRegistrar} from './src/domain-purchase/registrar';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
const rejects=(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code,e.message);return true;});
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const now=2000000,NAME='synthetic-bakery.com';
const registrar=m.createSyntheticRegistrar({prices:{[NAME]:{registration:1200,renewal:1600},'synthetic-premium.com':{registration:45000,renewal:45000,premium:true}}});
const policy={pricing:{markupCents:100,feeCents:25,taxBasisPoints:1000},allowPremium:false};
const owner={coverage:{planId:'personal',interval:'year'},paymentMethod:{kind:'payment-method',id:'pm_Synthetic1'}};
const project={projectId:'project-a',ownerId:'owner-a',revision:7};
const actor={kind:'owner',ownerId:'owner-a'};
const prepare=(o={})=>m.prepareDomainPurchase({actor,request:{contractVersion:1,projectId:'project-a',hostname:NAME},project,owner,registrar,policy,ids:{quoteId:'quote-1',reviewId:'review-1'},now,...o});

// G-D1, G-D2, G-D5, G-D6: versioned closed quote with wholesale/retail split, server funding, adapter version and computed tax.
const {quote,review,consentText}=await prepare();
assert.deepEqual(Object.keys(quote).sort(),['autoRenew','availability','benefit','contractVersion','currency','expiresAt','funding','hostname','initial','operation','ownerId','premium','privacy','projectId','quoteId','quotedAt','registrar','renewal','taxStatus','termYears','termsVersion'].sort());
assert.equal(quote.contractVersion,1);assert.equal(quote.taxStatus,'computed');
assert.deepEqual(quote.initial,{wholesaleCents:1200,retailCents:1300,feeCents:25,taxCents:133,totalCents:1458});
assert.deepEqual(quote.renewal,{wholesaleCents:1600,retailCents:1700,feeCents:25,taxCents:173,totalCents:1898,guaranteed:false});
assert.deepEqual(quote.funding,{payer:'customer',sourceKind:'payment-method',sourceId:'pm_Synthetic1',customerChargeCents:1458,benefitCents:0});
assert.deepEqual(quote.registrar,{adapterId:'synthetic-registrar',adapterVersion:1});
assert.deepEqual(quote.benefit,{eligible:true,coverableWholesaleCents:1200,redemption:'not-enabled'});
assert.equal(quote.autoRenew,false);assert.equal(quote.privacy,'redacted');assert.equal(quote.operation,'register');
assert.equal(quote.quotedAt,now);assert.equal(quote.expiresAt,now+m.domainPurchaseBounds.quoteTtlMs);
assert.ok(!/providerReference|purchaseEnabled|benefitRedeemed/.test(JSON.stringify(quote)));
await rejects(()=>prepare({policy:{...policy,pricing:{...policy.pricing,taxBasisPoints:null}}}),'TAX_UNKNOWN');
const zeroTax=(await prepare({policy:{...policy,pricing:{...policy.pricing,taxBasisPoints:0}}})).quote;
assert.equal(zeroTax.initial.taxCents,0);assert.equal(zeroTax.taxStatus,'computed');

// G-D4: the review binds the quote digest, project revision, funding source and the exact consent text digest.
assert.deepEqual(Object.keys(review).sort(),['consentTextDigest','contractVersion','expiresAt','fundingSourceId','hostname','ownerId','projectId','projectRevision','quoteDigest','quoteId','reviewId'].sort());
assert.equal(review.projectRevision,7);assert.equal(review.fundingSourceId,'pm_Synthetic1');
assert.equal(review.consentTextDigest,sha(consentText));assert.equal(review.quoteDigest,await m.quoteDigest(quote));
assert.equal(review.expiresAt,now+m.domainPurchaseBounds.reviewTtlMs);
for(const phrase of ['Register synthetic-bakery.com for 1 year through synthetic-registrar.','You pay $14.58 now: price $13.00, fees $0.25, tax $1.33','Renewal is currently $18.98 per year and may change.','Auto-renew is off','cannot be refunded'])assert.ok(consentText.includes(phrase),phrase);
const reordered=Object.fromEntries(Object.entries(quote).reverse());assert.equal(await m.quoteDigest(reordered),review.quoteDigest);
for(const change of [{hostname:'another-bakery.com'},{quoteId:'quote-2'},{projectId:'project-b'},{premium:true},{termsVersion:'v2'},{expiresAt:quote.expiresAt-1},{initial:{...quote.initial,taxCents:134,totalCents:1459}},{renewal:{...quote.renewal,wholesaleCents:1601}},{funding:{...quote.funding,sourceId:'pm_Other'}},{registrar:{...quote.registrar,adapterVersion:2}}])
 assert.notEqual(await m.quoteDigest({...quote,...change}),review.quoteDigest,JSON.stringify(change));

// The closed shape rejects every incomplete, non-current or out-of-policy value.
assert.deepEqual(m.validateQuote(structuredClone(quote)),quote);
for(const change of [{initial:{...quote.initial,taxCents:null}},{renewal:undefined},{initial:{...quote.initial,retailCents:NaN}},{initial:{...quote.initial,feeCents:-1}},{initial:{...quote.initial,taxCents:1.5}},{initial:{...quote.initial,wholesaleCents:100001}},
 {currency:'EUR'},{termYears:2},{operation:'renew'},{availability:'unavailable'},{premium:'false'},{hostname:'https://synthetic-bakery.com'},{hostname:'whumpo.com'},{hostname:'*.bakery.com'},{hostname:'BAKERY.COM'},{hostname:'www.'+NAME},
 {quotedAt:quote.expiresAt},{expiresAt:quote.quotedAt+m.domainPurchaseBounds.quoteTtlMs+1},{termsVersion:''},{quoteId:'private\nvalue'},{autoRenew:true},{privacy:'public'},{taxStatus:'unknown'},{contractVersion:2},{legacyPrice:1},
 {funding:{...quote.funding,customerChargeCents:1457}},{funding:{...quote.funding,payer:'platform'}},{funding:{...quote.funding,benefitCents:100}},{benefit:{...quote.benefit,redemption:'redeemed'}},{renewal:{...quote.renewal,guaranteed:true}},{registrar:{adapterId:'synthetic-registrar'}}])
 assert.throws(()=>m.validateQuote({...quote,...change}),e=>e instanceof m.DomainPurchaseError,JSON.stringify(change));

// G-D3: a registrable name (eTLD+1), not just a hostname.
assert.equal(m.registrableName(NAME),NAME);assert.equal(m.registrableName('xn--bcher-kva.com'),'xn--bcher-kva.com');
for(const name of ['www.'+NAME,'shop.'+NAME,'SYNTHETIC.COM','whumpo.com','whumpo.site','bakery.test','bakery.example','bakery.local','https://bakery.com','bakery','192.168.0.1','-bakery.com','bakery.c0m','bakery..com','',null,42])
 assert.throws(()=>m.registrableName(name),e=>e.code==='INVALID_HOSTNAME',String(name));
await rejects(()=>prepare({request:{contractVersion:1,projectId:'project-a',hostname:'www.'+NAME}}),'INVALID_HOSTNAME');

// Only project and hostname come from the caller; foreign projects, unavailable or premium names and missing funding refuse.
await rejects(()=>prepare({request:{contractVersion:1,projectId:'project-a',hostname:NAME,priceCents:1}}),'CLIENT_AUTHORITY');
await rejects(()=>prepare({actor:{kind:'owner',ownerId:'owner-b'}}),'FOREIGN_OWNER');
await rejects(()=>prepare({project:{...project,projectId:'project-b'}}),'FOREIGN_OWNER');
await rejects(()=>prepare({actor:{kind:'visitor',ownerId:'owner-a'}}),'NOT_AUTHORIZED');
await rejects(()=>prepare({request:{contractVersion:1,projectId:'project-a',hostname:'synthetic-unpriced.com'}}),'UNAVAILABLE');
await rejects(()=>prepare({request:{contractVersion:1,projectId:'project-a',hostname:'synthetic-premium.com'}}),'PREMIUM_NOT_OFFERED');
await rejects(()=>prepare({owner:{...owner,paymentMethod:null}}),'NO_FUNDING_SOURCE');
await rejects(()=>prepare({owner:{...owner,paymentMethod:{kind:'build-credit',id:'units-a'}}}),'NO_FUNDING_SOURCE');
assert.equal(registrar.calls.register,0);
assert.equal((await prepare({owner:{...owner,coverage:null}})).quote.benefit.eligible,false);
console.log('Domain quote checks passed: v1 closed quote (version, wholesale/retail, computed tax, funding, adapter version), exact review and consent-text digest binding, registrable-name check, canonical digest, caller authority refusal; no registrar purchase, payment or benefit redemption.');
