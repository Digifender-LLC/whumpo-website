import './generate-cms-native-schema.mjs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../integrations/emdash/',import.meta.url);
const build=spawnSync(process.execPath,[fileURLToPath(new URL('node_modules/astro/bin/astro.mjs',root)),'build'],{cwd:fileURLToPath(root),stdio:'inherit'});
if(build.error||build.status!==0)process.exit(build.status||1);
const check=spawnSync(process.execPath,[fileURLToPath(new URL('./check-emdash-profile.mjs',import.meta.url))],{stdio:'inherit'});
process.exit(check.status??1);
