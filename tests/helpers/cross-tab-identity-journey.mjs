import assert from 'node:assert/strict';
import {authenticator} from './webauthn-authenticator.mjs';
import {hearOrca} from './orca-output.mjs';
import {keyboardJourney} from './keyboard-journey.mjs';

/** Two actual built-UI tabs share cookies, current Worker/D1 and signed WebAuthn.
 * Only reply delivery and read availability are fault-injected. */
export async function crossTabIdentityJourney({page,context,db,origin,requests,phase,cdp,auth,state}){
 const peer=await context.newPage(),errors=[],releases=[];
 peer.on('pageerror',error=>errors.push(error.message));peer.setDefaultTimeout(15000);
 const composer=p=>p.getByRole('textbox',{name:'Message Whumpo'}),login=p=>p.getByRole('button',{name:'Sign in with a passkey',exact:true});
 const statePath='**/api/auth/identity/v1/state',stateCalls=()=>requests.filter(r=>r.path.endsWith('/identity/v1/state')).length;
 const peerCDP=await context.newCDPSession(peer);await peerCDP.send('WebAuthn.enable');
 const {authenticatorId:peerAuth}=await peerCDP.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 const originalCredentials=(await cdp.send('WebAuthn.getCredentials',{authenticatorId:auth})).credentials;
 for(const credential of originalCredentials)await peerCDP.send('WebAuthn.addCredential',{authenticatorId:peerAuth,credential});
 async function hold(p,path){
  let release,ready;const delivered=new Promise(done=>{ready=done;}),waiting=new Promise(done=>{release=done;});releases.push(release);
  await p.route(path,async route=>{const response=await route.fetch();ready();await waiting;await route.fulfill({response});},{times:1});
  return {ready:()=>Promise.race([delivered,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Reply did not reach hold: '+path)),10000);timer.unref();})]),release};
 }
 async function foreground(p){await p.evaluate(()=>window.dispatchEvent(new Event('focus')));}
 async function signedIn(){await login(page).click();await composer(page).waitFor();await composer(peer).waitFor();}
 async function out(p){await p.goto(origin+'/workspace/security');await p.getByRole('heading',{name:'Account security',exact:true}).waitFor();await p.getByRole('button',{name:'Sign out',exact:true}).click();await login(p).waitFor();}
 async function noPrivate(p){await login(p).waitFor();assert.equal(await composer(p).count(),0);assert.equal(await p.getByRole('button',{name:'Copy',exact:true}).count(),0);assert.equal(await p.evaluate(()=>sessionStorage.length),0);assert.equal(await p.evaluate(()=>window.identityFixtureQueryKeys().length),0);}
 try{
  phase('two tabs retain separate drafts on unchanged foreground checks');
  await peer.goto(origin+'/workspace');await composer(peer).waitFor();
  await composer(page).fill('First tab private garden draft');await composer(peer).fill('Second tab private garden draft');
  for(const p of [page,peer]){await p.waitForLoadState('networkidle');const before=stateCalls(),checked=p.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/identity/v1/state'));await foreground(p);await checked;await p.waitForLoadState('networkidle');assert(stateCalls()>before,'A settled visible tab performs its foreground check');}
  assert.equal(await composer(page).inputValue(),'First tab private garden draft');assert.equal(await composer(peer).inputValue(),'Second tab private garden draft');
  // WH-211 / D-4: unsent text is per tab. A third tab and the other tabs' storage never hold it.
  const third=await page.context().newPage();await third.goto(origin+'/workspace');await composer(third).waitFor();
  assert.equal(await composer(third).inputValue(),'','A new tab starts without any unsent draft');
  for(const [p,other] of [[page,'Second tab private garden draft'],[peer,'First tab private garden draft'],[third,'private garden draft']])assert.equal(await p.evaluate(text=>JSON.stringify([...Object.entries(sessionStorage),...Object.entries(localStorage)]).includes(text),other),false,'A tab never stores another tab’s draft');
  assert.equal(await page.evaluate(()=>JSON.stringify(Object.entries(localStorage)).includes('private garden draft')),false,'Drafts are never written to localStorage');
  await third.close();
  // The only cross-tab message contains this exact signal, never account/state data.
  await peer.evaluate(()=>{window.identitySignals=[];window.identityProbe=new BroadcastChannel('whumpo.identity');window.identityProbe.onmessage=event=>window.identitySignals.push(event.data);});
  const invalidBefore=stateCalls();await page.evaluate(()=>{const c=new BroadcastChannel('whumpo.identity');for(const value of [null,{version:0,type:'identity-changed'},{version:1,type:'identity-changed',accountId:'untrusted'},{version:1,type:'sign-in'}])c.postMessage(value);c.close();});
  await peer.waitForFunction(()=>window.identitySignals.length===4);assert.equal(stateCalls(),invalidBefore);assert.equal(await composer(peer).inputValue(),'Second tab private garden draft');

  phase('foreground identity outage hides private workspace and preserves own draft');
  await peer.route(statePath,route=>route.fulfill({status:503,json:{error:'Synthetic identity read outage',code:'identity_unavailable'}}));
  const keyboard=keyboardJourney(peer,true);
  await foreground(peer);await peer.getByRole('heading',{name:'Let’s check your account access.'}).waitFor();
  assert.equal(await composer(peer).count(),0);assert(!((await peer.locator('body').innerText()).includes('Second tab private garden draft')));
  assert.equal(await peer.evaluate(()=>window.identityFixtureQueryKeys().length),0);
  assert.match(await peer.evaluate(()=>sessionStorage.getItem('whumpo.chat-recovery')),/Second tab private garden draft/);
  for(const width of [360,390,1280]){await peer.setViewportSize({width,height:844});assert(await peer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await peer.screenshot({path:'/tmp/whumpo-identity-outage-'+width+'.png'});}
  await peer.setViewportSize({width:390,height:844});
  await peer.evaluate(()=>document.documentElement.style.fontSize='200%');assert(await peer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await peer.screenshot({path:'/tmp/whumpo-identity-outage-large-text.png',fullPage:true});await peer.evaluate(()=>document.documentElement.style.fontSize='');
  await hearOrca('account outage retry is directly reachable',()=>keyboard.reach(peer.getByRole('button',{name:'Check saved progress',exact:true})),[/Check saved progress/i,/button/i]);
  await peer.unroute(statePath);await keyboard.activate(peer.getByRole('button',{name:'Check saved progress',exact:true}));await composer(peer).waitFor();assert.equal(await composer(peer).inputValue(),'Second tab private garden draft');

  phase('cross-tab logout fences a delayed identity read');
  await page.evaluate(()=>{window.identitySignals=[];window.identityProbe=new BroadcastChannel('whumpo.identity');window.identityProbe.onmessage=event=>window.identitySignals.push(event.data);});
  const heldState=await hold(page,statePath);await foreground(page);await heldState.ready();
  await out(peer);await noPrivate(page);heldState.release();await page.waitForLoadState('networkidle');await noPrivate(page);
  const emitted=await page.evaluate(()=>window.identitySignals);assert(emitted.some(v=>v?.version===1&&v?.type==='identity-changed'&&Object.keys(v).length===2));
  await page.goto(origin+'/workspace');await peer.goto(origin+'/workspace');await signedIn();assert.equal(await composer(page).inputValue(),'');assert.equal(await composer(peer).inputValue(),'');

  phase('cross-tab logout fences a delayed private profile read');
  const heldProfile=await hold(page,'**/api/profile');await page.reload();await heldProfile.ready();await out(peer);await noPrivate(page);heldProfile.release();await page.waitForLoadState('networkidle');await noPrivate(page);
  await page.goto(origin+'/workspace');await peer.goto(origin+'/workspace');await signedIn();

  phase('cross-tab logout fences a prepared secret and releases the old action lock');
  await page.goto(origin+'/workspace/security');await page.getByRole('heading',{name:'Account security',exact:true}).waitFor();
  const heldKit=await hold(page,'**/api/auth/identity/v1/kit/prepare');await page.getByRole('button',{name:'Replace recovery kit',exact:true}).click();await heldKit.ready();
  await out(peer);await noPrivate(page);heldKit.release();await page.waitForLoadState('networkidle');await noPrivate(page);
  await page.goto(origin+'/workspace');await peer.goto(origin+'/workspace');await signedIn();

  phase('cross-tab logout during a passkey prompt cannot verify in the next account');
  await page.goto(origin+'/workspace/security');await page.getByRole('heading',{name:'Account security',exact:true}).waitFor();
  await page.evaluate(()=>{const get=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=async(...args)=>{navigator.credentials.get=get;const result=await get(...args);window.createdPendingPasskey=true;await new Promise(done=>{window.releasePendingPasskey=done;});return result;};});
  const verifications=requests.filter(r=>r.path.endsWith('/reauth/verify')).length;
  await page.getByRole('button',{name:'Prepare a different kit',exact:true}).click();await page.waitForFunction(()=>window.createdPendingPasskey);
  await out(peer);await noPrivate(page);await page.evaluate(()=>window.releasePendingPasskey());await page.waitForLoadState('networkidle');await noPrivate(page);
  assert.equal(requests.filter(r=>r.path.endsWith('/reauth/verify')).length,verifications,'Discarded passkey prompt must not submit verification');
  await page.goto(origin+'/workspace');await peer.goto(origin+'/workspace');await signedIn();

  phase('lost logout reply still clears both tabs without redispatch');
  const logouts=requests.filter(r=>r.path.endsWith('/logout')).length;
  await peer.route('**/api/auth/identity/v1/logout',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.fulfill({response,body:''});},{times:1});
  await out(peer);await noPrivate(page);await noPrivate(peer);
  assert.equal(requests.filter(r=>r.path.endsWith('/logout')).length,logouts+1);
  await page.goto(origin+'/workspace');await peer.goto(origin+'/workspace');await signedIn();

  phase('leaving the identity route cancels delayed passkey verification');
  await page.goto(origin+'/workspace/security');await page.getByRole('heading',{name:'Account security',exact:true}).waitFor();
  await page.evaluate(()=>{const get=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=async(...args)=>{navigator.credentials.get=get;const result=await get(...args);window.departingPromptReady=true;await new Promise(done=>{window.releaseDepartingPrompt=done;});return result;};});
  const beforeDeparture=requests.filter(r=>r.path.endsWith('/reauth/verify')).length;
  await page.getByRole('button',{name:'Prepare a different kit',exact:true}).click();await page.waitForFunction(()=>window.departingPromptReady);
  await page.getByRole('link',{name:'Whumpo home',exact:true}).click();await page.getByRole('link',{name:'Meet Whumpo',exact:true}).waitFor();await page.evaluate(()=>window.releaseDepartingPrompt());await page.waitForLoadState('networkidle');
  assert.equal(requests.filter(r=>r.path.endsWith('/reauth/verify')).length,beforeDeparture,'An unmounted identity route cannot submit its old prompt');
  await page.getByRole('link',{name:'Meet Whumpo',exact:true}).click();await composer(page).waitFor();await composer(peer).waitFor();

  phase('late reauthentication cookie settles before queued cross-tab sign-out');
  await peer.goto(origin+'/workspace/security');await peer.getByRole('heading',{name:'Account security',exact:true}).waitFor();
  await page.goto(origin+'/workspace/security');await page.getByRole('heading',{name:'Account security',exact:true}).waitFor();
  state.holdReauth=true;await page.getByRole('button',{name:'Prepare a different kit',exact:true}).click();
  for(let n=0;!state.releaseReauth&&n<300;n++)await new Promise(done=>setTimeout(done,20));assert(state.releaseReauth,'Committed reauthentication response held before Set-Cookie is sent');
  const beforeLogout=requests.filter(r=>r.path.endsWith('/logout')).length;
  await peer.getByRole('button',{name:'Sign out',exact:true}).click();await peer.getByRole('status').filter({hasText:'One moment'}).waitFor();
  await peer.waitForFunction(async()=>{const locks=await navigator.locks.query();return locks.held.some(l=>l.name==='whumpo.identity-access')&&locks.pending.some(l=>l.name==='whumpo.identity-access');});
  assert.equal(requests.filter(r=>r.path.endsWith('/logout')).length,beforeLogout,'Sign-out waits for the earlier Set-Cookie exchange');
  state.releaseReauth();state.releaseReauth=null;await noPrivate(page);await noPrivate(peer);
  assert.equal(requests.filter(r=>r.path.endsWith('/logout')).length,beforeLogout+1);
  assert.equal((await context.cookies()).filter(c=>c.name==='__Host-whumpo_session').length,0);
  assert.equal((await db.prepare('SELECT count(*) n FROM identity_sessions').first()).n,0,'No late refreshed session survives sign-out');
  await page.reload();await noPrivate(page);
  await page.goto(origin+'/workspace');await peer.goto(origin+'/workspace');await signedIn();

  phase('account change in another tab clears old account drafts and saved location');
  await composer(page).fill('Old account private draft');await composer(peer).fill('Old account peer draft');
  const other=crypto.randomUUID(),key=authenticator('http://localhost:8787');
  await db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(other,'other-browser-owner@example.invalid').run();
  await db.prepare("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)").bind(other,'b'.repeat(64),crypto.randomUUID()).run();
  await db.prepare("INSERT INTO identity_credentials VALUES(?,?,?,0,'Other synthetic owner','active',NULL,unixepoch(),NULL)").bind(key.id,other,key.publicKey).run();
  await peerCDP.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId:peerAuth});
  const {authenticatorId:otherAuth}=await peerCDP.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  await peerCDP.send('WebAuthn.addCredential',{authenticatorId:otherAuth,credential:key.virtualCredential('localhost',other)});
  // Log in through the current client ceremony while the first tab still shows
  // the former owner. This exercises a replaced cookie, not just a logout signal.
  await peer.evaluate(async()=>{await window.identityFixtureLogin();});
  await page.getByLabel('Your name',{exact:true}).waitFor();assert.equal(await composer(page).count(),0);assert.equal(await page.evaluate(()=>sessionStorage.length),0);assert(!((await page.locator('body').innerText()).includes('Old account')));
  await peer.reload();await peer.getByLabel('Your name',{exact:true}).waitFor();assert.equal(await peer.evaluate(()=>sessionStorage.length),0,'Another account’s recovery records are removed before its welcome screen');
  await out(peer);await page.goto(origin+'/workspace');await peer.goto(origin+'/workspace');await signedIn();
  assert.equal(await composer(page).inputValue(),'');assert.equal(await composer(peer).inputValue(),'');

  phase('revocation without a browser signal closes workspace on return');
  await composer(peer).fill('Draft before server revocation');await db.prepare('DELETE FROM identity_sessions').run();
  await peer.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await noPrivate(peer);
  await foreground(page);await noPrivate(page);
  await signedIn();
  assert.equal(requests.filter(r=>r.path==='/api/chat'&&r.method==='POST').length,0,'Cross-tab recovery never invokes the model');
  assert.equal((await db.prepare('SELECT count(*) n FROM inference_calls').first()).n,0);
  assert.equal((await db.prepare('SELECT count(*) n FROM publications').first()).n,0);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('Cross-tab identity passed: isolated drafts, foreground outage/read-only recovery, strict content-free signals, delayed identity/profile/kit refusal, interrupted passkey verification, lost logout reply, serialized late refresh cookie/sign-out, signed account switch, return-time revocation and fresh signed login. No inference, publication or provider requests.');
 }finally{state.releaseReauth?.();state.releaseReauth=null;for(const release of releases)release();await peer.close();}
}
