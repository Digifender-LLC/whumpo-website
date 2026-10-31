// Custom checkout page and in-app billing management in real Chromium, keyboard only, at 360, 390 and 1280 px, plus 200% text
// and dark mode. The built client (Whumpo's real SubscriptionPanel and checkout page) runs against a local stub of /api/billing/*
// and a STAND-IN for Stripe.js served by request interception. The stand-in renders a plain payment form and returns scripted
// confirm results, so this proves Whumpo's layout, focus, error, loading and double-submit behavior and the Appearance mapping.
// It does NOT prove Stripe's own element rendering, card entry or 3D Secure: no request leaves this machine, no Stripe key is read
// and no card is entered. Local dev host only (localhost / 127.0.0.1); the page refuses to run anywhere else.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build as viteBuild} from 'vite';
const {chromium,expect}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-checkout-browser-'),name=`checkout-fixture-${process.pid}`,html=`frontend/${name}.html`,entry=`frontend/${name}.tsx`;
const publishable='pk_test_'+'a'.repeat(40),shots=process.env.WHUMPO_SHOTS;
// What the stand-in Stripe.js does. window.__stripe is read back by the test.
const fakeStripe=`
window.__stripe={confirmCalls:0,next:'success',loadMs:0,options:null,key:null,sdkCalls:0};
window.Stripe=function(key){window.__stripe.key=key;return {_registerWrapper(){},registerAppInfo(){},elements(){},createToken(){},createPaymentMethod(){},confirmCardPayment(){},initCheckoutElementsSdk(options){
 window.__stripe.options=options;window.__stripe.sdkCalls++;
 return {on(){},changeAppearance(){},loadActions(){return new Promise(resolve=>setTimeout(()=>resolve({type:'success',actions:{
  getSession:()=>({canConfirm:true}),
  confirm:async()=>{window.__stripe.confirmCalls++;const mode=window.__stripe.next;
   if(mode==='slow'){await new Promise(r=>setTimeout(r,700));return {type:'success',session:{}};}
   if(mode==='error')return {type:'error',error:{message:'Your card was declined. Try another card.'}};
   return {type:'success',session:{}};}
 }}),window.__stripe.loadMs));},
 createPaymentElement(){return {mount(node){node.innerHTML='<div data-fake-payment-element style="display:grid;gap:12px;padding:4px"><label style="display:grid;gap:4px;font:500 14px system-ui">Card number<input autocomplete="off" inputmode="numeric" style="min-height:44px;padding:0 12px;border:1px solid #738aaa;border-radius:12px;font-size:16px;width:100%;box-sizing:border-box"></label><div style="display:flex;gap:12px"><label style="flex:1;font:500 14px system-ui">Expiry<input style="min-height:44px;width:100%;box-sizing:border-box;padding:0 12px;border:1px solid #738aaa;border-radius:12px;font-size:16px"></label><label style="flex:1;font:500 14px system-ui">CVC<input style="min-height:44px;width:100%;box-sizing:border-box;padding:0 12px;border:1px solid #738aaa;border-radius:12px;font-size:16px"></label></div></div>';},on(){},update(){},destroy(){}};}
 };}};};`;
const state={status:null,cancel:0,invoice:null,card:{brand:'visa',last4:'4242',expMonth:12,expYear:2030},ids:[],calls:[],pastDue:false,hasCustomer:false,closed:false,paymentStatus:null,failRefresh:false,failCancel:false,bank:false,invoices:[],completedSession:null};
const status=()=>({enabled:!state.closed,publishableKey:publishable,testMode:true,hasCustomer:state.hasCustomer,pending:null,invoices:state.invoices,subscription:state.status?{id:'sub_fixture',status:state.pastDue?'past_due':'active',cancel_at_period_end:state.cancel,period_end:Math.floor(Date.UTC(2026,10,30)/1000),payment_status:state.paymentStatus??(state.pastDue?'open':'paid'),plan_id:'personal',interval:'month',amount_cents:3000}:null});
let server,browser,origin;const errors=[];
try{
 await writeFile(html,`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkout acceptance</title></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
 await writeFile(entry,`import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClientProvider} from '@tanstack/react-query';import {queryClient} from './src/lib/api';import {rememberBillingReturn} from './src/lib/workspace-navigation';import {SubscriptionPanel} from './src/subscription-panel';import './src/styles.css';
rememberBillingReturn(location.search);history.replaceState(null,'',location.pathname);
document.documentElement.classList.toggle('dark',matchMedia('(prefers-color-scheme: dark)').matches);
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><main className="mx-auto max-w-[780px] p-4"><SubscriptionPanel/></main></QueryClientProvider>);`);
 await viteBuild({build:{outDir:dir+'/web',rollupOptions:{input:resolve(html)}},logLevel:'error'});
 const root=resolve(dir+'/web');
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const c of req)chunks.push(c);const input=chunks.length?JSON.parse(Buffer.concat(chunks)):null,path=url.pathname.slice(4),send=(body,code=200)=>res.writeHead(code,{'content-type':'application/json'}).end(JSON.stringify(body));
   state.calls.push(req.method+' '+path);
   if(path==='/billing/subscription')return send(status());
   if(path==='/billing/subscription/refresh')return state.failRefresh?send({error:'Billing is busy.'},502):send(status());
   if(path==='/billing/subscription/checkout'){state.ids.push(input.id);state.pending=input;return send({clientSecret:'cs_test_fixture_secret_fixture',testMode:true});}
   if(path==='/billing/payment-method')return send({card:state.card,testMode:true});
   if(path==='/billing/payment-method/setup')return send({clientSecret:'cs_test_setupfixture_secret_fixture',testMode:true});
   if(path==='/billing/payment-method/complete'){state.card={brand:'mastercard',last4:'4444',expMonth:1,expYear:2031};state.completedSession=input.session;return send({card:state.card});}
   if(path==='/billing/subscription/cancel'){if(state.failCancel)return send({error:'Stripe could not be reached. Try again.'},502);state.cancel=1;return send(status());}
   if(path==='/billing/subscription/resume'){state.cancel=0;return send(status());}
   if(path==='/billing/subscription/retry'){if(state.bank)return send({...status(),actionRequired:{invoiceUrl:'https://invoice.stripe.com/i/fixture'}});state.pastDue=false;return send(status());}
   return send({error:'Unexpected '+path},404);
  }
  const file=url.pathname==='/'?name+'.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,file);if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',woff2:'font/woff2'}[ext]??'application/octet-stream'}).end(bytes);
 }catch{if(!res.headersSent)res.writeHead(500);res.end('fixture failed');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});origin='http://localhost:'+server.address().port;
 assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'local dev host only');
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});

 async function open({width,scheme='light',stripe={}}){
  Object.assign(state,{closed:false,status:null,cancel:0,pastDue:false,hasCustomer:false,paymentStatus:null,failRefresh:false,failCancel:false,bank:false,invoices:[],completedSession:null,ids:[],calls:[],card:{brand:'visa',last4:'4242',expMonth:12,expYear:2030}});
  const context=await browser.newContext({viewport:{width,height:844},colorScheme:scheme,isMobile:width<500,hasTouch:width<500}),page=await context.newPage(),foreign=[];page.setDefaultTimeout(15000);
  page.on('pageerror',e=>{errors.push(e.message);console.error('PAGEERROR',e.message);});page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE',m.text());});
  // Nothing may leave this machine. The only allowed "remote" is the stand-in Stripe.js, which never reaches Stripe.
  await page.route(/^(?!http:\/\/localhost)/,route=>{const u=route.request().url();if(u.startsWith('data:'))return route.continue();if(/^https:\/\/js\.stripe\.com\//.test(u)){foreign.push(u);return route.fulfill({contentType:'text/javascript',body:fakeStripe});}throw Error('Unexpected external request '+u);});
  await page.addInitScript(()=>{window.__pre=true;});
  await page.goto(origin+'/');
  if(!state.closed)await page.getByRole('heading',{name:'Your subscription'}).waitFor();
  return {context,page,foreign,stripe:()=>page.evaluate(()=>window.__stripe)};
 }
 // Keyboard only: reach a control with Tab, never with the pointer.
 async function tabTo(page,locator,max=60){await locator.first().waitFor({timeout:8000}).catch(async()=>{throw Error('Not found: '+locator+'\n'+(await page.locator('body').innerText()).slice(0,600));});for(let i=0;i<max;i++){if(await locator.evaluate(el=>el===document.activeElement,null,{timeout:2000}).catch(()=>false))return;await page.keyboard.press('Tab');}throw Error('Could not reach by keyboard: '+locator);}
 const noOverflow=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
 const smallTargets=page=>page.evaluate(()=>[...document.querySelectorAll('button,a[href],summary,label:has(input[type=radio])')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43.5&&getComputedStyle(el).visibility!=='hidden';}).map(el=>el.textContent.trim().slice(0,30)));

 for(const width of [360,390,1280]){
  const {context,page,foreign,stripe}=await open({width});
  // Lazy: no Stripe script at all until a card is being collected.
  assert.deepEqual(foreign,[],`${width}: no Stripe request before checkout`);
  assert.equal(await page.locator('script[src*="stripe"]').count(),0);
  await page.getByText('Choose a sandbox plan').waitFor();
  assert.equal(await noOverflow(page),true,`${width}: plan picker overflow`);
  // Annual + Personal by keyboard.
  const annual=page.getByRole('button',{name:'Annual',exact:true});await tabTo(page,annual);await page.keyboard.press('Enter');
  const starter=page.getByRole('radio',{name:/Starter/});await tabTo(page,starter);await page.keyboard.press('ArrowDown');assert.equal(await page.getByRole('radio',{name:/Creator/}).isChecked(),true);
  const cont=page.getByRole('button',{name:/Continue to payment/});await tabTo(page,cont);await page.keyboard.press('Enter');
  // Checkout page: order summary + form, the heading takes focus.
  const heading=page.getByRole('heading',{name:'Order summary'});await heading.waitFor();
  await page.locator('[data-fake-payment-element]').waitFor();
  await expect(heading,`${width}: focus moves to the checkout heading`).toBeFocused();
  assert.ok(foreign.length>=1,`${width}: Stripe.js is requested once the card form opens`);
  for(const text of ['Whumpo Creator','$300','Renews every year','Stripe sandbox','Charged today'])assert.ok(await page.getByText(text).first().isVisible(),`${width}: ${text}`);
  const submit=page.getByRole('button',{name:'Subscribe · $300/year'});assert.ok(await submit.isVisible());
  assert.equal(await noOverflow(page),true,`${width}: checkout overflow`);
  assert.deepEqual(await smallTargets(page),[],`${width}: controls under 44px`);
  const summary=await heading.boundingBox(),form=await page.locator('[data-fake-payment-element]').boundingBox();
  if(width>=768)assert.ok(form.x>summary.x+summary.width-1,'1280: summary beside the form'); else assert.ok(form.y>summary.y&&Math.abs(form.x-summary.x)<40,`${width}: summary stacks above the form`);
  // Appearance mapping from Whumpo tokens (light).
  const s1=await stripe(),ap=s1.options.elementsOptions.appearance;
  const token=await page.evaluate(()=>{const c=getComputedStyle(document.documentElement);return {link:c.getPropertyValue('--link').trim(),bg:c.getPropertyValue('--surface-raised').trim(),ink:c.getPropertyValue('--ink').trim()};});
  assert.equal(s1.key,publishable);assert.equal(ap.theme,'stripe');assert.equal(ap.variables.colorPrimary,token.link);assert.equal(ap.variables.colorBackground,token.bg);assert.equal(ap.variables.colorText,token.ink);
  assert.match(s1.options.clientSecret,/^cs_test_/);
  if(shots)await page.screenshot({path:`${shots}/checkout-${width}.png`,fullPage:true});
  // Declined card: the error sits beside the form and takes focus; the button comes back.
  await page.evaluate(()=>{window.__stripe.next='error';});
  await tabTo(page,submit);await page.keyboard.press('Enter');
  const alert=page.getByRole('alert').filter({hasText:'declined'});await alert.waitFor();
  await expect(alert,`${width}: focus moves to the error`).toBeFocused();
  assert.equal(await submit.isEnabled(),true);
  const box=await alert.boundingBox(),formBox=await page.locator('[data-fake-payment-element]').boundingBox();
  assert.ok(box.y>=formBox.y,'error is next to the form');
  assert.equal(await noOverflow(page),true,`${width}: error overflow`);
  // Double submit: a slow confirm and a second Enter (and Space) produce exactly one confirm call; the button shows progress.
  await page.evaluate(()=>{window.__stripe.next='slow';window.__stripe.confirmCalls=0;});
  await tabTo(page,submit);await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.press('Space');
  await page.getByRole('button',{name:'Processing…'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Processing…'}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:/Back to plans/}).isDisabled(),true,'no way back mid-payment');
  // Success: the checkout closes, billing refreshes, the notice is announced.
  state.status=true;state.hasCustomer=true;
  await page.getByRole('status').filter({hasText:'Payment received'}).waitFor();
  assert.equal((await stripe()).confirmCalls,1,`${width}: exactly one confirmation`);
  assert.ok(state.calls.includes('POST /billing/subscription/refresh'));
  await page.getByText('Card on file:').waitFor();
  assert.equal(await noOverflow(page),true,`${width}: after success overflow`);
  await context.close();
 }

 // Back out and retry keeps the same idempotent order id; the secret is not kept anywhere in storage.
 {
  const {context,page}=await open({width:390});
  await page.getByText('Choose a sandbox plan').waitFor();
  const cont=page.getByRole('button',{name:/Continue to payment/});await tabTo(page,cont);await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Order summary'}).waitFor();
  const back=page.getByRole('button',{name:'Back to plans'});await tabTo(page,back);await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Your subscription'}).waitFor();
  await expect(page.getByRole('heading',{name:'Your subscription'}),'focus returns to the billing heading').toBeFocused();
  const resume=page.getByRole('button',{name:/Resume test checkout/});await tabTo(page,resume);await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Order summary'}).waitFor();
  assert.equal(state.ids.length,2);assert.equal(new Set(state.ids).size,1,'the same order id is reused after going back');
  assert.equal(await page.evaluate(()=>JSON.stringify([...Object.entries(localStorage),...Object.entries(sessionStorage)])),'[]','nothing is persisted client-side');
  await context.close();
 }

 // Dark mode: the Appearance API receives the dark tokens and the page is dark.
 {
  const {context,page,stripe}=await open({width:390,scheme:'dark'});
  await page.getByText('Choose a sandbox plan').waitFor();
  const cont=page.getByRole('button',{name:/Continue to payment/});await tabTo(page,cont);await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Order summary'}).waitFor();
  const ap=(await stripe()).options.elementsOptions.appearance,dark=await page.evaluate(()=>{const c=getComputedStyle(document.documentElement);return {bg:c.getPropertyValue('--surface-raised').trim(),link:c.getPropertyValue('--link').trim(),dark:document.documentElement.classList.contains('dark')};});
  assert.equal(dark.dark,true);assert.equal(ap.theme,'night');assert.equal(ap.variables.colorBackground,dark.bg);assert.equal(ap.variables.colorPrimary,dark.link);assert.notEqual(dark.bg,'#ffffff');
  assert.equal(await noOverflow(page),true);
  if(shots)await page.screenshot({path:`${shots}/checkout-390-dark.png`,fullPage:true});
  await context.close();
 }

 // 200% text at phone width: nothing overflows or is cut off.
 {
  const {context,page}=await open({width:390});
  await page.addStyleTag({content:'html{font-size:200% !important}'});
  await page.getByText('Choose a sandbox plan').waitFor();
  assert.equal(await noOverflow(page),true,'200% plan picker');
  const cont=page.getByRole('button',{name:/Continue to payment/});await tabTo(page,cont);await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Order summary'}).waitFor();await page.locator('[data-fake-payment-element]').waitFor();
  assert.equal(await noOverflow(page),true,'200% checkout');
  const submit=page.getByRole('button',{name:/Subscribe/});assert.ok(await submit.isVisible());
  assert.equal(await submit.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'200%: confirm button text is not clipped');
  if(shots)await page.screenshot({path:`${shots}/checkout-390-200pct.png`,fullPage:true});
  await context.close();
 }

 // Checkout gate closed (STRIPE_CHECKOUT_OPEN unset): a plain message, no dead buttons, no Stripe request.
 {
  state.closed=true;state.calls=[];
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),foreign=[];
  await page.route(/^(?!http:\/\/localhost)/,route=>{foreign.push(route.request().url());return route.abort();});
  await page.goto(origin+'/');await page.getByText("Checkout isn't open yet").waitFor();
  assert.equal(await page.getByRole('button').count(),0,'no buttons while checkout is closed');assert.equal(await page.locator('a[href]').count(),0);
  assert.deepEqual(foreign,[]);assert.deepEqual(state.calls.filter(c=>c!=='GET /billing/subscription'),[]);assert.equal(await noOverflow(page),true);
  state.closed=false;await context.close();
 }
 // Closed checkout still shows what the customer already has: the last subscription and its invoices, read only.
 {
  Object.assign(state,{closed:true,status:true,hasCustomer:true,calls:[],invoices:[{id:'in_fixture',plan_id:'personal',amount_cents:3000,interval:'month',starts_at:1790000000,ends_at:1792600000,hosted_url:'https://invoice.stripe.com/i/fixture',created_at:1790000000}]});
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();await page.route(/^(?!http:\/\/localhost)/,route=>route.abort());
  await page.goto(origin+'/');await page.getByText("Checkout isn't open yet").waitFor();await page.getByText('Your last subscription').waitFor();
  assert.equal(await page.getByRole('link',{name:/View invoice/}).getAttribute('href'),'https://invoice.stripe.com/i/fixture');
  assert.equal(await page.getByRole('button').count(),0,'no buttons while closed, even with history');assert.equal(await noOverflow(page),true);
  Object.assign(state,{closed:false,status:null,hasCustomer:false,invoices:[]});await context.close();
 }
 // The payment went through but refreshing Billing failed: say so, never "payment failed", and never show the form again.
 {
  const {context,page,stripe}=await open({width:390});
  await page.getByText('Choose a sandbox plan').waitFor();
  const cont=page.getByRole('button',{name:/Continue to payment/});await tabTo(page,cont);await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Order summary'}).waitFor();state.failRefresh=true;
  const submit=page.getByRole('button',{name:/Subscribe/});await tabTo(page,submit);await page.keyboard.press('Enter');
  await page.getByRole('status').filter({hasText:'Your payment went through'}).waitFor();
  assert.equal(await page.getByRole('alert').filter({hasText:/could not be completed|declined/}).count(),0,'no failure message after a successful charge');
  assert.equal(await page.getByRole('button',{name:/Subscribe/}).count(),0,'the form is not offered again');assert.equal((await stripe()).confirmCalls,1);
  state.failRefresh=false;const back=page.getByRole('button',{name:'Back to billing'});await tabTo(page,back);await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Your subscription'}).waitFor();
  await context.close();
 }
 // Return handling works on Billing: the parameters were cleared from the URL (as the workspace does) before the panel mounted.
 {
  Object.assign(state,{status:true,hasCustomer:true,calls:[],completedSession:null});
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();await page.route(/^(?!http:\/\/localhost)/,route=>route.abort());
  await page.goto(origin+'/?payment_method=returned&session_id=cs_test_abc123');
  await page.getByText('Your new card is saved').waitFor();assert.equal(state.completedSession,'cs_test_abc123');assert.equal(new URL(page.url()).search,'');
  assert.ok(state.calls.includes('POST /billing/subscription/refresh'));
  await context.close();
 }
 // Stripe.js unavailable (blocked or offline): a clear error, a retry and a way back; nothing is charged.
 {
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  await page.route(/^(?!http:\/\/localhost)/,route=>route.abort());
  state.status=null;await page.goto(origin+'/');await page.getByText('Choose a sandbox plan').waitFor();
  const cont=page.getByRole('button',{name:/Continue to payment/});await tabTo(page,cont);await page.keyboard.press('Enter');
  await page.getByText('The secure payment form could not load').waitFor();
  assert.ok(await page.getByRole('button',{name:'Try again'}).isVisible());assert.ok(await page.getByRole('button',{name:'Back'}).isVisible());
  await context.close();
 }

 // Management: card on file, update payment method, cancel (dialog states the end date), resume, past-due recovery.
 {
  const {context,page,stripe}=await open({width:390});
  Object.assign(state,{status:true,hasCustomer:true});await page.reload();
  await page.getByRole('heading',{name:'Your subscription'}).waitFor();
  await page.getByText('Visa ending 4242').waitFor();
  const update=page.getByRole('button',{name:'Update payment method'});await tabTo(page,update);await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Update payment method'}).waitFor();await page.locator('[data-fake-payment-element]').waitFor();
  await page.evaluate(()=>{window.__stripe.next='success';});
  const save=page.getByRole('button',{name:'Save card'});await tabTo(page,save);await page.keyboard.press('Enter');
  await page.getByText('Your new card is saved').waitFor();await page.getByText('Mastercard ending 4444').waitFor();
  assert.ok(state.calls.includes('POST /billing/payment-method/complete'));
  // A draft invoice (a renewal being prepared) is not an alarm.
  state.paymentStatus='draft';await page.getByRole('button',{name:'Refresh billing'}).evaluate(el=>el.focus());await page.keyboard.press('Enter');
  await page.getByText('Current period ends').waitFor();assert.equal(await page.getByText('latest payment did not go through').count(),0);assert.equal(await page.getByRole('button',{name:'Retry payment'}).count(),0);state.paymentStatus=null;
  // Cancel failure shows inside the open dialog, not behind it.
  state.failCancel=true;{const trigger=page.getByRole('button',{name:'Cancel subscription'});await tabTo(page,trigger);await page.keyboard.press('Enter');const d=page.getByRole('dialog');await d.waitFor();
   const go=d.getByRole('button',{name:'Cancel at end of period'});await tabTo(page,go);await page.keyboard.press('Enter');await d.getByRole('alert').filter({hasText:'Stripe could not be reached'}).waitFor();
   await page.keyboard.press('Escape');await d.waitFor({state:'hidden'});}state.failCancel=false;
  // Cancel: confirmation names the date; Escape leaves nothing changed and returns focus.
  const cancel=page.getByRole('button',{name:'Cancel subscription'});await tabTo(page,cancel);await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  const text=await dialog.innerText();assert.match(text,/stays active until/);assert.match(text,/will not renew/);assert.match(text,/(11\/30\/2026|30\/11\/2026|2026)/);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(state.cancel,0);await expect(cancel,'focus returns to the trigger').toBeFocused();
  await page.keyboard.press('Enter');await dialog.waitFor();
  const confirm=dialog.getByRole('button',{name:'Cancel at end of period'});await tabTo(page,confirm);await page.keyboard.press('Enter');
  await page.getByText('Cancellation scheduled').first().waitFor();assert.equal(state.cancel,1);
  const resume=page.getByRole('button',{name:'Resume subscription'});await tabTo(page,resume);await page.keyboard.press('Enter');
  await page.getByRole('status').filter({hasText:'Subscription resumed'}).waitFor();assert.equal(state.cancel,0);
  // Past due: recovery actions are offered together; retry clears it.
  state.pastDue=true;await page.getByRole('button',{name:'Refresh billing'}).evaluate(el=>el.focus());await page.keyboard.press('Enter');
  const due=page.getByRole('alert').filter({hasText:'latest payment did not go through'});await due.waitFor();
  assert.equal(await noOverflow(page),true);
  state.bank=true;const retry=page.getByRole('button',{name:'Retry payment'});await tabTo(page,retry);await page.keyboard.press('Enter');
  const bank=page.getByRole('alert').filter({hasText:'Your bank needs you to confirm'});await bank.waitFor();assert.equal(await bank.getByRole('link',{name:/Open the invoice/}).getAttribute('href'),'https://invoice.stripe.com/i/fixture');
  state.bank=false;await tabTo(page,retry);await page.keyboard.press('Enter');
  await due.waitFor({state:'hidden'});
  assert.deepEqual(await smallTargets(page),[]);
  if(shots)await page.screenshot({path:`${shots}/billing-manage-390.png`,fullPage:true});
  await context.close();
 }
 assert.deepEqual(errors,[]);
 console.log('Custom checkout browser passed at 360, 390 and 1280 px: keyboard-only flow, lazy Stripe.js, summary beside/above the form, token Appearance mapping (light and dark), focus on errors, one confirmation on double submit, 200% text, Stripe.js unavailable, card on file, update card, cancel with end date, resume and past-due recovery. Stripe.js was a stand-in; no card was entered and nothing reached Stripe.');
}finally{
 await browser?.close();server?.closeAllConnections();server?.close();
 await rm(html,{force:true});await rm(entry,{force:true});await rm(dir,{recursive:true,force:true});
}
