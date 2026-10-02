// Synthetic provider-vault configuration. This helper never reads secrets.
export function fixtureKeyring(secret='ab'.repeat(32),active='fixture-current',retained=[]){
 return JSON.stringify({version:2,active,keys:[{id:active,secret},...retained]});
}
let currentModule;
async function keyModule(){
 if(!currentModule)currentModule=(async()=>{
  const {build}=await import('esbuild');
  const result=await build({stdin:{contents:"export {initializeConnectionKeys} from './src/connection-rotation';export {seal} from './src/connection-vault';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 })();
 return currentModule;
}
export async function initializeFixtureKeys(db,keyring=fixtureKeyring()){
 return (await keyModule()).initializeConnectionKeys(db,keyring,'synthetic-key-review');
}
export async function fixtureCiphertext(keyring,context,value){return (await keyModule()).seal(keyring,context,value);}
