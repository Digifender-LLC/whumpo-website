import assert from 'node:assert/strict';
import {createProtocol,unlockPrfInput,wrappingLabels,b64u,fromB64u,randomBytes,sha256,equalBytes,PasskeyWrapError} from '../tools/prototypes/passkey-key-wrapping.mjs';

// WH-118 synthetic proof. Every PRF value below comes from an EMULATED
// authenticator (random per-credential secret + HMAC, shaped like CTAP
// hmac-secret behind WebAuthn PRF). This is NOT evidence that any browser,
// operating system, passkey provider, security key or hybrid transport
// supports PRF; real-device evidence remains an open WH-118 gap. Signatures and
// authenticator data are random placeholders: real WebAuthn verification is
// covered by the identity suites, not here. Offline; no Worker or network.
const subtle=globalThis.crypto.subtle,encoder=new TextEncoder();
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,x)=>n+x.length,0));let i=0;for(const x of parts){out.set(x,i);i+=x.length;}return out;};
async function hmac(key,data){const k=await subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await subtle.sign('HMAC',k,data));}

// ---- Emulation (labeled) ---------------------------------------------------
function emulatedPasskey({prf=true}={}){
 const credentialId=b64u(randomBytes(16)),secret=randomBytes(32),userHandle=b64u(randomBytes(16));
 const passkey={emulation:true,credentialId,prf,userHandle,
  // WebAuthn L3 prf: salt = SHA-256("WebAuthn PRF" || 0x00 || input); output from the UV hmac-secret PRF.
  async evaluate(input){return hmac(secret,await sha256(concat(encoder.encode('WebAuthn PRF'),new Uint8Array([0]),input)));},
  // Emulates a provider-synced copy of the SAME credential (same id/secret).
  // Whether real providers keep PRF output stable across synced devices is unverified.
  syncedCopy(){return passkey;},
  registration(){return {id:credentialId,rawId:credentialId,type:'public-key',response:{clientDataJSON:b64u(encoder.encode('{"type":"webauthn.create"}')),attestationObject:b64u(randomBytes(64))},clientExtensionResults:{prf:{enabled:prf}}};},
  async assertion(inputs,{style='toJSON'}={}){
   const ext={};
   if(prf){const results={};for(const [k,v] of Object.entries(inputs??{})){const out=await passkey.evaluate(v);results[k]=style==='toJSON'?b64u(out):style==='buffer'?out.buffer:out;}ext.prf=inputs?{results}:{};}
   else ext.prf={};
   return {id:credentialId,rawId:credentialId,type:'public-key',authenticatorAttachment:'platform',
    response:{clientDataJSON:b64u(encoder.encode(JSON.stringify({type:'webauthn.get',challenge:b64u(randomBytes(32)),origin:'https://example.test',crossOrigin:false}))),
     authenticatorData:b64u(randomBytes(37)),signature:b64u(randomBytes(70)),userHandle},clientExtensionResults:ext};
  }};
 return passkey;
}
const signIn=async(passkey,style)=>passkey.assertion({first:await unlockPrfInput()},{style});
async function signInPrf(p,passkey){return p.prfOutputFromCredential(await signIn(passkey));}

// ---- Byte-wise secret search -----------------------------------------------
function containsBytes(hay,needle){
 if(!needle.length||needle.length>hay.length)return false;
 outer:for(let i=0;i<=hay.length-needle.length;i++){for(let j=0;j<needle.length;j++)if(hay[i+j]!==needle[j])continue outer;return true;}
 return false;
}
function encodingsOf(secret){
 const b=Buffer.from(secret);
 return [secret,secret.slice(0,16),encoder.encode(b.toString('hex')),encoder.encode(b.toString('hex').toUpperCase()),encoder.encode(b.toString('base64')),encoder.encode(b.toString('base64url')),
  encoder.encode(Buffer.from(secret.slice(0,24)).toString('base64url')),encoder.encode(Array.from(secret).join(',')),encoder.encode(JSON.stringify(secret))];
}
function findSecrets(bytes,secrets){
 const hits=[];
 for(const [label,secret] of Object.entries(secrets))for(const needle of encodingsOf(secret))if(containsBytes(bytes,needle)){hits.push(label);break;}
 return hits;
}
async function kekBits(entry,secret,label){
 const base=await subtle.importKey('raw',secret,'HKDF',false,['deriveBits']);
 return new Uint8Array(await subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:fromB64u(entry.hkdfSalt,32),info:encoder.encode(label)},base,256));
}
const serialize=v=>encoder.encode(JSON.stringify(v));
async function rejectsCode(promise,code){
 await assert.rejects(Promise.resolve().then(()=>promise),e=>{assert.ok(e instanceof PasskeyWrapError,`expected PasskeyWrapError, got ${e}`);assert.equal(e.code,code);return true;});
}
const flip=(value,index=0)=>{const b=fromB64u(value);b[index]^=1;return b64u(b);};

// A synthetic account: credentials A and B enrolled, content recovery key saved,
// an unrelated WH-115-style account-recovery kit (server stores only its hash).
async function world(p,ctx={}){
 const accountId='acct_synthetic_a',keysetId='ks_synthetic_1',A=emulatedPasskey(),B=emulatedPasskey();
 const prfA=await signInPrf(p,A),prfB=await signInPrf(p,B);
 const created=await p.createKeyset({accountId,keysetId,credentialId:A.credentialId,prfOutput:prfA});
 const record=await p.enrollCredential(created.record,created.contentKey,{credentialId:B.credentialId,prfOutput:prfB});
 const accountKit=ctx.accountKit??randomBytes(32),accountKitVerifier=b64u(await sha256(accountKit));
 const plaintext=encoder.encode('synthetic private draft: canary-7f3a');
 const objects=[await p.encryptContent(record,created.contentKey,'obj_one',plaintext),await p.encryptContent(record,created.contentKey,'obj_two',encoder.encode('second synthetic note'))];
 return {accountId,keysetId,A,B,prfA,prfB,record,contentKey:created.contentKey,recoveryKey:created.recoveryKey,accountKit,accountKitVerifier,plaintext,objects};
}

// ---- Named checks ------------------------------------------------------------
const checks={
 async 'create, unlock and decrypt round trip'(p,ctx){
  const w=await world(p,ctx);
  for(const [passkey,prf] of [[w.A,w.prfA],[w.B,w.prfB]]){
   const ck=await p.unlock(w.record,{credentialId:passkey.credentialId,prfOutput:prf});
   assert.ok(equalBytes(ck,w.contentKey));
   assert.ok(equalBytes(await p.decryptContent(w.record,ck,w.objects[0]),w.plaintext));
  }
 },
 async 'normal sign-in assertion yields the unlock PRF and an ordinary payload'(p,ctx){
  const w=await world(p,ctx);
  for(const style of ['toJSON','buffer','view']){
   const assertion=await signIn(w.A,style);
   const ck=await p.unlock(w.record,{credentialId:assertion.id,prfOutput:p.prfOutputFromCredential(assertion)});
   assert.ok(equalBytes(ck,w.contentKey));
   const payload=p.validateServerAuthenticationPayload(JSON.parse(JSON.stringify(p.serverAuthenticationPayload(assertion))));
   assert.deepEqual(Object.keys(payload).sort(),['authenticatorAttachment','clientExtensionResults','id','rawId','response','type']);
   assert.deepEqual(payload.clientExtensionResults,{});
   assert.equal(payload.response.signature,assertion.response.signature);
  }
 },
 async 'authentication payload excludes PRF, content and wrapping secrets byte-wise'(p,ctx){
  const w=await world(p,ctx),second=randomBytes(32);
  const kekA=await kekBits(w.record.credentials[0],w.prfA,wrappingLabels.credential),kekR=await kekBits(w.record.recovery,w.recoveryKey,wrappingLabels.recovery);
  for(const style of ['toJSON','buffer','view']){
   const assertion=await w.A.assertion({first:await unlockPrfInput(),second},{style});
   const prfFirst=p.prfOutputFromCredential(assertion),prfSecond=await w.A.evaluate(second);
   const secrets={prfFirst,prfSecond,contentKey:w.contentKey,kekA,kekR,recoveryKey:w.recoveryKey,accountKit:w.accountKit};
   // Positive control: the unstripped toJSON form really carries the PRF output.
   if(style==='toJSON')assert.deepEqual(findSecrets(serialize(assertion),secrets).sort(),['prfFirst','prfSecond']);
   if(style==='view')assert.ok(findSecrets(serialize(assertion),secrets).includes('prfFirst'));
   const wire=serialize(p.serverAuthenticationPayload(assertion));   // exact bytes a server would receive
   assert.deepEqual(findSecrets(wire,secrets),[]);
   assert.ok(!new TextDecoder().decode(wire).includes('"prf"'));
   for(const blob of [w.record.credentials[0].wrappedKey,w.record.recovery.wrappedKey])assert.ok(!containsBytes(wire,encoder.encode(blob)));
  }
 },
 async 'server rejects a payload carrying PRF results'(p,ctx){
  const w=await world(p,ctx);
  for(const style of ['toJSON','view']){
   const raw=await signIn(w.A,style);
   assert.throws(()=>p.validateServerAuthenticationPayload(JSON.parse(JSON.stringify(raw))),e=>e.code==='client_secret_in_payload');
  }
  const empty=await w.A.assertion(undefined);
  assert.throws(()=>p.validateServerAuthenticationPayload(JSON.parse(JSON.stringify(empty))),e=>e.code==='client_secret_in_payload');
  assert.throws(()=>p.validateServerAuthenticationPayload({...p.serverAuthenticationPayload(empty),contentKey:'x'}),e=>e.code==='invalid_authentication_payload');
 },
 async 'server-held state contains no content key or unwrap material'(p,ctx){
  const w=await world(p,ctx);
  const secrets={prfA:w.prfA,prfB:w.prfB,contentKey:w.contentKey,recoveryKey:w.recoveryKey,accountKit:w.accountKit,plaintext:w.plaintext,
   kekA:await kekBits(w.record.credentials[0],w.prfA,wrappingLabels.credential),kekB:await kekBits(w.record.credentials[1],w.prfB,wrappingLabels.credential),kekR:await kekBits(w.record.recovery,w.recoveryKey,wrappingLabels.recovery)};
  const server=serialize({record:w.record,objects:w.objects,accountKitVerifier:w.accountKitVerifier});
  assert.deepEqual(findSecrets(server,secrets),[]);
  // Positive control: a planted canary would be found.
  assert.deepEqual(findSecrets(serialize({...w.record,note:b64u(w.contentKey)}),{contentKey:w.contentKey}),['contentKey']);
 },
 async 'server-held values cannot derive the content key'(p,ctx){
  const w=await world(p,ctx),values=new Set();
  const walk=v=>{if(typeof v==='string')values.add(v);else if(v&&typeof v==='object')Object.values(v).forEach(walk);};
  walk({record:w.record,objects:w.objects,accountKitVerifier:w.accountKitVerifier});
  let tried=0;
  for(const value of values){
   const candidates=[await sha256(value)];
   try{const raw=fromB64u(value);if(raw.length===32)candidates.push(raw);candidates.push(await sha256(raw));}catch{}
   for(const c of candidates){
    tried++;
    await rejectsCode(p.decryptContent(w.record,c,w.objects[0]),'content_key_mismatch');
    await rejectsCode(p.unlockWithRecoveryKey(w.record,c),'unwrap_failed');
   }
  }
  assert.ok(tried>=20);
 },
 async 'second credential unlocks the same content'(p,ctx){
  const w=await world(p,ctx),C=emulatedPasskey();
  const enrolled=await p.enrollCredential(w.record,w.contentKey,{credentialId:C.credentialId,prfOutput:await signInPrf(p,C)});
  const ck=await p.unlock(enrolled,{credentialId:C.credentialId,prfOutput:await signInPrf(p,C)});
  assert.ok(equalBytes(ck,w.contentKey));
  assert.ok(equalBytes(await p.decryptContent(enrolled,ck,w.objects[1]),encoder.encode('second synthetic note')));
  // Emulated provider-synced copy of A on another device: same credential, same PRF.
  assert.ok(equalBytes(await p.unlock(enrolled,{credentialId:w.A.credentialId,prfOutput:await signInPrf(p,w.A.syncedCopy())}),w.contentKey));
  await rejectsCode(p.enrollCredential(enrolled,w.contentKey,{credentialId:C.credentialId,prfOutput:await signInPrf(p,C)}),'duplicate_credential');
  await rejectsCode(p.enrollCredential(enrolled,randomBytes(32),{credentialId:'cred_other',prfOutput:randomBytes(32)}),'content_key_mismatch');
 },
 async 'missing or unsupported PRF refuses without fallback'(p,ctx){
  const w=await world(p,ctx),N=emulatedPasskey({prf:false});
  assert.deepEqual(N.registration().clientExtensionResults,{prf:{enabled:false}});
  for(const credential of [await signIn(N),N.registration(),await w.A.assertion(undefined),{clientExtensionResults:{}},{clientExtensionResults:{prf:{results:{first:b64u(randomBytes(16))}}}}])
   assert.throws(()=>p.prfOutputFromCredential(credential),e=>e.code==='prf_unavailable');
  // Ordinary authentication is unaffected: the payload is still valid without PRF.
  p.validateServerAuthenticationPayload(JSON.parse(JSON.stringify(p.serverAuthenticationPayload(await signIn(N)))));
  await rejectsCode(p.unlock(w.record,{credentialId:N.credentialId,prfOutput:randomBytes(32)}),'credential_not_authorized');
 },
 async 'wrong credential, tamper and malformed records fail'(p,ctx){
  const w=await world(p,ctx),a=w.record.credentials[0],other=emulatedPasskey();
  await rejectsCode(p.unlock(w.record,{credentialId:w.A.credentialId,prfOutput:w.prfB}),'unwrap_failed');
  await rejectsCode(p.unlock(w.record,{credentialId:w.A.credentialId,prfOutput:await signInPrf(p,other)}),'unwrap_failed');
  for(const field of ['wrappedKey','iv','hkdfSalt']){
   const tampered={...w.record,credentials:[{...a,[field]:flip(a[field],3)},w.record.credentials[1]]};
   await rejectsCode(p.unlock(tampered,{credentialId:w.A.credentialId,prfOutput:w.prfA}),'unwrap_failed');
  }
  const swapped={...w.record,credentials:[{...w.record.credentials[1],credentialId:w.A.credentialId},{...a,credentialId:w.B.credentialId}]};
  await rejectsCode(p.unlock(swapped,{credentialId:w.A.credentialId,prfOutput:w.prfA}),'unwrap_failed');
  await rejectsCode(p.unlock({...w.record,accountId:'acct_synthetic_b'},{credentialId:w.A.credentialId,prfOutput:w.prfA}),'unwrap_failed');
  await rejectsCode(p.unlock({...w.record,credentials:[{...a,wrappedKey:a.wrappedKey.slice(0,-4)}]},{credentialId:w.A.credentialId,prfOutput:w.prfA}),'invalid_keyset');
  await rejectsCode(p.unlock({...w.record,version:2},{credentialId:w.A.credentialId,prfOutput:w.prfA}),'unsupported_keyset_version');
  await rejectsCode(p.unlock({...w.record,escrow:b64u(randomBytes(32))},{credentialId:w.A.credentialId,prfOutput:w.prfA}),'invalid_keyset');
  await rejectsCode(p.unlock({...w.record,credentials:[a,{...a}]},{credentialId:w.A.credentialId,prfOutput:w.prfA}),'duplicate_credential');
  await rejectsCode(p.decryptContent(w.record,w.contentKey,{...w.objects[0],ciphertext:flip(w.objects[0].ciphertext,5)}),'decrypt_failed');
  await rejectsCode(p.decryptContent(w.record,w.contentKey,{...w.objects[0],generation:2}),'generation_mismatch');
  await rejectsCode(p.decryptContent(w.record,w.contentKey,{...w.objects[0],keysetId:'ks_other'}),'keyset_mismatch');
 },
 async 'content moved between objects fails'(p,ctx){
  const w=await world(p,ctx);
  await rejectsCode(p.decryptContent(w.record,w.contentKey,{...w.objects[0],objectId:'obj_two'}),'decrypt_failed');
 },
 async 'fresh nonces and salts for every wrap and encryption'(p,ctx){
  const w=await world(p,ctx),values=[w.record.recovery.iv,...w.record.credentials.map(e=>e.iv),...w.objects.map(o=>o.iv)];
  assert.equal(new Set(values).size,values.length);
  const salts=[w.record.recovery.hkdfSalt,...w.record.credentials.map(e=>e.hkdfSalt)];
  assert.equal(new Set(salts).size,salts.length);
  const one=await p.encryptContent(w.record,w.contentKey,'obj_same',w.plaintext),two=await p.encryptContent(w.record,w.contentKey,'obj_same',w.plaintext);
  assert.notEqual(one.ciphertext,two.ciphertext);
 },
 async 'revoked credential cannot unlock the current record'(p,ctx){
  const w=await world(p,ctx),revoked=p.revokeCredential(w.record,w.B.credentialId);
  await rejectsCode(p.unlock(revoked,{credentialId:w.B.credentialId,prfOutput:w.prfB}),'credential_not_authorized');
  assert.ok(equalBytes(await p.unlock(revoked,{credentialId:w.A.credentialId,prfOutput:w.prfA}),w.contentKey));
  // Honest limit: revocation without rotation leaves CK unchanged; an older record copy still unwraps for B.
  assert.ok(equalBytes(await p.unlock(w.record,{credentialId:w.B.credentialId,prfOutput:w.prfB}),w.contentKey));
 },
 async 'rotation excludes the revoked holder and the previous content key'(p,ctx){
  const w=await world(p,ctx),revoked=p.revokeCredential(w.record,w.B.credentialId);
  const rotated=await p.rotate(revoked,w.contentKey,{present:[{credentialId:w.A.credentialId,prfOutput:await signInPrf(p,w.A)}],keepCredentialIds:[w.A.credentialId],existingRecoveryKey:w.recoveryKey});
  assert.equal(rotated.record.generation,2);assert.equal(rotated.recoveryKeyReissued,false);
  assert.ok(!equalBytes(rotated.contentKey,w.contentKey));
  await rejectsCode(p.unlock(rotated.record,{credentialId:w.B.credentialId,prfOutput:w.prfB}),'credential_not_authorized');
  await rejectsCode(p.assertContentKey(rotated.record,w.contentKey),'content_key_mismatch');
  const moved=await p.encryptContent(rotated.record,rotated.contentKey,'obj_one',await p.decryptContent(w.record,w.contentKey,w.objects[0]));
  await rejectsCode(p.decryptContent(rotated.record,w.contentKey,moved),'content_key_mismatch');
  assert.ok(equalBytes(await p.decryptContent(rotated.record,await p.unlock(rotated.record,{credentialId:w.A.credentialId,prfOutput:w.prfA}),moved),w.plaintext));
  assert.ok(equalBytes(await p.unlockWithRecoveryKey(rotated.record,w.recoveryKey),rotated.contentKey));
  // Without the existing recovery key, rotation must issue a new one (another save step).
  const reissued=await p.rotate(rotated.record,rotated.contentKey,{present:[{credentialId:w.A.credentialId,prfOutput:w.prfA}],keepCredentialIds:[w.A.credentialId]});
  assert.equal(reissued.recoveryKeyReissued,true);
  await rejectsCode(p.unlockWithRecoveryKey(reissued.record,w.recoveryKey),'unwrap_failed');
  // Honest limit: B kept old ciphertext copies and CK; previously disclosed data stays disclosed.
  assert.ok(equalBytes(await p.decryptContent(w.record,w.contentKey,w.objects[0]),w.plaintext));
 },
 async 'stale generation relabel fails'(p,ctx){
  const w=await world(p,ctx);
  const rotated=await p.rotate(w.record,w.contentKey,{present:[{credentialId:w.A.credentialId,prfOutput:w.prfA},{credentialId:w.B.credentialId,prfOutput:w.prfB}],keepCredentialIds:[w.A.credentialId,w.B.credentialId],existingRecoveryKey:w.recoveryKey});
  const relabeled={...w.record,generation:rotated.record.generation};
  await assert.rejects(p.unlock(relabeled,{credentialId:w.A.credentialId,prfOutput:w.prfA},{minGeneration:2}),PasskeyWrapError);
  await assert.rejects(p.unlockWithRecoveryKey(relabeled,w.recoveryKey,{minGeneration:2}),PasskeyWrapError);
 },
 async 'client high-water mark refuses an older keyset'(p,ctx){
  const w=await world(p,ctx);
  await rejectsCode(p.unlock(w.record,{credentialId:w.A.credentialId,prfOutput:w.prfA},{minGeneration:2}),'stale_keyset');
  await rejectsCode(p.unlockWithRecoveryKey(w.record,w.recoveryKey,{minGeneration:2}),'stale_keyset');
 },
 async 'absent credential becomes pending and needs re-enrollment'(p,ctx){
  const w=await world(p,ctx);
  const rotated=await p.rotate(w.record,w.contentKey,{present:[{credentialId:w.A.credentialId,prfOutput:w.prfA}],keepCredentialIds:[w.A.credentialId,w.B.credentialId],existingRecoveryKey:w.recoveryKey});
  assert.deepEqual(rotated.record.pending,[w.B.credentialId]);
  await rejectsCode(p.unlock(rotated.record,{credentialId:w.B.credentialId,prfOutput:w.prfB}),'rewrap_required');
  const rewrapped=await p.enrollCredential(rotated.record,rotated.contentKey,{credentialId:w.B.credentialId,prfOutput:await signInPrf(p,w.B)});
  assert.deepEqual(rewrapped.pending,[]);
  assert.ok(equalBytes(await p.unlock(rewrapped,{credentialId:w.B.credentialId,prfOutput:w.prfB}),rotated.contentKey));
 },
 async 'lost all credentials: content unrecoverable without the content recovery key'(p,ctx){
  const w=await world(p,ctx),D=emulatedPasskey(),prfD=await signInPrf(p,D);
  // Account recovery (WH-115) enrolls replacement D; it gains account access, not content.
  await rejectsCode(p.unlock(w.record,{credentialId:D.credentialId,prfOutput:prfD}),'credential_not_authorized');
  await rejectsCode(p.unlockWithRecoveryKey(w.record,w.accountKit),'unwrap_failed');
  await rejectsCode(p.unlockWithRecoveryKey({...w.record,recovery:null},w.recoveryKey),'content_unrecoverable');
  await rejectsCode(p.decryptContent(w.record,randomBytes(32),w.objects[0]),'content_key_mismatch');
  // With the separately saved content recovery key: unlock, then enroll D.
  const ck=await p.unlockWithRecoveryKey(w.record,w.recoveryKey);
  const enrolled=await p.enrollCredential(w.record,ck,{credentialId:D.credentialId,prfOutput:prfD});
  assert.ok(equalBytes(await p.decryptContent(enrolled,await p.unlock(enrolled,{credentialId:D.credentialId,prfOutput:prfD}),w.objects[0]),w.plaintext));
 },
 async 'account recovery kit cannot unlock content'(p,ctx){
  const w=await world(p,ctx);
  assert.ok(!equalBytes(w.recoveryKey,w.accountKit));
  await rejectsCode(p.unlockWithRecoveryKey(w.record,w.accountKit),'unwrap_failed');
  await rejectsCode(p.decryptContent(w.record,await sha256(w.accountKit),w.objects[0]),'content_key_mismatch');
 },
 async 'errors carry codes only, never secret material'(p,ctx){
  const w=await world(p,ctx),errors=[];
  const capture=async fn=>{try{await fn();}catch(e){errors.push(e);}};
  await capture(()=>p.unlock(w.record,{credentialId:w.A.credentialId,prfOutput:w.prfB}));
  await capture(()=>p.unlockWithRecoveryKey(w.record,w.accountKit));
  await capture(()=>p.decryptContent(w.record,w.contentKey,{...w.objects[0],objectId:'obj_two'}));
  await capture(()=>p.decryptContent(w.record,w.prfA,w.objects[0]));
  assert.equal(errors.length,4);
  const secrets={prfA:w.prfA,prfB:w.prfB,contentKey:w.contentKey,recoveryKey:w.recoveryKey,accountKit:w.accountKit,plaintext:w.plaintext};
  for(const e of errors){
   assert.ok(e instanceof PasskeyWrapError&&/^[a-z_]+$/.test(e.message));
   assert.deepEqual(findSecrets(encoder.encode(`${e.message}\n${e.stack}\n${JSON.stringify(e)}`),secrets),[]);
  }
 },
 async 'export is client-side; closure without backup expiry is not erasure'(p,ctx){
  const w=await world(p,ctx);
  const serverExport=serialize({record:w.record,objects:w.objects});
  assert.deepEqual(findSecrets(serverExport,{plaintext:w.plaintext,second:encoder.encode('second synthetic note')}),[]);
  const ck=await p.unlock(w.record,{credentialId:w.A.credentialId,prfOutput:w.prfA});
  const exported=await Promise.all(w.objects.map(o=>p.decryptContent(w.record,ck,o)));
  assert.ok(equalBytes(exported[0],w.plaintext));
  // Deleting the live record does not erase a retained backup copy for a credential holder.
  const backup=structuredClone({record:w.record,objects:w.objects});
  assert.ok(equalBytes(await p.decryptContent(backup.record,await p.unlock(backup.record,{credentialId:w.B.credentialId,prfOutput:w.prfB}),backup.objects[0]),w.plaintext));
 },
};

// ---- Mutation set: each mutant must be killed by its named check -----------
const mutants=[
 {name:'payload passes client extension results through',killedBy:'authentication payload excludes PRF, content and wrapping secrets byte-wise',apply:p=>{p.serverAuthenticationPayload=c=>JSON.parse(JSON.stringify(c));}},
 {name:'payload deletes only prf.results.first',killedBy:'authentication payload excludes PRF, content and wrapping secrets byte-wise',apply:p=>{p.serverAuthenticationPayload=c=>{const o={...c,clientExtensionResults:{prf:{results:{...c.clientExtensionResults.prf.results}}}};delete o.clientExtensionResults.prf.results.first;return o;};}},
 {name:'server ignores PRF in received payload',killedBy:'server rejects a payload carrying PRF results',apply:p=>{p.validateServerAuthenticationPayload=x=>x;}},
 {name:'content key reused as public HKDF salt',killedBy:'server-held state contains no content key or unwrap material',apply:p=>{const wrap=p.wrapEntry;p.wrapEntry=async(ck,secret,label,aad)=>{const salt=p.newSalt;p.newSalt=()=>ck;try{return await wrap(ck,secret,label,aad);}finally{p.newSalt=salt;}};}},
 {name:'content key derived from server-visible keyset id',killedBy:'server-held values cannot derive the content key',apply:async p=>{const key=await sha256('ks_synthetic_1');p.newContentKey=()=>key;}},
 {name:'enrollment wraps a fresh key instead of the unlocked one',killedBy:'second credential unlocks the same content',apply:p=>{p.enrollCredential=async(record,_ck,{credentialId,prfOutput})=>({...record,credentials:[...record.credentials,{credentialId,...await p.wrapEntry(randomBytes(32),prfOutput,wrappingLabels.credential,p.wrapAad({...record,credentialId}))}]});}},
 {name:'missing PRF falls back to zero bytes',killedBy:'missing or unsupported PRF refuses without fallback',apply:p=>{const read=p.prfOutputFromCredential;p.prfOutputFromCredential=c=>{try{return read(c);}catch{return new Uint8Array(32);}};}},
 {name:'content AAD omits object id',killedBy:'content moved between objects fails',apply:p=>{const aad=p.contentAad;p.contentAad=c=>aad({...c,objectId:'any'});}},
 {name:'fixed IV',killedBy:'fresh nonces and salts for every wrap and encryption',apply:p=>{p.newIv=()=>new Uint8Array(12);}},
 {name:'revocation keeps the wrap entry',killedBy:'revoked credential cannot unlock the current record',apply:p=>{p.revokeCredential=r=>r;}},
 {name:'rotation reuses the previous content key',killedBy:'rotation excludes the revoked holder and the previous content key',apply:p=>{const rotate=p.rotate,fresh=p.newContentKey;p.rotate=async(r,ck,o)=>{p.newContentKey=()=>ck;try{return await rotate(r,ck,o);}finally{p.newContentKey=fresh;}};}},
 {name:'generation unbound in wrap AAD and commitment',killedBy:'stale generation relabel fails',apply:p=>{const aad=p.wrapAad,raad=p.recoveryAad,commit=p.commitment;p.wrapAad=c=>aad({...c,generation:0});p.recoveryAad=c=>raad({...c,generation:0});p.commitment=(k,c)=>commit(k,{...c,generation:0});}},
 {name:'client high-water mark ignored',killedBy:'client high-water mark refuses an older keyset',apply:p=>{const validate=p.validateRecord;p.validateRecord=r=>validate(r);}},
 {name:'pending credential silently treated as unknown',killedBy:'absent credential becomes pending and needs re-enrollment',apply:p=>{const rotate=p.rotate;p.rotate=async(r,ck,o)=>{const out=await rotate(r,ck,o);return {...out,record:{...out.record,pending:[]}};};}},
 {name:'content recovery key reuses the account recovery kit',killedBy:'account recovery kit cannot unlock content',apply:(p,ctx)=>{p.newRecoveryKey=()=>ctx.accountKit;}},
 {name:'unwrap error includes the secret',killedBy:'errors carry codes only, never secret material',apply:p=>{const unwrap=p.unwrapEntry;p.unwrapEntry=async(e,secret,l,a)=>{try{return await unwrap(e,secret,l,a);}catch{throw new PasskeyWrapError('unwrap_failed '+b64u(secret));}};}},
];

// Checks and mutants use independent protocol instances and synthetic worlds, so
// they run concurrently (WebCrypto work is asynchronous). A kill must be an
// assertion or protocol refusal, not an unrelated crash such as a TypeError.
const started=performance.now();
const checkResults=await Promise.allSettled(Object.values(checks).map(run=>run(createProtocol(),{})));
const failedChecks=Object.keys(checks).filter((_,i)=>checkResults[i].status==='rejected');
if(failedChecks.length)throw new Error(`Checks failed: ${failedChecks.join('; ')}`,{cause:checkResults.find(r=>r.status==='rejected').reason});
const outcomes=await Promise.all(mutants.map(async m=>{
 assert.ok(Object.hasOwn(checks,m.killedBy),`Unknown killing check for ${m.name}`);
 const p=createProtocol(),ctx={accountKit:randomBytes(32)};
 await m.apply(p,ctx);
 try{await checks[m.killedBy](p,ctx);return `survived: ${m.name}`;}
 catch(error){return error instanceof assert.AssertionError||error instanceof PasskeyWrapError?null:`crashed instead of being killed: ${m.name} (${error})`;}
}));
const problems=outcomes.filter(Boolean);
assert.deepEqual(problems,[],'Every mutant must be killed by its named check');
const elapsed=Math.round(performance.now()-started);
console.log(`Passkey key-wrapping contract (WH-118, EMULATED PRF, synthetic data only): ${Object.keys(checks).length} named checks passed; ${mutants.length}/${mutants.length} mutants killed by their named checks; ${elapsed} ms. Not evidence of real browser/device/provider PRF support.`);
