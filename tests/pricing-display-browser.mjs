// Explicit read-only display check against the testing site and real Stripe
// pricing embeds. No checkout, account enrollment or message submission.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
if(process.argv.length!==3||process.argv[2]!=='--live')throw Error('Use --live to inspect testing-site pricing and Enterprise composer navigation.');
const {chromium,expect}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const configuration=JSON.parse(await readFile('frontend/public/stripe-pricing.json','utf8'));
const browser=await chromium.launch({headless:true}),results=[],errors=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('https://whumpo.com/#pricing');
 const pricing=page.locator('#pricing');
 for(const [audience,interval] of [['Personal','Monthly'],['Personal','Annual'],['Business','Annual'],['Business','Monthly']]){
  await pricing.getByRole('button',{name:audience,exact:true}).click();
  await pricing.getByRole('button',{name:interval,exact:true}).click();
  await expect(pricing.locator('stripe-pricing-table')).toHaveAttribute('pricing-table-id',configuration[audience.toLowerCase()+interval+'TableId']);
  await expect(pricing.locator('iframe')).toHaveCount(1);
  const frame=await(await pricing.locator('iframe').elementHandle()).contentFrame();
  await expect(frame.getByRole('button',{name:audience==='Personal'?'Start trial':'Subscribe',exact:true})).toHaveCount(2);
  await expect(frame.getByRole('tablist')).toHaveCount(0);
  await expect(pricing.getByText('Test mode. Test checkout does not activate trial or paid access in Whumpo.',{exact:true})).toBeVisible();
  const contact=frame.getByRole('button',{name:'Contact us',exact:true});
  await expect(contact).toHaveCount(audience==='Business'?1:0);
  let contactURL=null;
  if(audience==='Business'){
   await expect(frame.getByText('Enterprise',{exact:true})).toHaveCount(1);
   const navigation=[],sessions=await Promise.all([page.context().newCDPSession(page),page.context().newCDPSession(frame)]);
   try{
    // External-protocol actions in the cross-origin frame are not HTTP requests.
    // Observe both frame navigation and new-window intent; headless Chromium
    // cannot submit an email and this fixture never composes one.
    for(const session of sessions){await session.send('Page.enable');session.on('Page.frameRequestedNavigation',e=>navigation.push(e.url));session.on('Page.windowOpen',e=>navigation.push(e.url));}
    await contact.click();await expect.poll(()=>navigation).toContain('mailto:enterprise@whumpo.com');contactURL='mailto:enterprise@whumpo.com';
   }finally{for(const session of sessions)await session.detach();}
  }
  const text=await frame.locator('body').innerText();assert.match(text,/Sandbox/);
  const amounts=audience==='Personal'?(interval==='Monthly'?['$17','$30']:['$170 billed annually','$300 billed annually']):(interval==='Monthly'?['$79','$139']:['$790 billed annually','$1,390 billed annually']);
  for(const amount of amounts)assert(text.includes(amount),audience+' '+interval+' amount '+amount);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  results.push({audience,interval,amounts,contactURL,overflow:false,testDisclosure:true});
 }
 assert.deepEqual(errors,[]);
 await writeFile('.secrets/usability-pricing-display.json',JSON.stringify({at:new Date().toISOString(),results,scope:'Live testing-site/Stripe display and exact external-protocol intent. No checkout, email sent, mailbox-delivery proof or real-money activation.'},null,2),{mode:0o600});
 console.log('Testing pricing display passed: four table selections, exact intervals/prices, no duplicate interval selector, 390px layout and both Enterprise mailto intents. No checkout or email sent.');
}finally{await browser.close();}
