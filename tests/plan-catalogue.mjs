// Credential-free contract checks across the real public handler, Chat and rendered controls.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function load(contents,options={}){
 const b=await build({stdin:{contents,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,...options});
 return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
}
const {platform,describePlans,launchPackaging}=await load("export {default as platform} from './src/index';export {describePlans} from './src/plans';export {launchPackaging} from './src/plan-features';");
const response=await platform.fetch(new Request('https://whumpo.com/api/plans'),{API_LIMITER:{limit:async()=>({success:true})}},{waitUntil(){throw Error('No background action allowed')}});
assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
const api=await response.json(),byId=id=>api.plans.find(p=>p.id===id);
assert.deepEqual(api.plans.map(p=>p.id),['explore','starter','personal','business','business-pro']);
assert.equal(byId('personal').name,'Creator');assert.equal(byId('creator'),undefined);
assert.deepEqual(api.plans.slice(1).map(p=>[p.monthlyCents,p.annualCents]),[[1700,17000],[3000,30000],[7900,79000],[13900,139000]]);
assert.equal(api.draft,true);assert.equal(api.checkoutMode,'test');assert(!Object.hasOwn(api,'checkoutEnabled'));assert(!Object.hasOwn(api,'creditPack'));assert.equal(api.subscriptionsEnabled,false);
assert.equal(api.featureCatalogue.purpose,'launch-packaging-only');assert.equal(api.featureCatalogue.commercialActivation,false);
assert.equal(api.featureCatalogue.version,1);
const features=api.featureCatalogue.features,ids=features.map(f=>f.id);assert.equal(ids.length,new Set(ids).size);
for(const p of api.plans){
 assert.ok(!('monthlyUnits' in p)&&!('targetStorageGB' in p));
 assert.equal(p.launchFeatures.featureIds.length,new Set(p.launchFeatures.featureIds).size);
 assert.ok(p.launchFeatures.featureIds.every(id=>ids.includes(id)));
 const parent=p.launchFeatures.inherits;if(parent)assert.ok(byId(parent).launchFeatures.featureIds.every(id=>p.launchFeatures.featureIds.includes(id)));
}
for(const id of ['starter','personal'])assert.ok(!byId(id).launchFeatures.featureIds.some(f=>f.startsWith('connections.')));
const providers=['github','cloudflare','gmail','google-calendar','outlook-email','microsoft-calendar','hubspot'];
for(const id of ['business','business-pro'])for(const provider of providers)assert.ok(byId(id).launchFeatures.featureIds.includes('connections.'+provider));
for(const id of ['starter','personal','business','business-pro'])for(const common of ['core.security','core.recovery','core.export','ai.standard'])assert.ok(byId(id).launchFeatures.featureIds.includes(common));
for(const id of ['creator','launch','studio','__proto__','constructor','toString','unknown'])assert.equal(launchPackaging(id),null);
assert.ok(features.every(f=>f.customerAcceptance==='pending'));
assert.ok(features.filter(f=>f.connection).every(f=>f.configuration==='per-account-consent-required'));
assert.equal(features.find(f=>f.id==='creator.guest-feedback').implementation,'private-test');
const chat=describePlans();for(const label of ['Creator: $30/month or $300/year','Creator includes Starter','Business includes Creator','Business Pro includes Business','GitHub','Cloudflare','Gmail','Google Calendar','Outlook email','Microsoft Calendar','HubSpot','no customer credits','expire and can be revoked','no workspace, editing, publishing or spending access','sandbox subscriptions are available when configured','Real payments are not enabled'])assert.ok(chat.includes(label),label);
assert.ok(!chat.includes('Personal:'));
const {renderPreference,renderDetails,renderPricing}=await load("import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {PlanPreferenceField,PlanFeatureDetails} from './frontend/src/plan-features';import {Pricing} from './frontend/src/pricing';export const renderPreference=plan=>renderToStaticMarkup(createElement(PlanPreferenceField,{initialPlan:plan}));export const renderDetails=plan=>renderToStaticMarkup(createElement(PlanFeatureDetails,{planId:plan}));export const renderPricing=()=>renderToStaticMarkup(createElement(Pricing));",{
 tsconfig:'tsconfig.frontend.json',jsx:'automatic',
 banner:{js:"import {createRequire} from 'node:module';const require=createRequire(process.cwd()+'/package.json');"},
 plugins:[{name:'static-link',setup(b){b.onResolve({filter:/^@tanstack\/react-router$/},()=>({path:'link',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'jsx',resolveDir:process.cwd(),contents:"export function Link({to,search,children,...props}){return <a href={to} {...props}>{children}</a>}"}));}}]
});
const pref=renderPreference('personal');assert.match(pref,/<option value="personal" selected="">Creator/);assert.ok(!pref.includes('value="creator"'));
for(const id of ['starter','personal','business','business-pro']){
 const html=renderDetails(id);assert.ok(html.includes(byId(id).name+': planned features'));assert.ok(html.includes('sandbox subscription does not enable them'));assert.ok(html.includes('Standard assistance uses no customer credits'));
 for(const feature of byId(id).launchFeatures.featureIds){const label=features.find(f=>f.id===feature).name;assert.ok(html.includes(label),label);}
}
// The landing page renders Whumpo's own plan cards from the catalogue (the Stripe pricing table is gone): names and prices match the catalogue, nothing claims a trial, and no Stripe script or table element is present.
const landing=renderPricing();assert.ok(landing.includes('The invite-only preview is free'));assert.ok(landing.includes('paid plans are not available yet'));assert.ok(landing.includes('Plan changes and future spending require your approval'));
assert.ok(landing.includes('aria-label="Plans for"')&&landing.includes('aria-label="Billing"'));
for(const id of ['starter','personal'])assert.ok(landing.includes('>'+byId(id).name+'</h3>'),id+' card');
assert.ok(landing.includes('$'+byId('starter').monthlyCents/100)&&landing.includes('$'+byId('personal').monthlyCents/100));
assert.ok(landing.includes('Explore with an invite')&&landing.includes('href="/workspace?signup=true"'));
assert.doesNotMatch(landing,/free trial|Payment method required|Enterprise|stripe-pricing-table|js\.stripe\.com|Loading plans/i);
console.log('Plan catalogue passed: real public API, cumulative four-tier features, seven gated connections, common protections, stable personal ID/prices, no implicit activation, Chat text and rendered pricing/preferences.');
