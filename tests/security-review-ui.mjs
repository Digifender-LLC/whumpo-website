Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({tsconfig:'tsconfig.frontend.json',stdin:{resolveDir:process.cwd(),contents:"export {SecurityReviewView,reviewError} from './frontend/src/security-review';export {APIError} from './frontend/src/lib/api';export {renderToStaticMarkup} from 'react-dom/server';export {createElement} from 'react';"},banner:{js:"import {createRequire as moduleRequire} from 'node:module';const require=moduleRequire(process.cwd()+'/package.json');"},bundle:true,format:'esm',platform:'node',write:false,jsx:'automatic'});
const {SecurityReviewView,reviewError,APIError,renderToStaticMarkup,createElement}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const snap={reviewId:'r1',expiresAt:4102444800000,credentials:['abcdefABCDEF1','zzzzzzGHIJKL2'],sessions:[{sessionId:'s1',credentialId:'abcdefABCDEF1',issuedAt:1}],kitGeneration:1,pendingEmailChange:{changeId:'c',expiresAt:4102444800000},connections:[{connectionId:'g1',provider:'github',access:'active',revocation:'none'}]};
const kit={offer:{offerId:'o1',generation:2,expiresAt:4102444800000},key:'SECRET-KEY-VALUE',filename:'whumpo-recovery-kit.txt',text:'kit text'};
const base={step:'start',busy:false,status:'',error:'',snap:null,dropKeys:[],dropConns:[],kit:null,kitSaved:false,kitSkipped:false,ack:false,receipt:null,resume:false};
const noop=new Proxy({},{get:()=>()=>{}});
const render=v=>renderToStaticMarkup(createElement(SecurityReviewView,{v:{...base,...v},on:noop})).replaceAll('<!-- -->','');
const has=(html,list)=>{for(const t of list)assert.ok(html.includes(t),'missing '+t)},lacks=(html,list)=>{for(const t of list)assert.ok(!html.includes(t),'unexpected '+t)};
const commitDisabled=html=>/<button[^>]*disabled=""[^>]*>Secure my account now/.test(html);
let h=render({});has(h,['>Secure my account<','role="status"','aria-live="polite"']);lacks(h,['Check result']);
has(render({resume:true}),['Check result','may not have finished']);
// Select: passkeys kept by default, connections chosen for removal, labelled controls.
h=render({step:'select',snap,dropConns:['g1']});
has(h,['<legend','Passkeys','Remove Passkey 1 (ends BCDEF1)','Remove GitHub connection','tabindex="-1"','will be cancelled']);
assert.equal((h.match(/checked=""/g)??[]).length,1);lacks(h,['every passkey']);
has(render({step:'select',snap,dropKeys:snap.credentials}),['You chose to remove every passkey','role="alert"']);
// Kit: not shown until created; Continue stays disabled until saved or skipped.
h=render({step:'kit',snap});has(h,['Create new recovery kit','Keep my current kit']);lacks(h,['SECRET-KEY-VALUE']);
h=render({step:'kit',snap,kit});has(h,['SECRET-KEY-VALUE','I have saved my new recovery kit','disabled=""']);
h=render({step:'kit',snap,kit,kitSaved:true});lacks(h,['I have saved my new recovery kit','disabled=""']);has(h,['Saved. Continue']);
// Confirm: commit disabled until acknowledged and the kit decision is made.
assert.ok(commitDisabled(render({step:'confirm',snap,kitSaved:true,kit})));
assert.ok(commitDisabled(render({step:'confirm',snap,ack:true})));
assert.ok(!commitDisabled(render({step:'confirm',snap,ack:true,kitSkipped:true})));
assert.ok(!commitDisabled(render({step:'confirm',snap,ack:true,kitSaved:true,kit})));
has(render({step:'confirm',snap,kitSaved:true,kit,ack:true,dropKeys:snap.credentials}),['No passkey will remain','signed out on every device','replaced by the one you just saved']);
// Receipt.
h=render({step:'done',receipt:{reviewId:'r1',epoch:3,stage:'recovering',revokedCredentials:['a'],kitRotated:true,pendingEmailChange:'cancelled',connections:[{connectionId:'g1',access:'disabled',revocation:'queued'}],sessionsRevoked:'all'}});
has(h,['signed out everywhere','Passkeys removed: 1','old kit no longer works','email change was cancelled','removal at the provider is queued','No passkey remains','Continue to sign-in','not recover encrypted content']);
// Every adapter code has plain-language text, the right place to continue, and the right retry rule.
const code=c=>reviewError(new APIError('server text',409,c));
const rows={review_limit:['start',false],review_too_large:['start',false],stale_review:['start',false],unknown_review:['start',false],unknown_offer:['start',false],invalid_selection:['select',false],kit_not_saved:['kit',false],kit_offer_exists:[null,false],proof_required:[null,true],rate_limited:[null,true],delivery_unavailable:[null,false],request_conflict:['start',false]};
for(const [c,[goto,keep]] of Object.entries(rows)){const r=code(c);assert.equal(r.goto,goto,c);assert.equal(r.keepAttempt,keep,c);assert.ok(r.text.length>20&&r.text!=='server text',c);}
assert.ok(reviewError(new TypeError('network')).keepAttempt,'a lost reply keeps its request ID');
assert.ok(reviewError(new APIError('x',503,'unavailable')).text.includes('same request is safe to repeat'));
console.log('Security review UI passed: start, select defaults, kit gate, confirm gate, receipt and every error code.');
