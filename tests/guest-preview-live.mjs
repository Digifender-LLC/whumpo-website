// Explicit opt-in (WH-153): real test deployment, synthetic example.test owner only. Issues one guest link through the
// owner HTTP routes, opens https://preview.whumpo.site/#TOKEN in headless Chromium, posts one comment, revokes the link,
// confirms the revoked link is refused, then deletes every row and verifies the deletion. No DNS write, no payment.
// Inclusion of creator.guest-feedback comes from a project-scoped, one-hour feature_preview_grants row
// (purpose private-test-acceptance, operation dispatch): the exact private-test grant docs/feature-inclusion.md names and
// other fixtures already insert. No billing row is written. The row is removed with the owner (cascade).
import assert from 'node:assert/strict';
import {resolve4,resolve6} from 'node:dns/promises';
import {createRequire} from 'node:module';
import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';
if(process.env.RUN_LIVE_GUEST_PREVIEW!=='1')throw Error('Set RUN_LIVE_GUEST_PREVIEW=1 for the live guest preview acceptance check');
const {requireCurrentProbeSchema,liveWorkspaceBrowser,seedCurrentProbeIdentity}=await import('./helpers/live-workspace.mjs');
const {cloudflareClient,remoteD1}=await import('../tools/cms-cloudflare.mjs');
const {currentSiteFixtureHandlers,createFixtureProject}=await import('./current-site-fixture.mjs');
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));assert.equal(config.vars.ENVIRONMENT,'test');
const guestOrigin='https://preview.whumpo.site',host=new URL(guestOrigin).hostname;
// Published Cloudflare IP ranges (https://www.cloudflare.com/ips/); a proxied record resolves into them.
const v4=['173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18','190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13','131.0.72.0/22'];
const v6=['2400:cb00::/32','2606:4700::/32','2803:f800::/32','2405:b500::/32','2405:8100::/32','2a06:98c0::/29','2c0f:f248::/32'];
const ip4=a=>a.split('.').reduce((n,o)=>n*256+Number(o),0);
const in4=(a,c)=>{const [base,bits]=c.split('/'),size=2**(32-Number(bits));return Math.floor(ip4(a)/size)===Math.floor(ip4(base)/size);};
const ip6=a=>{const [head,tail]=a.split('::'),h=head?head.split(':'):[],t=tail?tail.split(':'):[],g=[...h,...Array(a.includes('::')?8-h.length-t.length:0).fill('0'),...t].map(x=>BigInt('0x'+(x||'0')));return g.reduce((n,x)=>(n<<16n)|x,0n);};
const in6=(a,c)=>{const [base,bits]=c.split('/'),shift=BigInt(128-Number(bits));return ip6(a)>>shift===ip6(base)>>shift;};
assert.ok(in4('104.21.56.76',v4[11])&&!in4('8.8.8.8',v4[11])&&in6('2606:4700:3032::ac43:b449',v6[1])&&!in6('2001:db8::1',v6[1]),'CIDR self-check');
// Read-only: resolve with the system resolver. A missing record is reported, never created.
const addresses=[...await resolve4(host).catch(()=>[]),...await resolve6(host).catch(()=>[])];
assert.ok(addresses.length,'preview.whumpo.site does not resolve; report it to the owner. This check never writes DNS.');
const outside=addresses.filter(a=>!(a.includes(':')?v6.some(c=>in6(a,c)):v4.some(c=>in4(a,c))));
assert.deepEqual(outside,[],'preview.whumpo.site resolves outside Cloudflare ranges');
const db=remoteD1(cloudflareClient(config.account_id),config.d1_databases.find(d=>d.binding==='DB').database_id);
await requireCurrentProbeSchema(db);
const base='https://whumpo.com',id=crypto.randomUUID(),email='guest-fixture-'+id+'@example.test',tag=id.slice(0,8);
const cleanupFile='.secrets/guest-preview-live-account.json',evidenceFile='.secrets/guest-preview-live-evidence.json';
try{await readFile(cleanupFile);throw Error('Resolve the previous guest preview fixture cleanup before a new run');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir('.secrets',{recursive:true});
await writeFile(cleanupFile,JSON.stringify({id,email}),{mode:0o600});
let sessionValue;
const transport=async(url,init)=>{const r=await fetch(url,init);for(const c of r.headers.getSetCookie()){const m=/^__Host-whumpo_session=([^;]*)/.exec(c);if(m)sessionValue=m[1];}return r;};
const browser=liveWorkspaceBrowser(base,transport),{json}=browser;
const steps={dns:addresses.length},ids={};let success=false,originalFailure,chrome,token;
try{
 const [key]=await seedCurrentProbeIdentity(db,id,email);
 await db.prepare("INSERT INTO user_profiles(user_id,name) VALUES(?,'Guest fixture')").bind(id).run();
 await db.prepare("INSERT INTO welcome_onboarding(user_id,stage,prompt,project_id,project_name,idea,completed_at) VALUES(?,'complete','review',?,'Example','Example',strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(id,crypto.randomUUID()).run();
 await db.prepare("INSERT OR IGNORE INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(id).run();
 await browser.login(key,id);assert.ok(sessionValue,'No session cookie captured');
 // The real website-creation builders, admitted by the live session, write the minimum project and saved version rows.
 const m=await currentSiteFixtureHandlers(),scope=m.admitWorkspace(db,await m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:sessionValue}));
 const name='Guest fixture '+tag,site=await createFixtureProject(await scope,id,name,'Synthetic guest preview acceptance');
 const version=(await db.prepare('SELECT version_id FROM project_spec_heads WHERE project_id=?').bind(site.project).first('version_id'));assert.ok(version,'saved version');
 ids.project=site.project;await writeFile(cleanupFile,JSON.stringify({id,email,project:site.project}),{mode:0o600});
 const now=Math.floor(Date.now()/1000);
 await db.prepare("INSERT INTO feature_preview_grants(id,contract_version,user_id,project_id,feature_id,operation,purpose,review_reference,starts_at,ends_at,created_at) VALUES(?,1,?,?,'creator.guest-feedback','dispatch','private-test-acceptance','WH-153 synthetic live acceptance',?,?,?)").bind(crypto.randomUUID(),id,site.project,now-60,now+3600,now).run();
 // Prepare, then confirm the exact readout. Expiry is the 1 hour minimum.
 const request={id:crypto.randomUUID(),versionId:version,expiresInHours:1,feedback:true,label:'WH-153 '+tag};
 const prepared=await json('/api/projects/'+site.project+'/guest-previews/prepare','POST',request);
 assert.equal(prepared.readout.savedVersion.id,version);assert.match(prepared.confirmation,/^[0-9a-f]{64}$/);
 const issued=await json('/api/projects/'+site.project+'/guest-previews','POST',{...request,confirmation:prepared.confirmation});
 token=issued.token;ids.link=issued.link.id;assert.match(issued.url,/^https:\/\/preview\.whumpo\.site\/#[A-Za-z0-9_-]{43}$/);assert.equal(issued.url,guestOrigin+'/#'+token);
 steps.issued=true;
 chrome=await chromium.launch(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{});const context=await chrome.newContext(),page=await context.newPage();page.setDefaultTimeout(30000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(issued.url);await page.frameLocator('#preview').getByRole('heading',{name}).first().waitFor();
 assert.match(await page.locator('#expiry').textContent(),/^Available until /);
 assert.equal(await page.locator('#preview').getAttribute('sandbox'),'');
 // Read the valid-link /view response headers live (same request the shell's form makes): sandbox CSP, framing, no cookie.
 const view=await context.request.post(guestOrigin+'/view',{form:{token},headers:{origin:guestOrigin}}),vh=view.headers();
 assert.equal(view.status(),200);assert.match(await view.text(),new RegExp(name));
 assert.match(vh['content-security-policy'],/^sandbox; default-src 'none'; /);assert.match(vh['content-security-policy'],/frame-ancestors 'self'/);assert.doesNotMatch(vh['content-security-policy'],/script-src|allow-scripts/);
 assert.equal(vh['x-frame-options'],'SAMEORIGIN');assert.equal(vh['cache-control'],'no-store');assert.equal(vh['x-content-type-options'],'nosniff');assert.equal(vh['referrer-policy'],'no-referrer');
 assert.equal(vh['x-robots-tag'],'noindex, nofollow, noarchive, nosnippet');assert.equal(vh['cross-origin-opener-policy'],'same-origin');assert.equal(vh['cross-origin-resource-policy'],'same-origin');assert.equal(vh['set-cookie'],undefined);
 steps.viewHeaders={csp:vh['content-security-policy'],xfo:vh['x-frame-options'],cache:vh['cache-control'],robots:vh['x-robots-tag']};
 steps.viewed=true;
 const said='Live acceptance comment '+tag;
 await page.locator('#guest-name').fill('Guest '+tag);await page.locator('#guest-comment').fill(said);await page.getByRole('button',{name:'Send comment'}).click();
 await page.getByText('Thank you. Your comment was sent to the owner.').waitFor();
 const feedback=(await json('/api/guest-previews/'+ids.link+'/feedback')).feedback;assert.deepEqual(feedback.map(f=>f.text),[said]);
 steps.commented=true;
 await json('/api/guest-previews/'+ids.link+'/revoke','POST');
 const refused=async path=>(await context.request.post(guestOrigin+path,{...(path==='/view'?{form:{token}}:{data:{token}}),headers:{origin:guestOrigin}})).status();
 assert.equal(await refused('/api/link'),404);assert.equal(await refused('/view'),404);
 await page.reload();await page.getByText('This preview link is unavailable.',{exact:false}).waitFor();
 assert.equal(await page.locator('#preview').isHidden(),true);assert.deepEqual(errors.filter(e=>!/404/.test(e)),[]);
 steps.revokedRefused=true;
 await browser.logout();success=true;
}catch(error){originalFailure=error;throw error;}finally{
 await chrome?.close().catch(()=>{});
 try{await db.prepare('DELETE FROM users WHERE id=? AND email=?').bind(id,email).run();}catch{await writeFile(evidenceFile,JSON.stringify({success:false,cleanupVerified:false,originalFailure:originalFailure?.message??null}),{mode:0o600});throw Error('Synthetic fixture cleanup failed; preserve its identity file and inspect the recorded original outcome.');}
 for(const t of ['users WHERE id','identity_accounts WHERE account_id','identity_sessions WHERE account_id','identity_credentials WHERE account_id','projects WHERE owner_user_id','guest_preview_links WHERE owner_user_id','feature_preview_grants WHERE user_id','chat_turns WHERE user_id','workspace_state WHERE user_id'])assert.equal(await db.prepare('SELECT 1 FROM '+t+'=?').bind(id).first(),null,'Cleanup left rows in '+t.split(' ')[0]);
 if(ids.project)for(const t of ['site_versions','project_spec_versions','guest_preview_links'])assert.equal(await db.prepare('SELECT 1 FROM '+t+' WHERE project_id=?').bind(ids.project).first(),null,'Cleanup left rows in '+t);
 if(ids.link)assert.equal(await db.prepare('SELECT 1 FROM guest_preview_feedback WHERE link_id=?').bind(ids.link).first(),null,'Cleanup left guest comments');
 await rm(cleanupFile);
 // The token and comment text are never recorded.
 const evidence={at:new Date().toISOString(),success,steps,dnsCloudflare:addresses,...(originalFailure?{failure:originalFailure.message}:{}),cleanupVerified:true};
 await writeFile(evidenceFile,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(evidence));
}
