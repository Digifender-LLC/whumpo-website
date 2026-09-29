import {fileURLToPath} from 'node:url';
import {defineConfig} from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import emdash from 'emdash/astro';
import {d1,r2} from '@emdash-cms/cloudflare';
export default defineConfig({output:'server',adapter:cloudflare({imageService:"passthrough"}),integrations:[react(),emdash({auth:{type:'townhello',entrypoint:fileURLToPath(new URL('./src/townhello-auth.ts',import.meta.url)),config:{autoProvision:true,syncRoles:false}},database:d1({binding:'DB'}),storage:r2({binding:'MEDIA'})})],vite:{build:{minify:true}},devToolbar:{enabled:false}});
