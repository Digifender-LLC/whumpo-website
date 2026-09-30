import {readFile,writeFile} from 'node:fs/promises';
const path='integrations/emdash/migrations/0001_whumpo_initial_taxonomies.sql';
const statements=(await readFile(path,'utf8')).split('\n-- statement\n').map(s=>s.trim());
const output='// Generated from '+path+'. Run node tools/generate-cms-native-schema.mjs.\nexport const initialTaxonomySchema='+JSON.stringify(statements,null,2)+' as const;\n';
if(process.argv.includes('--check')){if(await readFile('src/cms-native-schema.generated.ts','utf8')!==output)throw Error('Native CMS schema module is stale');}
else await writeFile('src/cms-native-schema.generated.ts',output);
