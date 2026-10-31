// Explicit read-only display check against the testing site: Whumpo's own plan cards for each audience and interval, matching the
// plan catalogue, with no Stripe script, frame or request. No checkout, account enrollment or message submission.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
if(process.argv.length!==3||process.argv[2]!=='--live')throw Error('Use --live to inspect testing-site pricing.');
const {chromium,expect}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const bundle=await build({stdin:{contents:"export {publicPlans} from './src/plans';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {publicPlans}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const byId=id=>publicPlans.find(p=>p.id===id),dollars=cents=>'$'+cents/100;
const browser=await chromium.launch({headless:true}),errors=[],stripe=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(/stripe\.com/.test(r.url()))stripe.push(r.url());});
 await page.goto('https://whumpo.com/#pricing');
 const pricing=page.locator('#pricing');
 for(const [audience,interval,ids] of [['Personal','Monthly',['starter','personal']],['Personal','Annual',['starter','personal']],['Business','Annual',['business','business-pro']],['Business','Monthly',['business','business-pro']]]){
  await pricing.getByRole('button',{name:audience,exact:true}).click();
  await pricing.getByRole('button',{name:interval,exact:true}).click();
  for(const id of ids){
   const plan=byId(id),card=pricing.locator('li',{has:page.getByRole('heading',{name:plan.name,exact:true})}).first();
   await expect(card).toContainText(dollars(interval==='Annual'?plan.annualCents:plan.monthlyCents));
   await expect(card.getByRole('link',{name:/Explore with an invite/})).toHaveAttribute('href','/workspace?signup=true');
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),audience+' '+interval+' overflow');
 }
 assert.equal(await page.locator('iframe,stripe-pricing-table,script[src*="stripe"]').count(),0);
 const text=await pricing.innerText();assert.doesNotMatch(text,/free trial|payment method required|enterprise/i);
 assert.deepEqual(stripe,[],'the landing page makes no Stripe request');assert.deepEqual(errors,[]);
 console.log('Pricing display passed: four audience/interval selections match the plan catalogue, invite-only CTAs, no Stripe request, frame or script, 390px layout. No checkout or email sent.');
}finally{await browser.close();}
