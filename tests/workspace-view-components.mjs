import assert from 'node:assert/strict';
import {build} from 'esbuild';
Error.stackTraceLimit=0;
const {outputFiles}=await build({stdin:{contents:"export {ViewComponentDisplay,ProjectStatusFacts} from './frontend/src/workspace-view-components';export {ProjectStatusDisplay} from './frontend/src/chat-interaction-cards';export {createElement} from 'react';export {renderToStaticMarkup} from 'react-dom/server';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',jsx:'automatic',tsconfig:'tsconfig.frontend.json',banner:{js:"import {createRequire as moduleRequire} from 'node:module';const require=moduleRequire(process.cwd()+'/package.json');"},write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const render=(component,value)=>m.renderToStaticMarkup(m.createElement(component,{value})),projectId=crypto.randomUUID(),asOf=new Date().toISOString();
const facts={projectId,name:'<script>PRIVATE_FACT()</script>',state:'building',websitePublished:false};
const shared={version:1,kind:'projects',binding:'project.status@1',projectId,asOf,status:'ready',data:{items:[facts]}};
const chat={version:1,interactionId:crypto.randomUUID(),definitionDigest:'a'.repeat(64),cardId:'project-status',binding:'project.status@1',source:'project_service_status',asOf,status:'ready',data:facts};
const element=render(m.ProjectStatusFacts,facts),saved=render(m.ViewComponentDisplay,shared),inline=render(m.ProjectStatusDisplay,chat);
assert(saved.includes(element));assert(inline.includes(element));assert(saved.includes('&lt;script&gt;'));assert(!saved.includes('<script>'));assert(saved.includes('Building'));assert(saved.includes('Not published'));assert(saved.includes('Checked'));
for(const patch of [{version:0},{data:{items:[{...facts,href:'javascript:alert(1)'}]}},{approval:true},{kind:'arbitrary'},{binding:'model.metrics@1'}]){const html=render(m.ViewComponentDisplay,{...shared,...patch});assert(html.includes('Update Whumpo'));assert(!html.includes('PRIVATE_FACT'));}
for(const status of ['denied','unavailable']){const html=render(m.ViewComponentDisplay,{...shared,status,data:null});assert(!html.includes('PRIVATE_FACT'));assert(!html.includes('Not published'));assert(!html.includes('Building'));assert(html.includes(status==='denied'?'current access':'temporarily unavailable'));}
const header={version:1,projectId,asOf,status:'ready'};
for(const value of [
 {...header,kind:'storage',binding:'project.storage@1',data:{files:2,bytes:1048576}},
 {...header,kind:'activity',binding:'owner.activity@1',data:{items:[{id:'specification:'+crypto.randomUUID(),projectId,summary:'<img src=x onerror=PRIVATE_FACT()>',createdAt:asOf}]}},
 {...header,kind:'usage',binding:'account.usage@1',data:{standardIncluded:true,advancedEnabled:false}},
 {...header,kind:'performance',binding:'project.performance@1',status:'unavailable',data:null},
]){const html=render(m.ViewComponentDisplay,value);assert(!html.includes('Update Whumpo'));assert(!html.includes('<button'));assert(!html.includes('<a '));assert(!html.includes('<img'));assert(!html.includes('binding'));}
console.log('Shared view components passed: identical trusted project element in Chat/page, escaped facts, current-only validation, honest denial/unavailability, registered metrics/activity and no effect/link authority.');
