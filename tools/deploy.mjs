import { spawnSync } from 'node:child_process';
// A failed migration must never be followed by new runtime code.
const wrangler = 'node_modules/wrangler/bin/wrangler.js';
for (const args of [
 [wrangler,'d1','migrations','apply','whumpo-control','--remote'],
 ['tools/build.mjs'],
 [wrangler,'deploy','--config','wrangler.runtime.jsonc'],
 [wrangler,'deploy','--config','wrangler.sites.jsonc'],
 [wrangler,'deploy','--config','wrangler.apps.jsonc'],
 ['tools/deploy-platform.mjs']
]) {
 const run=spawnSync(process.execPath,args,{stdio:'inherit'});
 if(run.error || run.status!==0) process.exit(run.status || 1);
}
