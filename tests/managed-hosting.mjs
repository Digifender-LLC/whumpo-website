// Managed hosting page: placeholders present, no prices or invented guarantees, one h1, add-on pattern intact.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
// The router Link needs a router context; stub it so the page renders statically.
const stub={name:'router-stub',setup(b){b.onResolve({filter:/^@tanstack\/react-router$/},()=>({path:'stub',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:"import {createElement} from 'react';export const Link=({to,children,...p})=>createElement('a',{href:to,...p},children);",resolveDir:process.cwd()}));}};
const b=await build({stdin:{contents:"import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {ManagedHosting} from './frontend/src/managed-hosting';export default ()=>renderToStaticMarkup(createElement(ManagedHosting));",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,jsx:'automatic',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(process.cwd()+'/x.js');"},plugins:[stub],alias:{'@':'./frontend/src'}});
const html=(await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'))).default();
assert.equal((html.match(/<h1[ >]/g)||[]).length,1);
assert.ok(html.includes('PLACEHOLDER: base price'));
const addOnSection=html.split('id="add-ons"')[1].split('id="how"')[0];
const items=(addOnSection.match(/<li>/g)||[]).length;
assert.ok(items>50);
assert.equal((html.match(/Quoted in person/g)||[]).length,items);
assert.ok(addOnSection.includes('Add-on availability depends on your site.'));
assert.ok(html.includes('PLACEHOLDER: list of what the base price includes')&&html.includes('PLACEHOLDER: contact details'));
assert.doesNotMatch(html,/PLACEHOLDER add-on|PLACEHOLDER category/);
assert.ok(html.includes('quoted separately')&&html.includes('Premium and bespoke sites are not covered by the base price'));
assert.doesNotMatch(html,/[$€£¥]|\d\s?(?:USD|EUR|GBP|dollars?)\b|\bdollars?\b|\bUS\$|\d+\s?%/i);
assert.doesNotMatch(html,/uptime|\bSLA\b|guarantee|certified|SOC ?2|testimonial|ADA[ -]compliant|lawsuit-proof/i);
assert.doesNotMatch(html,/\b(?:Square|Toast|ChowNow|Wix|Thryv|Hibu|NiceJob|Birdeye|Podium|Mailchimp|Twilio|Google|Yelp|Facebook|Nextdoor|Apple|Bing|Shopify|Stripe|PayPal|Presence|Growth|Pro)\b/);
console.log('managed hosting page ok');
