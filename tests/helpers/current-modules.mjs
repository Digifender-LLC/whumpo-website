import assert from 'node:assert/strict';
import {build} from 'esbuild';
/** One bundle per fixture so domain code and its module-private admission agree. */
export async function currentFixtureModules(paths){
 assert.equal(new Set(paths).size,paths.length);
 for(const path of paths)assert.match(path,/^src\/[a-z0-9/-]+\.ts$/);
 const contents=paths.map((path,index)=>`export * as m${index} from './${path}';`).join('\n')+`
  export {hashToken,newSessionToken} from './src/security';
  export {resolveIdentity} from './src/workspace-identity/authority';
  export {admitWorkspace} from './src/workspace-identity/admission';
 `;
 const result=await build({stdin:{contents,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
 const identity=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const exports=new Map(paths.map((path,index)=>[path,identity['m'+index]]));
 return {identity,module:async path=>{assert.ok(exports.has(path),'Declare the current fixture module');return exports.get(path);}};
}
