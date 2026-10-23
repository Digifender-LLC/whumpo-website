// Managed hosting page: placeholders present, no prices or invented guarantees, one h1, add-on pattern intact.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
// The router Link needs a router context; stub it so the page renders statically.
const stub={name:'router-stub',setup(b){b.onResolve({filter:/^@tanstack\/react-router$/},()=>({path:'stub',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import {createElement} from 'react';export const Link=({to,children,...p})=>createElement('a',{href:to,...p},children);",resolveDir:process.cwd()}));}};
const b=await build({stdin:{contents:"import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {ManagedHosting} from './frontend/src/managed-hosting';export default ()=>renderToStaticMarkup(createElement(ManagedHosting));",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,jsx:'automatic',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(process.cwd()+'/x.js');"},plugins:[stub],alias:{'@':'./frontend/src'}});
const html=(await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'))).default();
assert.equal((html.match(/<h1[ >]/g)||[]).length,1);
assert.ok(html.includes('PLACEHOLDER: base price'));
assert.equal((html.match(/PLACEHOLDER add-on/g)||[]).length,3);
assert.equal((html.match(/Quoted in person/g)||[]).length,3);
assert.ok(html.includes('quoted separately')&&html.includes('Premium and bespoke sites are not covered by the base price'));
assert.doesNotMatch(html,/[$€£]\s?\d|\d\s?(?:USD|EUR|GBP)\b/);
assert.doesNotMatch(html,/uptime|SLA|guarantee|certified|SOC ?2|testimonial/i);
console.log('managed hosting page ok');
