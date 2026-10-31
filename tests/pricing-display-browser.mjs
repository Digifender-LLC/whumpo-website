// Explicit read-only display check against the testing site. Checkout is blocked (Q-007), so the
// landing page must show the plan cards and "Plans are coming soon" and load no Stripe script.
// No checkout, account enrollment or message submission.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
if(process.argv.length!==3||process.argv[2]!=='--live')throw Error('Use --live to inspect testing-site pricing.');
const configuration=JSON.parse(await readFile('frontend/public/stripe-pricing.json','utf8'));
assert.equal(Object.keys(configuration).some(key=>/TableId$/.test(key)),false,'pricing table ids must stay removed while checkout is blocked');
const {chromium,expect}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const browser=await chromium.launch({headless:true}),errors=[],stripeRequests=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(/stripe\.com/.test(new URL(request.url()).hostname))stripeRequests.push(request.url());});
 await page.goto('https://whumpo.com/#pricing');
 const pricing=page.locator('#pricing');
 for(const audience of ['Personal','Business']){
  await pricing.getByRole('button',{name:audience,exact:true}).click();
  await expect(pricing.getByText('Plans are coming soon',{exact:true})).toBeVisible();
  await expect(pricing.locator('stripe-pricing-table')).toHaveCount(0);
  await expect(pricing.locator('iframe')).toHaveCount(0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 assert.deepEqual(errors,[]);assert.deepEqual(stripeRequests,[]);
 console.log('Pricing display passed: plan cards with "Plans are coming soon", no Stripe table, no Stripe request, 390px layout. No checkout or email sent.');
}finally{await browser.close();}
