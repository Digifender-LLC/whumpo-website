export const recoveryKitFilename='whumpo-recovery-kit.txt';

/** Plaintext exists only in the successful preparation response and the user's saved copy. */
export function recoveryKitText(input:{key:string;accountLabel:string;generation:number;offerId:string;createdAt:number}){
 if(!/^[a-f0-9]{64}$/.test(input.key)||/[\r\n]/.test(input.accountLabel))throw Error('Invalid recovery document input');
 return [
  'WHUMPO — ACCOUNT RECOVERY KIT','',
  `Account: ${input.accountLabel}`,`Generation: ${input.generation}`,`Kit ID: ${input.offerId}`,
  `Generated: ${new Date(input.createdAt*1000).toISOString()}`,'',
  'Recovery key:',input.key,'',
  'Keep this private. Store it somewhere separate from your passkeys and device.',
  'This kit becomes active only after Whumpo confirms setup or replacement. Keep your current kit until then.','',
  'To recover your account:',
  '1. Type https://whumpo.com/workspace/ into your browser.',
  '2. Choose account recovery and enter the account email and this recovery key.',
  '3. Review lost passkeys, save the replacement kit, and set up the required replacement passkeys.',
  '4. Verify a replacement passkey to finish. The recovery key alone does not open your workspace.','',
  'This kit recovers account access. It does not reconstruct separately encrypted content keys.',
  'Do not send this key to Chat, support, or another person. Do not place it in a link or QR code.',''
 ].join('\n');
}
