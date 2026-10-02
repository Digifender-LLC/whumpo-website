import {publicVariableNames} from './secret-custody.mjs';

const denied=()=>Error('Private material is not allowed in source/build/release artifacts; inspect inputs locally.');
// Path-based exclusion is a guard against misplaced credential/data files, not
// an assertion that arbitrary source strings have been classified for secrecy.
export function assertArtifactPath(path){
 if(typeof path!=='string'||!path||path.includes('\\')||path.includes('\0'))throw denied();
 const parts=path.split('/');
 if(parts.some(p=>!p||p==='.'||p==='..'||/^(?:\.secrets|\.git|node_modules)$/i.test(p)||/^\.(?:env|dev\.vars)(?:\.|$)/i.test(p)||/\.(?:key|pem|p12|pfx|db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/i.test(p)||/^(?:secrets|credentials|auth)(?:\.[^.]+)*\.json$/i.test(p)))throw denied();
}

export function assertArtifactConfiguration(config){
 if(!config||typeof config!=='object'||Array.isArray(config))throw denied();
 if(['env','define','unsafe','secrets','secrets_store_secrets'].some(k=>Object.hasOwn(config,k)))throw denied();
 if(config.vars!==undefined){
  if(!config.vars||typeof config.vars!=='object'||Array.isArray(config.vars))throw denied();
  for(const [name,value] of Object.entries(config.vars))if(!publicVariableNames.includes(name)||!['string','number','boolean'].includes(typeof value))throw denied();
 }
}
