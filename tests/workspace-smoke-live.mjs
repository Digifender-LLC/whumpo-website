// Explicit opt-in: signed-in workspace pages on the real test deployment, synthetic account only.
// Navigation and reads only. No Chat message, no generation, no checkout, no project or site is created.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {liveWorkspaceBrowser,requireCurrentProbeSchema,seedCurrentProbeIdentity} from './helpers/live-workspace.mjs';
import {cloudflareClient,remoteD1} from '../tools/cms-cloudflare.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
if(process.env.RUN_LIVE_WORKSPACE_SMOKE!=='1')throw Error('Set RUN_LIVE_WORKSPACE_SMOKE=1 for the signed-in live workspace smoke check');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));assert.equal(config.vars.ENVIRONMENT,'test');
const db=remoteD1(cloudflareClient(config.account_id),config.d1_databases.find(d=>d.binding==='DB').database_id);
await requireCurrentProbeSchema(db);
const base='https://whumpo.com',id=crypto.randomUUID(),email='smoke-fixture-'+id+'@example.test';
const pages=[['Chat','/workspace'],['Dashboard','/workspace/dashboard'],['Settings','/workspace/settings'],['Profile','/workspace/profile'],['Support','/workspace/support'],['Saved work','/workspace/saved-work'],['Site safety','/workspace/safety'],['Account security','/workspace/security'],['Billing','/workspace/billing']];
const cleanupFile='.secrets/workspace-smoke-live-account.json',evidenceFile='.secrets/workspace-smoke-live-evidence.json';
try{await readFile(cleanupFile);throw Error('Resolve the previous smoke fixture cleanup before a new run');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir('.secrets',{recursive:true});
await writeFile(cleanupFile,JSON.stringify({id,email}),{mode:0o600});
// Capture the session cookie the helper receives so the browser reuses the same signed-in session.
let sessionValue;
const transport=async(url,init)=>{const r=await fetch(url,init);for(const c of r.headers.getSetCookie()){const m=/^__Host-whumpo_session=([^;]*)/.exec(c);if(m)sessionValue=m[1];}return r;};
const browser=liveWorkspaceBrowser(base,transport);
const results=[],failures=[];let success=false,originalFailure,chrome;
// D-9: standalone controls are at least 44x44 at phone width (390) and at least 24x24 at desktop width (1280, fine pointer), per WCAG 2.2 SC 2.5.5 and 2.5.8 (AA). Links that flow inside a sentence (computed display inline) are exempt.
const smallControls=min=>[...document.querySelectorAll('button,a[href],select,textarea,summary,[role=button],input:not([type=hidden],[type=checkbox],[type=radio])')].filter(e=>e.checkVisibility()&&!e.closest('.sr-only')&&!(e.tagName==='A'&&getComputedStyle(e).display==='inline')).map(e=>{const r=e.getBoundingClientRect();return {t:e.tagName.toLowerCase(),n:(e.getAttribute('aria-label')||e.innerText||e.id||'').trim().slice(0,40),w:Math.round(r.width),h:Math.round(r.height)};}).filter(c=>c.w>0&&c.h>0&&(c.w<min||c.h<min));
try{
 const [key]=await seedCurrentProbeIdentity(db,id,email);
 // Completed onboarding without creating a project: the workspace gate only needs a completed welcome row.
 await db.prepare("INSERT INTO user_profiles(user_id,name) VALUES(?,'Smoke')").bind(id).run();
 await db.prepare("INSERT INTO welcome_onboarding(user_id,stage,prompt,project_id,project_name,idea,completed_at) VALUES(?,'complete','review',?,'Example','Example',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(id,crypto.randomUUID()).run();
 await browser.login(key,id);assert.ok(sessionValue,'No session cookie captured');
 chrome=await chromium.launch();
 for(const width of [390,1280])for(const scheme of ['light','dark']){
  const context=await chrome.newContext({viewport:{width,height:900},colorScheme:scheme});
  await context.addCookies([{name:'__Host-whumpo_session',value:sessionValue,url:base,httpOnly:true,secure:true,sameSite:'Lax'}]);
  for(const [name,path] of pages){
   const page=await context.newPage(),errors=[],bad=[],fails=[];
   // Block any write so nothing can mutate; the allowed POSTs are read-only (session state, saved-view component read).
   await page.route('**/*',route=>{const r=route.request();if(['GET','HEAD'].includes(r.method())||['/api/auth/identity/v1/state','/api/workspace/views/v1/component'].some(p=>r.url().endsWith(p)))return route.continue();bad.push(r.method()+' '+new URL(r.url()).pathname);return route.abort();});
   page.on('console',m=>{if(m.type()==='error'&&new URL(m.location().url||base).origin===base)errors.push(m.text()+' @'+m.location().url);});
   page.on('pageerror',e=>errors.push('pageerror: '+e.message));
   try{
    await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForLoadState('networkidle',{timeout:30000}).catch(()=>{});
    await page.locator('h1:visible,h2:visible,h3:visible').first().waitFor({timeout:20000}).catch(()=>fails.push('no visible heading'));
    const m=await page.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,dark:document.documentElement.classList.contains('dark'),text:document.body.innerText,url:location.pathname}));
    if(m.url!==path)fails.push('redirected to '+m.url);
    if(m.sw>m.cw)fails.push('horizontal scroll '+m.sw+'>'+m.cw);
    if(m.dark!==(scheme==='dark'))fails.push('dark class is '+m.dark+' in '+scheme);
    if(errors.length)fails.push('console errors: '+errors.join(' | '));
    if(bad.length)fails.push('blocked writes: '+bad.join(', '));
    if(name==='Support'){if(!m.text.includes('We reply on business days.'))fails.push('missing "We reply on business days."');if(m.text.includes('No response time is promised'))fails.push('contains "No response time is promised"');}
    if(name==='Billing'&&!/sandbox|test mode|test-mode|checkout isn.t open yet/i.test(m.text))fails.push('no sandbox, test-mode or closed-checkout label');
    const small=await page.evaluate(smallControls,width===390?44:24);
    if(small.length)fails.push('controls under '+(width===390?44:24)+'px: '+small.map(c=>c.t+' "'+c.n+'" '+c.w+'x'+c.h).join('; '));
   }catch(e){fails.push('error: '+e.message);}
   results.push({page:name,width,scheme,ok:!fails.length});for(const f of fails)failures.push(name+' '+width+' '+scheme+': '+f);
   await page.close();
  }
  await context.close();
 }
 // Theme switch (PR #364/#402 regression): Night must apply, survive reload and a direct load, Day must undo it, Device restores the default. Changes only this synthetic profile.
 {
  const context=await chrome.newContext({viewport:{width:1280,height:900},colorScheme:'light'});
  await context.addCookies([{name:'__Host-whumpo_session',value:sessionValue,url:base,httpOnly:true,secure:true,sameSite:'Lax'}]);
  const page=await context.newPage();page.setDefaultTimeout(30000);
  const applied=dark=>page.waitForFunction(d=>document.documentElement.classList.contains('dark')===d&&document.querySelector('meta[name="theme-color"]')?.content===(d?'#0b172a':'#F8FAFC'),dark,{timeout:30000});
  const choose=async name=>{const b=page.getByRole('button',{name,exact:true});await b.click();await page.locator('button[aria-pressed=true]').filter({hasText:name}).waitFor();};
  const open=async path=>{await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:60000});await page.locator('h1:visible,h2:visible,h3:visible').first().waitFor();};
  try{
   await open('/workspace/settings');await applied(false);
   await choose('Night');await applied(true);
   await open('/workspace');await applied(true);
   await open('/workspace/support');await applied(true);
   await open('/workspace/settings');await choose('Day');await applied(false);
   await choose('Device');await applied(false);
   results.push({page:'Theme switch',ok:true});
  }catch(e){failures.push('Theme switch: '+e.message);results.push({page:'Theme switch',ok:false});}
  // Device is the default, so nothing may stay in this device's storage.
  const store=await page.evaluate(()=>({theme:localStorage.getItem('whumpo.theme'),local:Object.keys(localStorage),session:Object.keys(sessionStorage)}));
  if(store.theme!==null||store.local.length||store.session.length)failures.push('Device storage not empty after restoring Device: '+JSON.stringify(store));
  await context.close();
 }
 await browser.logout();success=true;
}catch(error){originalFailure=error;throw error;}finally{
 await chrome?.close().catch(()=>{});
 try{await db.prepare('DELETE FROM users WHERE id=? AND email=?').bind(id,email).run();}catch{await writeFile(evidenceFile,JSON.stringify({success:false,cleanupVerified:false,originalFailure:originalFailure?.message??null}),{mode:0o600});throw Error('Synthetic fixture cleanup failed; preserve its identity file and inspect the recorded original outcome.');}
 for(const t of ['users WHERE id','identity_accounts WHERE account_id','identity_sessions WHERE account_id','identity_credentials WHERE account_id','projects WHERE owner_user_id'])assert.equal(await db.prepare('SELECT 1 FROM '+t+'=?').bind(id).first(),null,'Cleanup left rows in '+t.split(' ')[0]);
 await rm(cleanupFile);
 const evidence={at:new Date().toISOString(),success:success&&!failures.length,results,failures,...(originalFailure?{failure:originalFailure.message}:{}),cleanupVerified:true};
 await writeFile(evidenceFile,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(evidence));
}
if(failures.length)throw Error(failures.length+' smoke assertion(s) failed:\n'+failures.join('\n'));
