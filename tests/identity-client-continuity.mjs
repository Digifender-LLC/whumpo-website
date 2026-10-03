import assert from 'node:assert/strict';
import {build} from 'esbuild';
const originalFetch=globalThis.fetch,originalWindow=globalThis.window,originalChannel=globalThis.BroadcastChannel,originalLocks=Object.getOwnPropertyDescriptor(navigator,'locks');
const channels=[];
class Channel{
 constructor(name){this.name=name;this.closed=false;this.messages=[];channels.push(this);}
 postMessage(value){assert(!this.closed);this.messages.push(structuredClone(value));for(const c of channels)if(c!==this&&!c.closed&&c.name===this.name)c.onmessage?.({data:structuredClone(value)});}
 close(){this.closed=true;}
}
globalThis.window=new EventTarget();globalThis.BroadcastChannel=Channel;
let queue=Promise.resolve();Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(name,...args)=>{assert.equal(name,'whumpo.identity-access');const result=queue.then(args.at(-1));queue=result.catch(()=>{});return result;}}});
try{
 const built=await build({stdin:{contents:"export * from './frontend/src/lib/identity';export * from './frontend/src/lib/identity-invalidation';export {api,resetWorkspaceClient,queryClient} from './frontend/src/lib/api';",resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
 const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 let events=0,calls=0,settle;window.addEventListener('whumpo:identity-changed',()=>{events++;m.resetWorkspaceClient();});
 const stop=m.observeIdentityChanges(),peer=new Channel('whumpo.identity');
 const signal={version:1,type:'identity-changed'};
 for(const bad of [null,[],{...signal,version:0},{...signal,account:'private'},{type:'identity-changed'},{...signal,type:'login'}])peer.postMessage(bad);
 assert.equal(events,0);peer.postMessage(signal);assert.equal(events,1);assert.equal(channels[0].messages.length,0,'Received invalidations do not echo');
 globalThis.fetch=async()=>{calls++;return new Promise(done=>{settle=done;});};
 const pending=m.identityRequest('state');await new Promise(done=>setImmediate(done));peer.postMessage(signal);settle(Response.json({version:1,identity:{accountId:'discarded'}}));await assert.rejects(pending,e=>e.code==='identity_changed');
 const profile=m.api('/profile');peer.postMessage(signal);settle(Response.json({accountId:crypto.randomUUID()}));await assert.rejects(profile,e=>e.status===401);
 const prepared=m.identityRequest('kit/prepare');peer.postMessage(signal);settle(Response.json({version:1,key:'SYNTHETIC_PRIVATE_KEY'}));await assert.rejects(prepared,e=>e.code==='identity_changed');
 globalThis.fetch=async()=>Response.json({version:1,signedOut:true});await m.identityRequest('logout');assert.deepEqual(channels[0].messages.at(-1),signal);
 const sent=channels[0].messages.length;await m.identityRequest('reauth/verify');assert.equal(channels[0].messages.length,sent,'Same-account reauthentication does not discard another tab draft');
 globalThis.fetch=async()=>Response.json({error:'Sign in',code:'proof_required'},{status:401});assert.deepEqual(await m.identityState(),{version:1,identity:null});
 globalThis.fetch=async()=>{throw Error('Synthetic offline');};const before=events;await assert.rejects(m.identityRequest('logout'),e=>e.code==='identity_changed');assert.equal(events,before+1);assert.equal(channels[0].messages.length,sent+1,'Uncertain logout requests a read, never a retry');
 for(const value of channels[0].messages)assert.deepEqual(value,signal);
 assert.equal(calls,3);stop();let lateSignal;peer.onmessage=event=>{lateSignal=event.data;};m.announceIdentityChange();assert.deepEqual(lateSignal,signal,'A reply after route unmount still notifies other tabs');assert(channels.at(-1).closed);peer.close();assert(channels.every(c=>c.closed));
 console.log('Identity client continuity passed: exact content-free signals without echoes, delayed identity/profile/secret fencing, same-account reauthentication, authoritative signed-out state and uncertain logout without redispatch.');
}finally{globalThis.fetch=originalFetch;globalThis.window=originalWindow;globalThis.BroadcastChannel=originalChannel;if(originalLocks)Object.defineProperty(navigator,'locks',originalLocks);else delete navigator.locks;}
