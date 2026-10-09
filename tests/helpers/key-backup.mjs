import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createConnectionRecoveryKey,createConnectionKeyBackup} from '../../tools/connection-key-backup.mjs';

/** Real encrypted files with invented keys. These local sibling directories are
 * not an assertion of independently operated or offsite custody. */
export async function keyBackupFixture(){
 const directory=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-key-backup-');
 try{
  for(const name of ['source','recovery','capsules'])await mkdir(join(directory,name),{mode:0o700});
  const recoveryKeyFile=join(directory,'recovery/wrapping.key');await createConnectionRecoveryKey({recoveryKeyFile});
  return {directory,recoveryKeyFile,
   async create(keyring){
    const backupId=crypto.randomUUID(),keyringFile=join(directory,'source',backupId+'.key'),backupFile=join(directory,'capsules',backupId+'.whumpo-key-backup');
    await writeFile(keyringFile,keyring,{mode:0o600});
    const proof=await createConnectionKeyBackup({keyringFile,recoveryKeyFile,backupFile,backupId});
    return {proof,keyringFile,backupFile,recoveryKeyFile};
   },close:()=>rm(directory,{recursive:true,force:true}),
  };
 }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
