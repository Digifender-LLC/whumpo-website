import {hashToken} from './security';
// A fresh 256-bit client nonce makes the replacement unpredictable even to
// someone holding an old code. The controlled UI saves the replacement before
// requesting recovery, so a lost response cannot strand the visitor.
export async function replacementAppRecoveryCode(code:string,nonce:string){
 if(!/^[0-9a-f]{64}$/.test(code)||!/^[0-9a-f]{64}$/.test(nonce))throw new Error('Invalid recovery request');
 return hashToken('whumpo-app-recovery-replacement:'+code+':'+nonce);
}
