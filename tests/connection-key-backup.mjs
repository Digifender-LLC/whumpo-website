import assert from 'node:assert/strict';
import {readFile,writeFile,chmod,rename,symlink,link,unlink,mkdir,mkdtemp,rm,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';
import {createConnectionRecoveryKey,createConnectionKeyBackup,verifyConnectionKeyBackup,withRecoveredConnectionKeys} from '../tools/connection-key-backup.mjs';
import {assertArtifactPath} from '../tools/artifact-protection.mjs';
Error.stackTraceLimit=0;
const fixture=await keyBackupFixture(),ring=fixtureKeyring('ab'.repeat(32),'key-a',[{id:'key-b',secret:'cd'.repeat(32)}]);
const hash=b=>createHash('sha256').update(b).digest('hex');
const built=await build({entryPoints:['src/connection-vault.ts'],bundle:true,format:'esm',platform:'node',write:false});
const v=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const forbidden=['ab'.repeat(32),'cd'.repeat(32),'PRIVATE_BACKUP_CANARY'];let refusals=0;
function noSecret(value){for(const text of forbidden)assert.ok(!String(value).includes(text));}
async function refuses(p){await assert.rejects(p,e=>{noSecret(e.message);return true;});refusals++;}
const cli=resolve('tools/connection-key-backup.mjs');
try{
 const capsule=await fixture.create(ring),{proof,backupFile,keyringFile,recoveryKeyFile}=capsule;
 const original=await readFile(backupFile),envelope=JSON.parse(original),recovery=await readFile(recoveryKeyFile,'utf8');forbidden.push(recovery.trim());
 noSecret(original);noSecret(JSON.stringify(proof));assert.equal(proof.readbackVerified,true);assert.equal(proof.independentCustodyAccepted,false);assert.equal(proof.retirementAllowed,false);assert.deepEqual(proof.keyIds,['key-a','key-b']);
 assert.equal((await stat(backupFile)).mode&0o777,0o600);assert.match(recovery,/^[a-f0-9]{64}\n$/);
 const second=await fixture.create(ring);assert.notEqual(JSON.parse(await readFile(second.backupFile)).iv,envelope.iv);
 const options={backupFile,recoveryKeyFile,expectedDigest:proof.sha256};
 const context='whumpo:github:token:synthetic-owner:synthetic-token',cipher=await v.seal(ring,context,'PRIVATE_BACKUP_CANARY');
 const opened=await withRecoveredConnectionKeys(proof,async restored=>({matches:await v.unseal(restored,context,cipher)==='PRIVATE_BACKUP_CANARY'}));assert.deepEqual(opened,{matches:true});
 await unlink(keyringFile);
 // A separate process has only the persisted capsule, separate recovery file and
 // pinned digest. The source plaintext keyring is gone before this verification.
 const out=execFileSync(process.execPath,[cli,'verify','--backup-file',backupFile,'--recovery-key-file',recoveryKeyFile,'--expected-digest',proof.sha256],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 assert.deepEqual(JSON.parse(out),proof);noSecret(out);
 await refuses(verifyConnectionKeyBackup({...options,expectedDigest:'f'.repeat(64)}));
 await refuses(verifyConnectionKeyBackup({...options,expectedDigest:undefined}));
 await refuses(verifyConnectionKeyBackup({...options,keyring:ring}));
 for(const fake of [undefined,{},JSON.parse(JSON.stringify(proof)),{...proof},JSON.stringify(proof)])await refuses(withRecoveredConnectionKeys(fake,()=>({ok:true})));
 await refuses(withRecoveredConnectionKeys(proof,()=>{throw Error('PRIVATE_BACKUP_CANARY');}));
 const mutations=[
  b=>b.header.version=0,b=>b.header.environment='other',b=>b.header.scope='other',b=>b.header.backupId='swapped',b=>b.header.createdAt++,b=>b.header.activeKey='key-b',b=>b.header.keys[0].fingerprint='f'.repeat(64),b=>b.header.keys[0].id='other-key',b=>b.header.keys.reverse(),b=>b.header.keys.push({...b.header.keys[0]}),
  b=>b.header.extra='value',b=>b.header.keyringVersion=1,b=>b.extra='value',b=>b.iv='a'.repeat(16),b=>b.iv+='=',b=>b.ciphertext=b.ciphertext.slice(0,-3),b=>b.ciphertext+='=',b=>b.ciphertext='a'.repeat(3001),
 ];
 for(const mutate of mutations){const changed=structuredClone(envelope);mutate(changed);const body=Buffer.from(JSON.stringify(changed));await writeFile(backupFile,body);await refuses(verifyConnectionKeyBackup({...options,expectedDigest:hash(body)}));}
 await writeFile(backupFile,'{}');await refuses(withRecoveredConnectionKeys(proof,()=>({ok:true})));await writeFile(backupFile,original);
 await chmod(backupFile,0o644);await refuses(verifyConnectionKeyBackup(options));await chmod(backupFile,0o600);
 await chmod(recoveryKeyFile,0o644);await refuses(verifyConnectionKeyBackup(options));await chmod(recoveryKeyFile,0o600);
 await writeFile(recoveryKeyFile,'ef'.repeat(32)+'\n');await refuses(verifyConnectionKeyBackup(options));await writeFile(recoveryKeyFile,recovery);
 await rename(recoveryKeyFile,recoveryKeyFile+'.saved');await refuses(withRecoveredConnectionKeys(proof,()=>({ok:true})));await rename(recoveryKeyFile+'.saved',recoveryKeyFile);
 const alias=join(fixture.directory,'capsules/link.whumpo-key-backup');await symlink(backupFile,alias);await refuses(verifyConnectionKeyBackup({...options,backupFile:alias}));await unlink(alias);
 await link(backupFile,alias);await refuses(verifyConnectionKeyBackup(options));await unlink(alias);
 const dirs=join(fixture.directory,'capsules-link');await symlink(join(fixture.directory,'capsules'),dirs);await refuses(verifyConnectionKeyBackup({...options,backupFile:join(dirs,backupFile.split('/').at(-1))}));await unlink(dirs);
 await refuses(createConnectionRecoveryKey({recoveryKeyFile}));assert.equal(await readFile(recoveryKeyFile,'utf8'),recovery,'Existing recovery material must not be overwritten');
 const source=join(fixture.directory,'source/again.key');await writeFile(source,ring,{mode:0o600});
 const create={keyringFile:source,recoveryKeyFile,backupFile,backupId:'synthetic-backup'};
 await refuses(createConnectionKeyBackup(create));assert.ok((await readFile(backupFile)).equals(original));
 for(const path of [join(fixture.directory,'recovery/same.whumpo-key-backup'),join(fixture.directory,'capsules/wrong.txt'),'relative.whumpo-key-backup'])await refuses(createConnectionKeyBackup({...create,backupFile:path}));
 await mkdir(join(fixture.directory,'recovery/nested'),{mode:0o700});await refuses(createConnectionKeyBackup({...create,backupFile:join(fixture.directory,'recovery/nested/test.whumpo-key-backup')}));
 await writeFile(recoveryKeyFile,'ab'.repeat(32)+'\n');await refuses(createConnectionKeyBackup({...create,backupFile:join(fixture.directory,'capsules/same-material.whumpo-key-backup')}));await writeFile(recoveryKeyFile,recovery);
 for(const value of ['password','f'.repeat(63),'F'.repeat(64),' f'.repeat(32),recovery+'extra',Buffer.from(Buffer.from(recovery.trim()).map(b=>b|128))]){await writeFile(recoveryKeyFile,value);await refuses(verifyConnectionKeyBackup(options));}await writeFile(recoveryKeyFile,recovery);
 for(const value of ['{}',JSON.stringify({...JSON.parse(ring),version:1})]){await writeFile(source,value);await refuses(createConnectionKeyBackup({...create,backupFile:join(fixture.directory,'capsules/invalid.whumpo-key-backup')}));}await writeFile(source,ring);
 const repositoryDir=await mkdtemp(join(process.cwd(),'.key-backup-test-'));
 try{await refuses(createConnectionRecoveryKey({recoveryKeyFile:join(repositoryDir,'test.key')}));await refuses(createConnectionKeyBackup({...create,backupFile:join(repositoryDir,'test.whumpo-key-backup')}));}
 finally{await rm(repositoryDir,{recursive:true,force:true});}
 for(const path of ['src/test.whumpo-key-backup','frontend/public/test.whumpo-key-backup']){assert.throws(()=>assertArtifactPath(path));refusals++;}
 const wrong=spawnSync(process.execPath,[cli,'verify','--backup-file',backupFile,'--recovery-key-file',recoveryKeyFile,'--expected-digest','PRIVATE_BACKUP_CANARY'],{encoding:'utf8'});assert.equal(wrong.status,1);noSecret(wrong.stdout+wrong.stderr);assert.equal(wrong.stdout,'');
 const fresh=await verifyConnectionKeyBackup(options);assert.deepEqual(fresh,proof);noSecret(JSON.stringify(fresh));
 console.log(`Encrypted connection key backup passed: ${refusals} refusals; persisted readback in a fresh process, authenticated metadata, actual retained-key decryption, separate recovery files, drift/loss/permission/link checks and metadata-only diagnostics. No real keys or independent offsite custody claim.`);
}finally{await fixture.close();}
