import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest(),b64=value=>Buffer.from(value).toString('base64url');
function cbor(value){
 const head=(type,n)=>n<24?Buffer.from([type*32+n]):n<256?Buffer.from([type*32+24,n]):Buffer.from([type*32+25,n>>8,n&255]);
 if(typeof value==='number')return head(value<0?1:0,value<0?-1-value:value);
 if(typeof value==='string'){const bytes=Buffer.from(value);return Buffer.concat([head(3,bytes.length),bytes]);}
 if(Buffer.isBuffer(value))return Buffer.concat([head(2,value.length),value]);
 if(value instanceof Map)return Buffer.concat([head(5,value.size),...Array.from(value).flatMap(([k,v])=>[cbor(k),cbor(v)])]);
 throw Error('Unsupported CBOR fixture');
}
/** Independent ES256 signatures, not a mocked WebAuthn verifier or physical-device claim. */
export function authenticator(origin='https://whumpo.com'){
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32);
 const cose=cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
 let userHandle;
 return {id:b64(id),
  registration(options,{atOrigin=origin,uv=true,rpID=options.rp.id,crossOrigin=false}={}){
   userHandle=options.user.id;
   const client=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:options.challenge,origin:atOrigin,crossOrigin}));
   const auth=Buffer.concat([sha(rpID),Buffer.from([uv?0x45:0x41]),Buffer.alloc(4),Buffer.alloc(16),Buffer.from([0,id.length]),id,cose]);
   return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client),attestationObject:b64(cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',auth]]))),transports:['internal']}};
  },
  assertion(options,counter=1,{atOrigin=origin,uv=true,rpID=options.rpId,handle=userHandle,badSignature=false,crossOrigin=false}={}){
   const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:options.challenge,origin:atOrigin,crossOrigin})),count=Buffer.alloc(4);count.writeUInt32BE(counter);
   const auth=Buffer.concat([sha(rpID),Buffer.from([uv?5:1]),count]),signature=sign('sha256',Buffer.concat([auth,sha(client)]),privateKey);
   if(badSignature)signature[signature.length-1]^=1;
   return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client),authenticatorData:b64(auth),signature:b64(signature),userHandle:handle}};
  }
 };
}
