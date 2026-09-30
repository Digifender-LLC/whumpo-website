Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({tsconfig:'tsconfig.frontend.json',stdin:{resolveDir:process.cwd(),contents:"export {FirstDraftCard} from './frontend/src/first-draft-card';export {ChatReply} from './frontend/src/chat-reply';export {TurnActions} from './frontend/src/chat-turn-actions';export {renderToStaticMarkup} from 'react-dom/server';export {createElement} from 'react';"},banner:{js:"import {createRequire as moduleRequire} from 'node:module';const require=moduleRequire(process.cwd()+'/package.json');"},bundle:true,format:'esm',platform:'node',write:false,jsx:'automatic'});
const {FirstDraftCard,ChatReply,TurnActions,renderToStaticMarkup,createElement}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const path='/workspace/cms?project=11111111-1111-4111-8111-111111111111',render=text=>renderToStaticMarkup(createElement(ChatReply,{text}));
const html=render('First upload\n'+path+'\nSecond upload\n'+path+'\nDone');
assert.equal((html.match(/<a /g)||[]).length,2);assert.ok(html.includes('href="'+path+'"'));assert.ok(html.includes('Open publishing desk'));assert.ok(html.includes('min-h-11'));assert.ok(html.includes('Second upload'));
for(const text of [path+'&confirm=true',path+'/extra','https://evil.test'+path,'/api/delete',path.replace('11111111','bad'),'<img src=x onerror=alert(1)>','javascript:alert(1)','[Confirm]('+path+')'])assert.ok(!render(text).includes('<a '));
assert.ok(render('<script>alert(1)</script>').includes('&lt;script&gt;'));
assert.equal(render('Ordinary response'), 'Ordinary response');
console.log('Chat reply passed: fixed internal project links, multiple links, touch target, plain text preservation and escaping; arbitrary URLs, action paths and suffixes remain text.');

const review='11111111-1111-4111-8111-111111111111',actions=turn=>renderToStaticMarkup(createElement(TurnActions,{turn:{id:review,user_text:'',assistant_text:'',status:'completed',...turn},onSend:async()=>{throw Error('Rendering must never confirm');}}));
for(const [field,operation,label]of [['application','enable','Authorize reviewed application'],['application','disable','Disable reviewed application'],['app_page','publish','Publish reviewed application page'],['app_page','unpublish','Take reviewed application offline']]){const html=actions({[field+'_confirmation_id']:review,[field+'_operation']:operation});assert.ok(html.includes(label));assert.ok(html.includes('min-h-11'));}
assert.ok(!actions({assistant_text:'Only you can apply this exact review: /confirm-application '+review}).includes('<button'));
assert.ok(!actions({application_confirmation_id:'bad-id'}).includes('<button'));
console.log('Application controls passed: distinct enable/disable/publish/withdraw labels, mobile target size, no action from prose and no confirmation while rendering.');

const start=ai=>renderToStaticMarkup(createElement(FirstDraftCard,{project:{id:review,name:'My idea',purpose:'A private notebook',preferred_theme:'ocean'},ai,busy:true,onSend:async()=>{throw Error('Render must not start a build');}}));
assert.ok(start(true).includes('Draft a website'));assert.ok(start(true).includes('Build an app'));assert.ok(start(true).includes('Read my saved brief'));assert.ok(start(true).includes('disabled=""'));assert.ok(start(true).includes('sm:flex-wrap'));
assert.ok(!start(false).includes('Build an app'));assert.ok(start(false).includes('Make a starter preview'));
console.log('First-build card passed: explicit website/app choices, saved brief, disabled actions, mobile wrapping and guided-only fallback.');
