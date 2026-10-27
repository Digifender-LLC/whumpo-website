import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Offline checks for the current workspace navigation contract. No network, storage or model.
const bundle=await build({entryPoints:['frontend/src/lib/workspace-navigation.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {workspaceView,essentialDestinations,navigationSection,pageNavigationLabel,pageAccessibleName,noteLocation,returnTarget,supportReference,selectedProject}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

// One Chat route. The superseded `/workspace/chat` alias and malformed paths resolve to nothing.
assert.equal(workspaceView('/workspace'),'chat');assert.equal(workspaceView('/workspace/'),'chat');
for(const view of ['dashboard','settings','photos','tab-garden-desk','saved-work','support'])assert.equal(workspaceView('/workspace/'+view),view);
assert.equal(workspaceView('/workspace/'+'tab-x/'),'tab-x');
for(const path of ['/workspace/chat','/workspace/chat/','/workspace/Chat','/workspace/a/b','/workspace/%2e%2e','/workspace/..','/elsewhere','/','/workspace/'+'x'.repeat(49)])assert.equal(workspaceView(path),'missing',path);

// Essential destinations are a fixed constant: account/security/sign-in, support, urgent takedown and pending work.
assert.deepEqual(essentialDestinations.map(item=>item.view),['saved-work','safety','support','security']);
assert(essentialDestinations.every(item=>item.label&&item.hint));
for(const item of essentialDestinations){assert.equal(navigationSection(item.view),'help');assert.doesNotMatch(item.view,/^tab-/,'A generated page ID can never replace an essential route');}
assert.equal(navigationSection('chat'),'chat');assert.equal(navigationSection('profile'),'help');assert.equal(navigationSection('security'),'help');
for(const view of ['dashboard','photos','inbox','visitors','domains','project','cms'])assert.equal(navigationSection(view),'dashboard');
for(const view of ['settings','billing','connections'])assert.equal(navigationSection(view),'settings');
assert.equal(navigationSection('tab-garden'),'pages');assert.equal(navigationSection('missing'),null);

// A generated page name cannot impersonate a fixed control.
for(const label of ['Support','support','Saved work','SAVED WORK','Site and app safety','Site & app safety','Account & security','Sign out','Sign-out','Help and account','Help','Chat','Dashboard','Your profile','Account help','Your pages'])assert.equal(pageNavigationLabel(label),label+' (your page)',label);
for(const label of ['Garden desk','Support tickets','Bakery overview'])assert.equal(pageNavigationLabel(label),label);

assert.equal(pageAccessibleName('Support'),'Support, your page');assert.equal(pageAccessibleName('Garden desk'),'Garden desk');

// Fixed pages return to the last non-fixed page in this tab, else Dashboard.
assert.deepEqual(returnTarget(),{view:'dashboard',label:'Dashboard'});
for(const [path,expected] of [['/workspace',{view:'chat',label:'Whumpo'}],['/workspace/saved-work',{view:'chat',label:'Whumpo'}],['/workspace/billing',{view:'settings',label:'Settings'}],['/workspace/support',{view:'settings',label:'Settings'}],['/workspace/tab-garden',{view:'tab-garden',label:'your page'}],['/workspace/photos',{view:'dashboard',label:'Dashboard'}],['/workspace/chat',{view:'dashboard',label:'Dashboard'}]]){noteLocation(path);assert.deepEqual(returnTarget(),expected,path);}

// Error replies carry one content-free status link; anything else shows no link.
assert.equal(supportReference('/workspace/support?ref='+encodeURIComponent('status:chat_unavailable')),'status:chat_unavailable');
assert.equal(supportReference('/workspace/support?ref=status:usage_limit'),'status:usage_limit');
assert.equal(supportReference('/workspace/support?ref=status%3Aonboarding_required'),'status:onboarding_required');
for(const value of [undefined,null,42,'','https://evil.invalid/workspace/support?ref=status:usage_limit','/workspace/support?ref=status:unknown','/workspace/support?ref=status:usage_limit&ref=status:chat_unavailable','/workspace/support?ref=status:usage_limit&next=/elsewhere','/workspace/support?ref=operation:chat:'+crypto.randomUUID(),'/workspace/support?ref=free%20text','/workspace/supportx?ref=status:usage_limit','//evil.invalid/workspace/support?ref=status:usage_limit'])assert.equal(supportReference(value),null,String(value));

// The project locator remains strict and owned-only (WH-111 selected-project continuity).
const owned=crypto.randomUUID(),foreign=crypto.randomUUID();
assert.deepEqual(selectedProject('?project='+owned,[{id:owned}]),{project:owned,stale:false});
assert.deepEqual(selectedProject('?project='+foreign,[{id:owned}]),{project:'',stale:true});
assert.deepEqual(selectedProject('?project='+owned+'&project='+owned,[{id:owned}]),{project:'',stale:true});
assert.deepEqual(selectedProject('',[{id:owned}]),{project:'',stale:false});
console.log('Workspace navigation passed: one Chat route, fixed essential destinations outside generated layouts, reserved page names, strict support links and owned project locators. No network or storage.');
