import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
const base = process.env.WHUMPO_TEST_URL || 'http://localhost:8787';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname), 'Use local test database only');
const sha = value => createHash('sha256').update(value).digest();
const recoveryReplacement = (code,nonce) => sha(`whumpo-owner-recovery-v1|${code}|${nonce}`).toString('hex');
const b64 = value => Buffer.from(value).toString('base64url');
// Minimal CBOR encoder for independently generated ES256 authenticator fixtures.
function cbor(value) {
  const head = (type, n) => n < 24 ? Buffer.from([type * 32 + n]) : n < 256 ? Buffer.from([type * 32 + 24, n]) : Buffer.from([type * 32 + 25, n >> 8, n & 255]);
  if (typeof value === 'number') return head(value < 0 ? 1 : 0, value < 0 ? -1-value : value);
  if (typeof value === 'string') {const bytes=Buffer.from(value);return Buffer.concat([head(3,bytes.length),bytes]);}
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2,value.length),value]);
  if (value instanceof Map) return Buffer.concat([head(5,value.size),...Array.from(value).flatMap(([k,v])=>[cbor(k),cbor(v)])]);
  throw new Error('Unsupported fixture value');
}
function authenticator() {
  const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const jwk=publicKey.export({format:'jwk'}), id=randomBytes(32);
  const cose=cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
  const rpHash=sha(new URL(base).hostname);
  let userHandle;
  return {
    id:b64(id),
    registration(options, origin=base) {
      userHandle=options.user.id;
      const client=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:options.challenge,origin}));
      const auth=Buffer.concat([rpHash,Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),Buffer.from([0,id.length]),id,cose]);
      return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client),attestationObject:b64(cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',auth]]))),transports:['internal']}};
    },
    assertion(options,counter=1,{uv=true,origin=base,handle=userHandle}={}) {
      const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:options.challenge,origin}));
      const count=Buffer.alloc(4);count.writeUInt32BE(counter);
      const auth=Buffer.concat([rpHash,Buffer.from([uv?5:1]),count]);
      return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client),authenticatorData:b64(auth),signature:b64(sign('sha256',Buffer.concat([auth,sha(client)]),privateKey)),userHandle:handle}};
    }
  };
}
let requestNumber=0;
function client() {
  const cookies=new Map();
  return async (path,data) => {
    // Different documentation-only IPs isolate local rate buckets for negative cases.
    const response=await fetch(base+'/api'+path,{method:data===undefined?'GET':'POST',headers:{origin:base,'content-type':'application/json',cookie:Array.from(cookies,([k,v])=>`${k}=${v}`).join('; '),'cf-connecting-ip':`192.0.2.${++requestNumber}`},body:data===undefined?undefined:JSON.stringify(data)});
    for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0];const i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
    return {status:response.status,data:await response.json()};
  };
}
const api=client(), outsider=client(), email=`passkey-${crypto.randomUUID()}@example.com`, key=authenticator();
async function options(kind, data={}, client=api) {const result=await client(`/auth/passkeys/${kind}/options`,data);assert.equal(result.status,200,JSON.stringify(result.data));return result.data.options;}
let opt=await options('signup',{email});
assert.equal(opt.authenticatorSelection.residentKey,'required');
assert.equal(opt.authenticatorSelection.userVerification,'required');
assert.equal((await api('/auth/passkeys/signup/verify',{credential:key.registration(opt,'https://wrong.example')})).status,400);
opt=await options('signup',{email});
const credential=key.registration(opt);
assert.equal((await outsider('/auth/passkeys/signup/verify',{credential})).status,400);
const signup=await api('/auth/passkeys/signup/verify',{credential});
assert.equal(signup.status,200,JSON.stringify(signup.data));
assert.equal(signup.data.recoveryCode.length,64);
assert.equal((await api('/auth/passkeys/signup/verify',{credential})).status,400);
assert.equal((await api('/me')).status,200);
assert.equal((await api('/passkeys')).data.passkeys.length,1);
assert.equal((await api('/auth/passkeys/remove',{id:key.id})).status,409);
assert.equal((await api('/auth/login',{email,password:'some random long password'})).status,401);
await api('/auth/logout',{});
opt=await options('login');
assert.equal((await api('/auth/passkeys/login/verify',{credential:key.assertion(opt,1,{uv:false})})).status,401);
opt=await options('login');
assert.equal((await api('/auth/passkeys/login/verify',{credential:key.assertion(opt,1,{handle:b64('wrong-user')})})).status,401);
opt=await options('login');
const assertion=key.assertion(opt);
const valid=await api('/auth/passkeys/login/verify',{credential:assertion});
assert.equal(valid.status,200,JSON.stringify(valid.data));
assert.equal((await api('/auth/passkeys/login/verify',{credential:assertion})).status,400);
opt=await options('login');
assert.equal((await api('/auth/passkeys/login/verify',{credential:key.assertion(opt,1)})).status,401);
const second=authenticator();
opt=await options('add');
assert.equal((await api('/auth/passkeys/add/verify',{credential:second.registration(opt),name:'Backup key'})).status,200);
assert.equal((await api('/passkeys')).data.passkeys.length,2);
assert.equal((await outsider('/auth/recover/passkeys',{email,code:'0'.repeat(64)})).status,401);
const listed=await outsider('/auth/recover/passkeys',{email,code:signup.data.recoveryCode});
assert.equal(listed.status,200);
assert.deepEqual(listed.data.passkeys.map(passkey=>passkey.id).sort(),[key.id,second.id].sort());
assert.equal((await outsider('/auth/recover',{email,code:signup.data.recoveryCode})).status,400);
const firstNonce=randomBytes(32).toString('hex');
assert.equal((await outsider('/auth/recover',{email,code:signup.data.recoveryCode,nonce:firstNonce,lostPasskeys:{mode:'some',ids:[b64(randomBytes(32))]}})).status,409);
assert.equal((await outsider('/auth/recover/passkeys',{email,code:signup.data.recoveryCode})).status,200);
const recovery=await outsider('/auth/recover',{email,code:signup.data.recoveryCode,nonce:firstNonce,lostPasskeys:{mode:'some',ids:[key.id]}});
assert.equal(recovery.status,200,JSON.stringify(recovery.data));
assert.equal(recovery.data.recoveryCode,recoveryReplacement(signup.data.recoveryCode,firstNonce));
assert.equal((await api('/me')).status,401);
assert.equal((await api('/auth/recover',{email,code:signup.data.recoveryCode})).status,401);
assert.deepEqual((await outsider('/passkeys')).data.passkeys.map(passkey=>passkey.id),[second.id]);
opt=await options('login',{},outsider);
assert.equal((await outsider('/auth/passkeys/login/verify',{credential:key.assertion(opt,2)})).status,401);
opt=await options('login',{},outsider);
assert.equal((await outsider('/auth/passkeys/login/verify',{credential:second.assertion(opt,1)})).status,200);
const noneNonce=randomBytes(32).toString('hex');
const none=await api('/auth/recover',{email,code:recovery.data.recoveryCode,nonce:noneNonce,lostPasskeys:{mode:'none',ids:[]}});
assert.equal(none.status,200,JSON.stringify(none.data));
assert.equal(none.data.recoveryCode,recoveryReplacement(recovery.data.recoveryCode,noneNonce));
assert.equal((await outsider('/me')).status,401);
assert.deepEqual((await api('/passkeys')).data.passkeys.map(passkey=>passkey.id),[second.id]);
const allNonce=randomBytes(32).toString('hex');
const all=await outsider('/auth/recover',{email,code:none.data.recoveryCode,nonce:allNonce,lostPasskeys:{mode:'all',ids:[]}});
assert.equal(all.status,200,JSON.stringify(all.data));
assert.equal(all.data.recoveryCode,recoveryReplacement(none.data.recoveryCode,allNonce));
assert.equal((await api('/me')).status,401);
assert.equal((await outsider('/passkeys')).data.passkeys.length,0);
opt=await options('login',{},api);
assert.equal((await api('/auth/passkeys/login/verify',{credential:second.assertion(opt,2)})).status,401);
const replacementKey=authenticator();
opt=await options('add',{},outsider);
const interruptedRegistration=replacementKey.registration(opt);
const retryNonce=randomBytes(32).toString('hex');
const retry=await api('/auth/recover',{email,code:all.data.recoveryCode,nonce:retryNonce,lostPasskeys:{mode:'none',ids:[]}});
assert.equal(retry.status,200,JSON.stringify(retry.data));
assert.equal((await outsider('/auth/passkeys/add/verify',{credential:interruptedRegistration,name:'Stale key'})).status,401);
assert.equal((await api('/passkeys')).data.passkeys.length,0);
opt=await options('add',{},api);
assert.equal((await api('/auth/passkeys/add/verify',{credential:replacementKey.registration(opt),name:'Replacement key'})).status,200);
assert.deepEqual((await api('/passkeys')).data.passkeys.map(passkey=>passkey.id),[replacementKey.id]);
console.log('Passkey checks passed: cryptographic signup/login, origin and user verification, browser binding, replay/counter rejection, reviewed all/some/none recovery, session revocation, and replacement credential enrollment.');
