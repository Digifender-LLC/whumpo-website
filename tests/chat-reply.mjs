Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({tsconfig:'tsconfig.frontend.json',stdin:{resolveDir:process.cwd(),contents:"export {AppRestoreReviewCard} from './frontend/src/app-restore-review-card';export {AppPageReviewCard} from './frontend/src/app-page-review-card';export {ApplicationReviewCard} from './frontend/src/application-review-card';export {FirstDraftCard} from './frontend/src/first-draft-card';export {ChatReply} from './frontend/src/chat-reply';export {TurnActions} from './frontend/src/chat-turn-actions';export {renderToStaticMarkup} from 'react-dom/server';export {createElement} from 'react';"},banner:{js:"import {createRequire as moduleRequire} from 'node:module';const require=moduleRequire(process.cwd()+'/package.json');"},bundle:true,format:'esm',platform:'node',write:false,jsx:'automatic'});
const {AppRestoreReviewCard,AppPageReviewCard,ApplicationReviewCard,FirstDraftCard,ChatReply,TurnActions,renderToStaticMarkup,createElement}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
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

const card=state=>renderToStaticMarkup(createElement(ApplicationReviewCard,{review:{id:review,projectName:'<script>Not HTML</script>',operation:'enable',state,expiresAt:'2026-09-30T12:00:00.000Z',source:'<img src=x onerror=alert(1)>',digest:'a'.repeat(64),testId:review}}));
for(const state of ['ready','applied','expired','changed']){const html=card(state);assert.ok(html.includes('Application approval'));assert.ok(html.includes('Each visitor has their own separate data'));assert.ok(html.includes('separate page approval'));assert.ok(html.includes('<details'));assert.ok(!html.includes('<details open'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;img src=x'));assert.ok(!html.includes('<button'));}
assert.ok(card('applied').includes('historical receipt'));assert.ok(card('expired').includes('can no longer be approved'));assert.ok(card('changed').includes('fresh review'));
const off=renderToStaticMarkup(createElement(ApplicationReviewCard,{review:{id:review,projectName:'Notebook',operation:'disable',state:'ready',expiresAt:'2026-09-30T12:00:00.000Z',source:'export default x=>x',digest:'a'.repeat(64),testId:null}}));assert.ok(off.includes('signs out every visitor'));assert.ok(off.includes('does not delete visitor data'));
console.log('Application summary passed: clear enable/disable effects, separate publication, historical/stale states, escaped source/project names, closed technical details and no approval authority in the card.');

assert.ok(actions({application_page_design_project_id:review}).includes('Design visitor page · uses AI'));
assert.ok(!actions({application_page_design_project_id:'invalid'}).includes('Design visitor page'));

const pageCard=(state,form={title:'<script>Notebook</script>',description:'Private notes',buttonLabel:'Save note',fields:[{key:'note',label:'<img src=x>Note',type:'text'},{key:'count',label:'Count',type:'number'},{key:'done',label:'Done',type:'boolean'}]})=>renderToStaticMarkup(createElement(AppPageReviewCard,{review:{id:review,projectId:review,projectName:'Notebook',state,expiresAt:'2026-09-30T12:00:00.000Z',form,programRevision:1,pageRevision:0}}));
for(const state of ['ready','applied','expired','changed']){const html=pageCard(state);assert.ok(html.includes('FORM PREVIEW'));assert.ok(html.includes('<fieldset disabled'));assert.ok(html.includes('type="checkbox"'));assert.ok(html.includes('type="number"'));assert.ok(html.includes('has not been tested'));assert.ok(html.includes('invitation and a passkey'));assert.ok(!html.includes('<form'));assert.ok(!html.includes('<a '));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<details open'));assert.ok(!html.includes('Publish reviewed application page'));}
assert.ok(pageCard('applied').includes('historical receipt'));assert.ok(pageCard('expired').includes('can no longer be approved'));assert.ok(pageCard('changed').includes('fresh review'));assert.ok(pageCard('ready',null).includes('data API offline'));assert.ok(!pageCard('ready',null).includes('<fieldset'));
console.log('Visitor page card passed: disabled text/number/checkbox preview, escaped public copy, separate approval, publication/session disclosures, historical/expired/changed states and no execution or navigation.');

const publishedActions=actions({app_page_live_project_id:review});assert.ok(publishedActions.includes('href="https://app-'+review+'.whumpo.site/"'));assert.ok(publishedActions.includes('Open visitor app'));assert.ok(publishedActions.includes('Manage visitor access'));assert.ok(publishedActions.includes('rel="noopener noreferrer"'));
assert.ok(!actions({assistant_text:'Published app '+review}).includes('Open visitor app'));assert.ok(!actions({app_page_live_project_id:'invalid'}).includes('Manage visitor access'));
console.log('Published app handoff passed: fixed customer host, explicit access control, no prose-derived actions and no automatic navigation or invitation.');

assert.ok(actions({app_page_live_project_id:review}).includes('Check app status · free'));

const restoreBase={id:review,projectId:review,projectName:'<script>unsafe</script>',pointId:review,pointCreatedAt:'2026-09-30T00:00:00.000Z',versionId:review,documents:2,expiresAt:'2026-09-30T01:00:00.000Z'};
for(const state of ['ready','applied','expired','changed']){const html=renderToStaticMarkup(createElement(AppRestoreReviewCard,{review:{...restoreBase,state},onSend:async()=>{throw Error('Rendering must not restore');}}));assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('Exact recovery details'));assert.ok(!html.includes('<details open'));assert.equal(html.includes('Review and restore data'),state==='ready');assert.ok(html.includes('app stays offline'));}
console.log('Restore card passed: escaped project names, explicit offline/lost-change effects, collapsed technical details, no action for historical/expired/changed reviews and no mutation while rendering.');
