import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';

// WH-155 source notification catalog suite. Synthetic values only: no database, network, credential, model, provider or
// Cloudflare resource. It proves the TypeScript catalog, closed validators and plain-text renderer in src/notification-catalog.ts,
// that they AGREE with the frozen offline reference (tools/prototypes/notifications.mjs, never imported by a Worker), and that the
// WH-036 contact notices rendered through the catalog are byte-identical to their historical text. It does not prove D1 storage,
// delivery, real provider behavior or any activation. The suite is also run against deliberately broken copies of the source
// (mutants below); each must be caught by the check written for that property.
const ref=await import(new URL('../tools/prototypes/notifications.mjs',import.meta.url));
const catalogPath=new URL('../src/notification-catalog.ts',import.meta.url).pathname;
const catalogText=readFileSync(catalogPath,'utf8');
const load=async(entryContents,text)=>{
 const out=await build({stdin:{contents:entryContents,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'neutral',write:false,logLevel:'silent',
  plugins:text?[{name:'mutate',setup(b){b.onLoad({filter:/notification-catalog\.ts$/},()=>({contents:text,loader:'ts',resolveDir:new URL('../src/',import.meta.url).pathname}));}}]:[]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
};
const catalogEntry="export * from './src/notification-catalog';";
const P='11111111-1111-4111-8111-111111111111';
const standard=(catalog=ref.notificationCatalog)=>ref.standardAppointmentConfigurations({resourceId:P,formId:'appointment',serviceField:'service',dayField:'day',businessName:'Shine Mobile Detailing'},catalog);
const GOLDEN_NEW_MESSAGE={subject:'New contact-form message in Whumpo',text:'A visitor sent a new message through a contact form on one of your Whumpo websites.\n\nRead it in your private inbox: https://whumpo.com/workspace/inbox\n\nThis notice does not include the message.\n\nYou receive this because this address was added and verified for contact-form notices in Whumpo. To stop them, remove the address in Dashboard → Contact inbox (https://whumpo.com/workspace/inbox).'};
const GOLDEN_VERIFICATION={subject:'Your Whumpo verification code',text:'Your Whumpo verification code is ABCD2345\n\nEnter it in Dashboard → Contact inbox within one hour to receive contact-form notices at this address. If you did not ask for this, ignore this email; nothing will be sent unless the code is entered.'};
// The WH-036 provider error sets exactly as shipped before the catalog existed (historical text, not re-verified).
const HISTORICAL={
 notTaken:['E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED','E_SENDER_NOT_VERIFIED','E_SENDER_DOMAIN_NOT_AVAILABLE'],
 rejected:['E_VALIDATION_ERROR','E_FIELD_MISSING','E_TOO_MANY_RECIPIENTS','E_TOO_MANY_ATTACHMENTS','E_RECIPIENT_NOT_ALLOWED','E_CONTENT_TOO_LARGE','E_DELIVERY_FAILED','E_HEADER_NOT_ALLOWED','E_HEADER_USE_API_FIELD','E_HEADER_VALUE_INVALID','E_HEADER_VALUE_TOO_LONG','E_HEADER_NAME_INVALID','E_HEADERS_TOO_LARGE','E_HEADERS_TOO_MANY'],
 suppressed:['E_RECIPIENT_SUPPRESSED'],
};

const code=async fn=>{try{await fn();return 'OK';}catch(e){return e.code??`THROWN:${e.message}`;}};
const walk=(value,seen=new Set())=>{
 if(value===null||typeof value!=='object'||seen.has(value))return [];
 seen.add(value);return [value,...Object.values(value).flatMap(v=>walk(v,seen))];
};

async function suite(m){
 let count=0;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const src=()=>structuredClone(m.notificationCatalog);
 // The reference catalog has no pinned digest field; the source one does. Mutations apply to both through this pair.
 const both=()=>({s:src(),r:structuredClone(ref.notificationCatalog)});
 const agree=async(name,mutate,expected,{configuration}={})=>{
  const {s,r}=both();mutate(s);mutate(r);
  const a=await code(()=>configuration?ref.validateConfiguration(structuredClone(configuration),r):ref.validateCatalog(r));
  const b=configuration?await code(()=>m.validateNotificationConfiguration(structuredClone(configuration),s)):await code(()=>m.validateNotificationCatalog(s));
  assert.equal(a,expected,`reference ${name}`);
  assert.equal(b,expected,`source ${name}`);
 };

 await test('registries and the catalog are deeply frozen and cannot be widened',()=>{
  const registries={recipientScopes:m.recipientScopes,authorityClasses:m.authorityClasses,notificationTriggers:m.notificationTriggers,readinessLevels:m.readinessLevels,renderableReadiness:m.renderableReadiness,notificationBounds:m.notificationBounds,platformLinks:m.platformLinks,variableTypes:m.variableTypes,notificationCatalog:m.notificationCatalog};
  for(const [name,registry] of Object.entries(registries))for(const node of walk(registry))assert.ok(Object.isFrozen(node),`${name} has an unfrozen member`);
  assert.throws(()=>m.recipientScopes.push('anyone'),TypeError);
  assert.throws(()=>{m.platformLinks['workspace-inbox']='https://evil.test/';},TypeError);
  assert.throws(()=>{m.platformLinks.evil='https://evil.test/';},TypeError);
  assert.throws(()=>{m.notificationBounds.maxAttempts=99;},TypeError);
  assert.throws(()=>{m.variableTypes['text-line']=()=>true;},TypeError);
  const c=m.notificationCatalog;
  assert.throws(()=>{c.senders['whumpo-notify'].address='attacker@example.test';},TypeError);
  assert.throws(()=>{c.senders.evil={};},TypeError);
  assert.throws(()=>{c.providers['cloudflare-email'].ceiling.callsPer32Days=1e9;},TypeError);
  assert.throws(()=>c.providers['cloudflare-email'].errorClasses.rejected.push('E_NOTHING'),TypeError);
  assert.throws(()=>{c.templates['contact.new-message@1'].template.body[0].text='x';},TypeError);
  assert.throws(()=>c.templates['contact.new-message@1'].template.body.push({text:'x'}),TypeError);
  assert.throws(()=>{delete c.templates['contact.new-message@1'];},TypeError);
  assert.throws(()=>{c.templates['appointment.staff-notice@1'].readiness='live-accepted';},TypeError);
  assert.throws(()=>Object.defineProperty(c.providers,'evil',{value:{}}),TypeError);
  assert.throws(()=>Object.setPrototypeOf(c.templates,{}),TypeError);
  // None of the attempts changed what is rendered.
  assert.deepEqual(m.renderNotification('contact.new-message@1'),GOLDEN_NEW_MESSAGE);
 });

 await test('templates, senders, providers and classification agree with the reference catalog',async()=>{
  const sc=m.notificationCatalog,rc=ref.notificationCatalog;
  assert.deepEqual(Object.keys(sc.templates),Object.keys(rc.templates));
  for(const [key,e] of Object.entries(sc.templates)){
   assert.deepEqual(e.template,rc.templates[key].template,key);
   assert.equal(e.state,rc.templates[key].state,key);assert.equal(e.readiness,rc.templates[key].readiness,key);
   assert.equal(e.digest,ref.templateDigest(rc.templates[key].template),`${key} pinned digest`);
   assert.equal(await m.templateDigest(e.template),e.digest,`${key} recomputed digest`);
  }
  assert.deepEqual(sc.providers,rc.providers);assert.deepEqual(sc.senders,rc.senders);assert.equal(sc.contractVersion,rc.contractVersion);
  for(const k of ['recipientScopes','authorityClasses','readinessLevels'])assert.deepEqual(m[k],ref[k],k);
  assert.deepEqual(m.notificationTriggers,ref.triggers);assert.deepEqual(m.platformLinks,ref.platformLinks);
  assert.deepEqual(m.notificationBounds,ref.bounds);
  assert.equal(m.notificationContractVersion,ref.contractVersion);
  assert.deepEqual(Object.keys(m.variableTypes).sort(),Object.keys(ref.variableTypes).sort());
  assert.equal((await m.validateNotificationCatalog(m.notificationCatalog)).contractVersion,1);
  assert.equal(ref.validateCatalog(rc),true);
  for(const c of [...HISTORICAL.notTaken,...HISTORICAL.rejected,...HISTORICAL.suppressed,'E_INTERNAL_SERVER_ERROR','E_NOT_DOCUMENTED','','constructor','__proto__'])
   assert.equal(m.classifyProviderError(sc,'cloudflare-email',c),ref.classifyProviderError(rc,'cloudflare-email',c),c);
  assert.equal(m.classifyProviderError(sc,'__proto__','E_RATE_LIMIT_EXCEEDED'),'uncertain');
  assert.equal(m.classifyProviderError(sc,'unknown-provider','E_RATE_LIMIT_EXCEEDED'),'uncertain');
  assert.deepEqual(sc.providers['cloudflare-email'].errorClasses,HISTORICAL);
  // No entry claims live acceptance; contact templates are source, appointment templates stay planned and still available.
  assert.ok(Object.values(sc.templates).every(e=>e.readiness!=='live-accepted'));
  assert.deepEqual(Object.entries(sc.templates).filter(([,e])=>e.readiness==='source').map(([k])=>k).sort(),['contact.new-message@1','owner.destination-verification@1']);
  assert.deepEqual(Object.entries(sc.templates).filter(([,e])=>e.readiness==='planned').map(([k])=>k).sort(),['appointment.request-receipt@1','appointment.staff-notice@1']);
 });

 await test('digests are canonical, idempotent, key-order independent and agree with the reference',async()=>{
  for(const [key,e] of Object.entries(m.notificationCatalog.templates)){
   const t=structuredClone(e.template);
   const a=await m.templateDigest(t),b=await m.templateDigest(t);
   assert.equal(a,b,'idempotent');assert.match(a,/^[0-9a-f]{64}$/);
   assert.equal(a,ref.digest(e.template),`${key} agrees with node:crypto reference`);
   const shuffled=Object.fromEntries(Object.entries(t).reverse());shuffled.variables=Object.fromEntries(Object.entries(t.variables).reverse());
   assert.equal(await m.templateDigest(shuffled),a,'key order does not matter');
   assert.equal(await m.templateDigest(m.validateNotificationTemplate(t)),a,'a validated copy keeps the digest');
   const edited=structuredClone(t);edited.subject[0]={text:(edited.subject[0].text??'')+' '};
   assert.notEqual(await m.templateDigest(edited),a,'any edit changes the digest');
  }
  const tricky={a:1,b:[1,2,{z:true,y:null}],c:'é→\u0000"'};
  assert.equal(await m.templateDigest(tricky),ref.digest(tricky));
  const distinct=new Set(await Promise.all(Object.values(m.notificationCatalog.templates).map(e=>m.templateDigest(e.template))));
  assert.equal(distinct.size,4);
  for(const bad of [{get x(){return 1;}},{x:NaN},{x:undefined},{x:()=>1},new Map(),Object.create({inherited:1}),(()=>{const o={};o.self=o;return o;})()])
   assert.notEqual(await code(()=>m.templateDigest(bad)),'OK','refuses non-canonical input');
  let hooks=0;const hooked={toJSON(){hooks++;return {a:1};}};
  await code(()=>m.templateDigest(hooked));assert.equal(hooks,0,'toJSON hooks are never invoked');
 });

 await test('template and catalog validators agree with the reference on every rejected shape',async()=>{
  const tpl=(key,mutate)=>s=>mutate(s.templates[key].template);
  const staff='appointment.staff-notice@1',receipt='appointment.request-receipt@1',contact='contact.new-message@1',verify='owner.destination-verification@1';
  const cases=[
   ['unknown contract version',s=>{s.contractVersion=2;},'UNSUPPORTED_VERSION'],
   ['unknown catalog field',s=>{s.extra=1;},'UNKNOWN_FIELD'],
   ['unknown template version',tpl(staff,t=>{t.contractVersion=2;}),'UNSUPPORTED_VERSION'],
   ['unknown template field',tpl(staff,t=>{t.layout='html';}),'UNKNOWN_FIELD'],
   ['marketing purpose',tpl(staff,t=>{t.purpose='marketing';}),'NOT_TRANSACTIONAL'],
   ['unknown authority',tpl(staff,t=>{t.authority='anyone';}),'UNKNOWN_AUTHORITY'],
   ['unknown trigger',tpl(staff,t=>{t.trigger='form.created';}),'UNKNOWN_TRIGGER'],
   ['unknown scope',tpl(staff,t=>{t.audiences=['everyone'];}),'UNKNOWN_SCOPE'],
   ['platform template triggered by form.accepted',tpl(contact,t=>{t.trigger='form.accepted';}),'AUTHORITY_MISMATCH'],
   ['platform template with staff audience',tpl(contact,t=>{t.audiences=['project-staff'];}),'AUTHORITY_MISMATCH'],
   ['configured template on a platform trigger',tpl(staff,t=>{t.trigger='contact.accepted';}),'AUTHORITY_MISMATCH'],
   ['relay key in a template',tpl(staff,t=>{t.url='https://evil.test/';}),'OPEN_RELAY'],
   ['nested relay key',tpl(staff,t=>{t.variables.businessName.recipients=['a'];}),'OPEN_RELAY'],
   ['credential key in a template',tpl(staff,t=>{t.apiKey='secret';}),'SECRET_FIELD'],
   ['template language',tpl(staff,t=>{t.body.push({text:'{{owner.email}}'});}),'TEMPLATE_SYNTAX'],
   ['template literal syntax',tpl(staff,t=>{t.body.push({text:'${process.env}'});}),'TEMPLATE_SYNTAX'],
   ['CRLF header injection in the subject',tpl(staff,t=>{t.subject.push({text:'\r\nBcc: a@example.test'});}),'HEADER_INJECTION'],
   ['U+2028 in the subject',tpl(staff,t=>{t.subject.push({text:'a\u2028b'});}),'HEADER_INJECTION'],
   ['control character in the body',tpl(staff,t=>{t.body.push({text:'a\u0007b'});}),'HEADER_INJECTION'],
   ['link in the subject',tpl(staff,t=>{t.subject.push({link:'workspace-records'});}),'UNKNOWN_LINK'],
   ['unknown link',tpl(staff,t=>{t.body.push({link:'attacker'});}),'UNKNOWN_LINK'],
   ['undeclared variable',tpl(staff,t=>{t.body.push({var:'ghost'});}),'UNDECLARED_VARIABLE'],
   ['unused variable',tpl(staff,t=>{t.variables.extra={source:'config',type:'text-line'};}),'UNUSED_VARIABLE'],
   ['free-text record variable',tpl(receipt,t=>{t.variables.service.type='text';}),'INVALID_VARIABLE'],
   ['url variable',tpl(staff,t=>{t.variables.businessName={source:'request',type:'url'};}),'INVALID_VARIABLE'],
   ['record value in a staff notice',tpl(staff,t=>{t.variables.vehicle={source:'record',type:'choice'};t.body.push({var:'vehicle'});}),'CONTENT_IN_NOTICE'],
   ['verification code in a non-verification notice',tpl(contact,t=>{t.variables.code={source:'platform',type:'code'};t.body.push({var:'code'});}),'INVALID_VARIABLE'],
   ['over-long body',tpl(staff,t=>{t.body.push({text:'x'.repeat(4001)});}),'TOO_LONG'],
   ['over-long subject',tpl(staff,t=>{t.subject.push({text:'x'.repeat(121)});}),'TOO_LONG'],
   ['malformed segment',tpl(staff,t=>{t.body.push({text:'a',var:'businessName'});}),'INVALID_SEGMENT'],
   ['unknown readiness',s=>{s.templates[staff].readiness='shipped';},'UNKNOWN_READINESS'],
   ['unknown entry state',s=>{s.templates[staff].state='hidden';},'INVALID_STATE'],
   ['key does not match id and version',s=>{s.templates['appointment.staff-notice@2']=s.templates[staff];delete s.templates[staff];},'INVALID_ID'],
   ['sender with header bytes in the display name',s=>{s.senders['whumpo-notify'].displayName='Whumpo\r\nBcc: a@example.test';},'HEADER_INJECTION'],
   ['sender on an unknown provider',s=>{s.senders['whumpo-notify'].provider='ghost';},'UNKNOWN_PROVIDER'],
   ['verified sender without a DNS review',s=>{s.senders['whumpo-notify'].dnsReview='';},'UNREVIEWED_SENDER'],
   ['unknown sender state',s=>{s.senders['whumpo-notify'].state='trusted';},'INVALID_SENDER'],
   ['unknown sender field',s=>{s.senders['whumpo-notify'].replyTo='a@example.test';},'UNKNOWN_FIELD'],
   ['provider without a ceiling shape',s=>{s.providers['cloudflare-email'].ceiling={callsPer32Days:0};},'INVALID_CEILING'],
   ['negative provider price',s=>{s.providers['cloudflare-email'].price.microsPerCall=-1;},'INVALID_PRICE'],
   ['unknown provider idempotency',s=>{s.providers['cloudflare-email'].idempotency='best-effort';},'INVALID_IDEMPOTENCY'],
   ['unknown provider readiness',s=>{s.providers['cloudflare-email'].readiness='live';},'UNKNOWN_READINESS'],
   ['provider without error classes',s=>{delete s.providers['cloudflare-email'].errorClasses.suppressed;},'MISSING_FIELD'],
   ['unknown provider field',s=>{s.providers['cloudflare-email'].apiKey='x';},'UNKNOWN_FIELD'],
  ];
  for(const [name,mutate,expected] of cases)await agree(name,mutate,expected);
  // Several breakages at once still reject, and every code comes from a template/catalog that was never partly applied.
  const {s}=both();s.templates[verify].template.subject[0]={link:'workspace-inbox'};
  assert.equal(await code(()=>m.validateNotificationCatalog(s)),'UNKNOWN_LINK');
 });

 await test('source validators are stricter where the reference is silent',async()=>{
  const expect=async(name,mutate,expected)=>{const s=src();mutate(s);assert.equal(await code(()=>m.validateNotificationCatalog(s)),expected,name);};
  await expect('edited template without a new pinned digest',s=>{s.templates['contact.new-message@1'].template.subject[0].text='Another subject';},'DIGEST_MISMATCH');
  await expect('wrong pinned digest',s=>{s.templates['contact.new-message@1'].digest='0'.repeat(64);},'DIGEST_MISMATCH');
  await expect('missing pinned digest',s=>{delete s.templates['contact.new-message@1'].digest;},'MISSING_FIELD');
  await expect('malformed pinned digest',s=>{s.templates['contact.new-message@1'].digest=s.templates['contact.new-message@1'].digest.toUpperCase();},'INVALID_DIGEST');
  await expect('sender address with header bytes',s=>{s.senders['whumpo-notify'].address='notify@whumpo.com\r\nBcc: a@example.test';},'INVALID_SENDER');
  await expect('sender display-name address',s=>{s.senders['whumpo-notify'].address='Whumpo <notify@whumpo.com>';},'INVALID_SENDER');
  await expect('error code in two classes',s=>{s.providers['cloudflare-email'].errorClasses.notTaken.push('E_VALIDATION_ERROR');},'INVALID_ERROR_CLASS');
  await expect('malformed error code',s=>{s.providers['cloudflare-email'].errorClasses.rejected.push('not a code');},'INVALID_ERROR_CLASS');
  await expect('unknown event mode',s=>{s.providers['cloudflare-email'].events='webhook';},'INVALID_EVENTS');
  await expect('unknown lookup mode',s=>{s.providers['cloudflare-email'].lookup='scan';},'INVALID_LOOKUP');
  await expect('price without a date',s=>{s.providers['cloudflare-email'].price.checkedAt='today';},'INVALID_PRICE');
  await expect('review without a date',s=>{s.providers['cloudflare-email'].review.reviewedAt='soon';},'INVALID_REVIEW');
  await expect('prototype-looking sender key',s=>{s.senders=JSON.parse('{"__proto__":{"address":"a@example.test"}}');},'INVALID_ID');
  await expect('accessor in a catalog',s=>{Object.defineProperty(s.senders['whumpo-notify'],'address',{get(){return 'notify@whumpo.com';},enumerable:true});},'INVALID_SHAPE');
 });

 await test('configuration validator agrees with the reference and returns the same digest',async()=>{
  const cfgs=standard();
  for(const cfg of cfgs){
   const a=ref.validateConfiguration(structuredClone(cfg)),b=await m.validateNotificationConfiguration(structuredClone(cfg));
   assert.equal(b.configurationDigest,a.configurationDigest,cfg.id);
   assert.deepEqual(b.template,a.template);assert.deepEqual(b.sender,a.sender);assert.deepEqual(b.price,a.price);assert.deepEqual(b.provider,a.provider);
   assert.equal(b.readiness,'planned','a valid configuration over a planned template is still planned');
  }
  const [staff,,receipt]=cfgs;
  const bad=(name,mutate,expected,catalog=()=>{})=>{const cfg=structuredClone(staff);mutate(cfg);return agree(name,catalog,expected,{configuration:cfg});};
  await bad('the unmodified configuration',()=>{},'OK');
  await bad('unknown template',c=>{c.template.id='appointment.ghost';},'UNKNOWN_TEMPLATE');
  await bad('unknown template version',c=>{c.template.version=2;},'UNKNOWN_TEMPLATE');
  await bad('stale template digest',c=>{c.template.digest='0'.repeat(64);},'STALE_TEMPLATE');
  await bad('withdrawn template',()=>{},'TEMPLATE_WITHDRAWN',s=>{s.templates['appointment.staff-notice@1'].state='withdrawn';});
  await bad('platform template',c=>{c.template={id:'contact.new-message',version:1,digest:ref.templateDigest(ref.notificationCatalog.templates['contact.new-message@1'].template)};c.trigger.event='contact.accepted';},'PLATFORM_TEMPLATE');
  await bad('trigger mismatch',c=>{c.trigger.event='contact.accepted';},'TRIGGER_MISMATCH');
  await bad('bad resource id',c=>{c.trigger.resourceId='not-a-uuid';},'INVALID_ID');
  await bad('scope not offered by the template',c=>{c.recipientScope='submitter';},'SCOPE_NOT_ALLOWED');
  await bad('unknown scope',c=>{c.recipientScope='everyone';},'SCOPE_NOT_ALLOWED');
  await bad('unknown sender',c=>{c.sender='attacker';},'UNKNOWN_SENDER');
  await bad('unverified sender',()=>{},'SENDER_NOT_VERIFIED',s=>{s.senders['whumpo-notify'].state='unverified';});
  await bad('planned sender',()=>{},'SENDER_NOT_VERIFIED',s=>{s.senders['whumpo-notify'].state='planned';});
  await bad('unreviewed provider',()=>{},'UNREVIEWED_PROVIDER',s=>{s.providers['cloudflare-email'].review=null;});
  await bad('unpriced provider',()=>{},'UNPRICED_PROVIDER',s=>{s.providers['cloudflare-email'].price=null;});
  await bad('unbounded provider charge',()=>{},'UNBOUNDED_CHARGE',s=>{s.providers['cloudflare-email'].ceiling=null;});
  await bad('missing configuration value',c=>{c.values={};},'UNKNOWN_FIELD');
  await bad('extra configuration value',c=>{c.values.note='hello';},'UNKNOWN_FIELD');
  await bad('newline in a configuration value',c=>{c.values.businessName='Shine\nBcc: a@b.test';},'HEADER_INJECTION');
  await bad('address in a configuration value',c=>{c.values.businessName='mail owner@example.test';},'CONFIG_URL');
  await bad('url in a configuration value',c=>{c.values.businessName='see https://evil.test/';},'CONFIG_URL');
  await bad('www in a configuration value',c=>{c.values.businessName='www.shine';},'CONFIG_URL');
  await bad('domain in a configuration value',c=>{c.values.businessName='shine.com detailing';},'CONFIG_URL');
  await bad('markup in a configuration value',c=>{c.values.businessName='<b>Shine</b>';},'INVALID_VALUE');
  await bad('over-long configuration value',c=>{c.values.businessName='x'.repeat(81);},'INVALID_VALUE');
  await bad('non-string configuration value',c=>{c.values.businessName=5;},'HEADER_INJECTION');
  await bad('hourly limit too high',c=>{c.limits.perRecipientHour=11;},'LIMIT_TOO_HIGH');
  await bad('daily limit too high',c=>{c.limits.perRecipientDay=51;},'LIMIT_TOO_HIGH');
  await bad('daily below hourly',c=>{c.limits.perRecipientHour=10;c.limits.perRecipientDay=5;},'LIMIT_TOO_HIGH');
  await bad('unknown configuration field',c=>{c.layout='html';},'UNKNOWN_FIELD');
  await bad('wrong contract version',c=>{c.contractVersion=2;},'UNSUPPORTED_VERSION');
  await agree('receipt: record fields must name record keys',()=>{},'OK',{configuration:receipt});
  const unknownField=structuredClone(receipt);unknownField.fields.vehicle='vehicle';
  await agree('receipt: extra record field',()=>{},'UNKNOWN_FIELD',{configuration:unknownField});
  const badField=structuredClone(receipt);badField.fields.service='Bad Field';
  await agree('receipt: malformed record field name',()=>{},'INVALID_ID',{configuration:badField});
 });

 await test('no configuration, template or caller value can supply an address, header, URL, provider or credential',async()=>{
  const [staff]=standard();
  for(const [key,value] of Object.entries({to:'a@example.test',cc:'a@example.test',bcc:['a@example.test'],recipients:['a@example.test'],address:'a@example.test',email:'a@example.test',replyTo:'a@example.test',reply_to:'a@example.test',from:'a@example.test',headers:{Bcc:'a@example.test'},header:'x',url:'https://evil.test/',href:'https://evil.test/',webhook:'https://evil.test/',callback:'https://evil.test/',returnPath:'a@example.test'})){
   for(const place of ['top','values','trigger','limits']){
    const cfg=structuredClone(staff);(place==='top'?cfg:cfg[place])[key]=value;
    assert.equal(await code(()=>m.validateNotificationConfiguration(cfg)),'OPEN_RELAY',`${key} in ${place}`);
   }
   assert.equal(await code(()=>m.renderNotificationTemplate(m.notificationCatalog.templates['appointment.staff-notice@1'].template,{businessName:'Shine',[key]:value})),'UNKNOWN_FIELD',`render value ${key}`);
  }
  for(const key of ['apiKey','api_key','token','secret','password','authorization','credential','credentials','bearer','privateKey','binding']){
   const cfg=structuredClone(staff);cfg.values[key]='x';
   assert.equal(await code(()=>m.validateNotificationConfiguration(cfg)),'SECRET_FIELD',key);
  }
  // A configuration cannot name a provider or a sender address: only a catalog sender ID.
  for(const field of ['provider','sender-address','transport']){const cfg=structuredClone(staff);cfg[field]='cloudflare-email';assert.equal(await code(()=>m.validateNotificationConfiguration(cfg)),'UNKNOWN_FIELD',field);}
  for(const sender of ['notify@whumpo.com','attacker@example.test','Whumpo <notify@whumpo.com>','cloudflare-email','constructor','__proto__','toString']){
   const cfg=structuredClone(staff);cfg.sender=sender;assert.equal(await code(()=>m.validateNotificationConfiguration(cfg)),'UNKNOWN_SENDER',sender);
  }
  const protoCfg=JSON.parse(JSON.stringify(staff).replace('"values":{','"values":{"__proto__":{"to":"a@example.test"},'));
  assert.notEqual(await code(()=>m.validateNotificationConfiguration(protoCfg)),'OK','__proto__ smuggling');
  const protoTemplate=JSON.parse(JSON.stringify(m.notificationCatalog.templates['appointment.staff-notice@1'].template).replace('"purpose"','"__proto__":{"url":"https://evil.test/"},"purpose"'));
  assert.notEqual(await code(()=>m.validateNotificationTemplate(protoTemplate)),'OK','__proto__ in a template');
  // The renderer returns only a subject and text: no header, address or URL channel exists on its result.
  const r=m.renderNotification('owner.destination-verification@1',{code:'ABCD2345'});
  assert.deepEqual(Object.keys(r),['subject','text']);
  // URLs in rendered text come only from fixed platform links.
  const urls=[...m.renderNotificationTemplate(m.notificationCatalog.templates['appointment.staff-notice@1'].template,{businessName:'Shine'}).text.matchAll(/https?:\/\/\S+/g)].map(x=>x[0].replace(/[.)]+$/,''));
  assert.deepEqual(urls,['https://whumpo.com/workspace/records']);
  for(const entry of Object.values(m.notificationCatalog.templates))for(const link of walk(entry.template).filter(n=>'link' in n&&!Array.isArray(n)))assert.ok(Object.hasOwn(m.platformLinks,link.link));
 });

 await test('renderer agrees with the reference, is deterministic and treats every value as data',async()=>{
  const fields={service:{options:['Exterior wash','Full detail']},day:{options:['Monday','Tuesday']}};
  const samples={'contact.new-message@1':{},'owner.destination-verification@1':{code:'ABCD2345'},'appointment.staff-notice@1':{businessName:'Shine Mobile Detailing'},
   'appointment.request-receipt@1':{businessName:'Shine Mobile Detailing',reference:'0A1B2C3D',service:'Full detail',day:'Tuesday'}};
  for(const [key,values] of Object.entries(samples)){
   const t=m.notificationCatalog.templates[key].template;
   const a=m.renderNotificationTemplate(t,values,fields),b=m.renderNotificationTemplate(structuredClone(t),structuredClone(values),structuredClone(fields));
   assert.deepEqual(a,ref.render(ref.notificationCatalog.templates[key].template,values,fields),key);
   assert.deepEqual(a,b,'deterministic');assert.ok(!a.subject.includes('\n'));
  }
  const staff=m.notificationCatalog.templates['appointment.staff-notice@1'].template;
  // Template-looking and markup-looking values never become syntax.
  const literal=m.renderNotificationTemplate(staff,{businessName:'{{owner.email}}'});
  assert.equal(literal.subject,'New appointment request for {{owner.email}}');
  assert.deepEqual(literal,ref.render(ref.notificationCatalog.templates['appointment.staff-notice@1'].template,{businessName:'{{owner.email}}'}));
  const invalid=['', 'x'.repeat(81),'Shine\nBcc: a@example.test','Shine\r\n','<b>x</b>','a@example.test','https://evil.test/','www.evil','shine.io',5,null,undefined,['x'],{}];
  for(const businessName of invalid){
   const values=businessName===undefined?{}:{businessName};
   const a=await code(()=>m.renderNotificationTemplate(staff,values)),b=await code(()=>ref.render(ref.notificationCatalog.templates['appointment.staff-notice@1'].template,values));
   assert.ok(['INVALID_VARIABLE','INVALID_SHAPE'].includes(a),`${JSON.stringify(businessName)} -> ${a}`);
   if(a==='INVALID_VARIABLE')assert.equal(b,'INVALID_VARIABLE');
  }
  const receipt=m.notificationCatalog.templates['appointment.request-receipt@1'].template,base={businessName:'Shine',reference:'0A1B2C3D',service:'Full detail',day:'Tuesday'};
  for(const [name,patch] of Object.entries({'choice outside the configured options':{service:'Gold package'},'choice with a line break':{day:'Tuesday\nBcc: x'},'lowercase reference':{reference:'0a1b2c3d'},'short reference':{reference:'0A1B2C'},'free text for a choice':{service:'Full detail and more'}}))
   assert.equal(await code(()=>m.renderNotificationTemplate(receipt,{...base,...patch},fields)),'INVALID_VARIABLE',name);
  assert.equal(await code(()=>m.renderNotificationTemplate(receipt,base)),'INVALID_VARIABLE','choice with no configured options');
  assert.equal(await code(()=>m.renderNotificationTemplate(staff,{})),'INVALID_VARIABLE','missing value');
  assert.equal(await code(()=>m.renderNotificationTemplate(staff,{businessName:'Shine',note:'x'})),'UNKNOWN_FIELD','unknown value name');
  assert.equal(await code(()=>m.renderNotificationTemplate(staff,JSON.parse('{"businessName":"Shine","__proto__":{"to":"a"}}'))),'UNKNOWN_FIELD','__proto__ as a value name');
  assert.equal(await code(()=>m.renderNotificationTemplate(staff,[])),'INVALID_SHAPE','values must be an object');
  assert.equal(await code(()=>m.renderNotificationTemplate({...staff,body:[{text:'x'},{var:'ghost'}]},{businessName:'Shine'})),'UNDECLARED_VARIABLE','an invalid template is never rendered');
  const code8=m.notificationCatalog.templates['owner.destination-verification@1'].template;
  for(const bad of ['abcd2345','ABCD234','ABCD23456','ABCD 345','ABCD234!','',null,5,undefined])assert.equal(await code(()=>m.renderNotificationTemplate(code8,bad===undefined?{}:{code:bad})),'INVALID_VARIABLE',String(bad));
  // Subject and text are both bounded and the subject is one line.
  const longName=m.renderNotificationTemplate(staff,{businessName:'x'.repeat(80)});
  assert.ok(longName.subject.length<=120&&!longName.subject.includes('\n'));
 });

 await test('planned, withdrawn and unknown entries are never activated by being in the catalog',async()=>{
  // Planned appointment templates validate as declarations but are not renderable notices.
  for(const key of ['appointment.staff-notice@1','appointment.request-receipt@1'])
   assert.equal(await code(()=>m.renderNotification(key,{businessName:'Shine',reference:'0A1B2C3D',service:'Full detail',day:'Tuesday'},{service:{options:['Full detail']},day:{options:['Tuesday']}})),'TEMPLATE_NOT_IMPLEMENTED',key);
  for(const key of ['nope@1','contact.new-message@2','constructor','__proto__','toString',''])assert.equal(await code(()=>m.renderNotification(key)),'UNKNOWN_TEMPLATE',key);
  // A synthetic catalog cannot raise readiness by adding or editing an entry either: the readiness is data, and only source/live-accepted render.
  const s=src(),entry=structuredClone(s.templates['contact.new-message@1']);
  for(const readiness of ['planned','synthetic-conformant'])assert.equal(await code(()=>m.renderNotification('contact.new-message@1',{},{},{...s,templates:{...s.templates,'contact.new-message@1':{...entry,readiness}}})),'TEMPLATE_NOT_IMPLEMENTED',readiness);
  assert.equal(await code(()=>m.renderNotification('contact.new-message@1',{},{},{...s,templates:{...s.templates,'contact.new-message@1':{...entry,state:'withdrawn'}}})),'TEMPLATE_WITHDRAWN');
  assert.equal(await code(()=>m.renderNotification('contact.new-message@1',{},{},s)),'OK');
  // A configuration over a withdrawn entry is refused; a stale pin is refused; there is no fallback to another version.
  const [cfg]=standard();
  const w=src();w.templates['appointment.staff-notice@1'].state='withdrawn';
  assert.equal(await code(()=>m.validateNotificationConfiguration(structuredClone(cfg),w)),'TEMPLATE_WITHDRAWN');
  const v2=src();v2.templates['appointment.staff-notice@2']=structuredClone(v2.templates['appointment.staff-notice@1']);v2.templates['appointment.staff-notice@2'].template.version=2;
  const stale={...structuredClone(cfg),template:{...cfg.template,version:2}};
  assert.equal(await code(()=>m.validateNotificationConfiguration(stale,v2)),'STALE_TEMPLATE','a different version has a different digest');
  const same=src();same.templates['appointment.staff-notice@1'].template.subject[0]={text:'Edited '};
  assert.equal(await code(()=>m.validateNotificationConfiguration(structuredClone(cfg),same)),'STALE_TEMPLATE','a template edit makes every old pin stale');
  // A valid configuration over a planned template reports it as planned so the later admission step can refuse it.
  assert.equal((await m.validateNotificationConfiguration(structuredClone(cfg))).readiness,'planned');
  // The catalog validator accepts planned entries and does not change them.
  assert.equal(Object.values((await m.validateNotificationCatalog(src())).templates).filter(e=>e.readiness==='planned').length,2);
 });

 await test('async validators copy caller-owned inputs before awaiting and never read accessors',async()=>{
  const [staff]=standard(),original=structuredClone(staff);
  // Mutating the configuration immediately after the call cannot change what was validated.
  const cfg=structuredClone(staff);
  const pending=m.validateNotificationConfiguration(cfg);
  cfg.values.businessName='Evil\r\nBcc: a@example.test';cfg.sender='attacker';cfg.limits.perRecipientHour=99;cfg.template.digest='0'.repeat(64);cfg.recipientScope='submitter';
  const result=await pending;
  assert.equal(result.configurationDigest,ref.digest(original));assert.equal(result.sender.address,'notify@whumpo.com');
  // The other direction: a valid configuration spoiled after the call is still the one that was checked, and an invalid one fixed afterwards is still invalid.
  const bad=structuredClone(staff);bad.values.businessName='mail a@example.test';
  const rejected=m.validateNotificationConfiguration(bad);bad.values.businessName='Shine';
  assert.equal(await code(()=>rejected),'CONFIG_URL');
  // Mutating a custom catalog or a template after the call has no effect either.
  const catalog=src(),catalogPending=m.validateNotificationConfiguration(structuredClone(staff),catalog);
  catalog.templates['appointment.staff-notice@1'].template.subject[0]={text:'Hijacked '};catalog.senders['whumpo-notify'].state='unverified';
  assert.equal((await catalogPending).configurationDigest,ref.digest(original));
  const c=src(),validated=m.validateNotificationCatalog(c);
  c.templates['contact.new-message@1'].template.body[0]={text:'tampered'};c.providers['cloudflare-email'].ceiling.callsPer32Days=1e9;
  const out=await validated;
  assert.deepEqual(out,m.notificationCatalog);assert.notEqual(out,c);assert.ok(walk(out).every(Object.isFrozen),'the validated copy is frozen');
  const t=structuredClone(m.notificationCatalog.templates['contact.new-message@1'].template),digestPending=m.templateDigest(t);
  t.subject[0]={text:'tampered'};
  assert.equal(await digestPending,m.notificationCatalog.templates['contact.new-message@1'].digest);
  // validateNotificationTemplate returns a private frozen copy.
  const input=structuredClone(m.notificationCatalog.templates['contact.new-message@1'].template),copy=m.validateNotificationTemplate(input);
  input.subject[0]={text:'tampered'};assert.equal(copy.subject[0].text,'New contact-form message in Whumpo');assert.ok(walk(copy).every(Object.isFrozen));
  // Accessors and toJSON hooks are never invoked, before or after an await.
  let reads=0;
  const getter=structuredClone(staff);Object.defineProperty(getter,'sender',{get(){reads++;return 'whumpo-notify';},enumerable:true});
  assert.equal(await code(()=>m.validateNotificationConfiguration(getter)),'INVALID_SHAPE');assert.equal(reads,0,'configuration getter');
  const getterCatalog=src();Object.defineProperty(getterCatalog.senders['whumpo-notify'],'state',{get(){reads++;return 'verified';},enumerable:true});
  assert.equal(await code(()=>m.validateNotificationConfiguration(structuredClone(staff),getterCatalog)),'INVALID_SHAPE');assert.equal(reads,0,'catalog getter');
  const getterValues={};Object.defineProperty(getterValues,'businessName',{get(){reads++;return 'Shine';},enumerable:true});
  assert.equal(await code(()=>m.renderNotificationTemplate(m.notificationCatalog.templates['appointment.staff-notice@1'].template,getterValues)),'INVALID_SHAPE');assert.equal(reads,0,'render getter');
  const hooked=structuredClone(staff);hooked.values={businessName:'Shine',toJSON(){reads++;return {};}};
  await code(()=>m.validateNotificationConfiguration(hooked));assert.equal(reads,0,'toJSON hook');
  // Repeated validation of the same input is idempotent.
  const again=await m.validateNotificationConfiguration(structuredClone(staff));assert.equal(again.configurationDigest,result.configurationDigest);
 });
 return count;
}

let total=0;
const checkOnce=async(name,fn)=>{try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}};
const real=await load(catalogEntry);
total+=await suite(real);

// ---------- Contact notices through the catalog (read-only agreement with the WH-036 runtime) ----------
let rt;
await checkOnce('bundle the contact runtime together with the catalog',async()=>{
 rt=await load("export * from './src/notification-catalog';export {contactEmailMessage,cloudflareEmailOutcome,cloudflareEmailSender,contactNotificationSender,cloudflareEmailProvider} from './src/contact-email';export {implementedContactNotificationProviders,maxContactDeliveryAttempts,contactMonthlyCeilingCents} from './src/contact-notifications';");
});
await checkOnce('contact new-message and verification notices are byte-identical to their historical text',()=>{
 const base={outboxId:'o',idempotencyKey:'k',projectId:'p',recipient:'owner@example.test'};
 const message=rt.contactEmailMessage({...base,kind:'new_message'}),verification=rt.contactEmailMessage({...base,kind:'verification',verificationCode:'ABCD2345'});
 assert.deepEqual(message,GOLDEN_NEW_MESSAGE);assert.deepEqual(verification,GOLDEN_VERIFICATION);
 assert.deepEqual(Object.keys(message),['subject','text']);assert.deepEqual(Object.keys(verification),['subject','text']);
 assert.equal(Buffer.from(message.text).toString('hex'),Buffer.from(GOLDEN_NEW_MESSAGE.text).toString('hex'));
 assert.equal(Buffer.from(verification.subject+verification.text).toString('hex'),Buffer.from(GOLDEN_VERIFICATION.subject+GOLDEN_VERIFICATION.text).toString('hex'));
 assert.deepEqual(rt.contactEmailMessage({...base,kind:'verification',verificationCode:'ZZZZ9999'}).text,GOLDEN_VERIFICATION.text.replace('ABCD2345','ZZZZ9999'));
 // The new-message notice never carries a code, even if the notice object has one (the type forbids it, the renderer ignores it).
 assert.deepEqual(rt.contactEmailMessage({...base,kind:'new_message',verificationCode:'ABCD2345'}),GOLDEN_NEW_MESSAGE);
 // The same text comes from the reference.
 assert.deepEqual(message,ref.render(ref.notificationCatalog.templates['contact.new-message@1'].template,{}));
 assert.deepEqual(verification,ref.render(ref.notificationCatalog.templates['owner.destination-verification@1'].template,{code:'ABCD2345'}));
 for(const bad of [undefined,'','bad code','abcd2345','ABCD234','ABCD23456',null,5,['ABCD2345'],{}])
  assert.throws(()=>rt.contactEmailMessage({...base,kind:'verification',verificationCode:bad}),e=>e.message==='Invalid verification notice'&&e.code===undefined,String(bad));
 // The caller contract is unchanged: synchronous, and both notice kinds render without any await.
 assert.ok(!(rt.contactEmailMessage({...base,kind:'new_message'}) instanceof Promise));
});
await checkOnce('contact sender, ceiling and provider error classification are exactly the WH-036 behavior',async()=>{
 const p=rt.notificationCatalog.providers['cloudflare-email'];
 assert.equal(rt.contactNotificationSender,'notify@whumpo.com');assert.equal(rt.contactNotificationSender,rt.notificationCatalog.senders['whumpo-notify'].address);
 assert.equal(rt.implementedContactNotificationProviders['cloudflare-email'].sendCeiling,14285);
 assert.equal(rt.implementedContactNotificationProviders['cloudflare-email'].sendCeiling,p.ceiling.callsPer32Days);
 assert.equal(Math.floor(rt.contactMonthlyCeilingCents*10000/p.price.microsPerCall),p.ceiling.callsPer32Days,'the $5 owner ceiling at the catalog price');
 assert.ok(Object.isFrozen(rt.implementedContactNotificationProviders)&&Object.isFrozen(rt.implementedContactNotificationProviders['cloudflare-email']));
 assert.deepEqual(Object.keys(rt.implementedContactNotificationProviders),['cloudflare-email']);
 assert.equal(rt.maxContactDeliveryAttempts,rt.notificationBounds.maxAttempts);
 // Historical reviewed facts, unchanged and not newly verified: this slice adds no provider, price, review or activation.
 assert.deepEqual(p.review,{reference:'issue-146-2026-10-04',reviewedAt:'2026-10-04'});
 assert.deepEqual(p.price,{basis:'metered',currency:'USD',microsPerCall:350,includedPerMonth:3000,checkedAt:'2026-10-08',entitlement:'requires-verification'});
 assert.deepEqual([p.idempotency,p.events,p.lookup,p.readiness],['none','not-configured','none','source']);
 assert.deepEqual(Object.keys(rt.notificationCatalog.providers),['cloudflare-email']);assert.deepEqual(Object.keys(rt.notificationCatalog.senders),['whumpo-notify']);
 assert.deepEqual(rt.notificationCatalog.senders['whumpo-notify'],{address:'notify@whumpo.com',displayName:'Whumpo',provider:'cloudflare-email',domainOwner:'platform',state:'verified',dnsReview:'2026-10-04-whumpo-com-email-sending'});
 const expected={suppressed:{accepted:false,retryable:false,suppressed:true},notTaken:{accepted:false,retryable:true},rejected:{accepted:false,retryable:false}};
 for(const [kind,codes] of Object.entries(HISTORICAL))for(const c of codes)assert.deepEqual(rt.cloudflareEmailOutcome(Object.assign(Error('PRIVATE'),{code:c})),expected[kind],c);
 const uncertain={accepted:false,retryable:false,uncertain:true};
 for(const cause of [Object.assign(Error('x'),{code:'E_INTERNAL_SERVER_ERROR'}),Object.assign(Error('x'),{code:'E_NOT_DOCUMENTED'}),Object.assign(Error('x'),{code:'constructor'}),Object.assign(Error('x'),{code:'__proto__'}),Object.assign(Error('x'),{code:5}),new TypeError('network'),new Error('timeout'),null,undefined,'E_RATE_LIMIT_EXCEEDED',{},{code:''}])
  assert.deepEqual(rt.cloudflareEmailOutcome(cause),uncertain,String(cause?.code??cause));
 // The adapter message: fixed sender from the catalog, the only header is the notice ID, no Reply-To/Cc/Bcc/HTML.
 const sent=[],send=rt.cloudflareEmailSender({send:async message=>{sent.push(message);return {messageId:'cf-1'};}});
 const outcome=await send({outboxId:'notice-1',idempotencyKey:'k',kind:'new_message',projectId:'p',recipient:'owner@example.test'},{provider:'cloudflare-email',review:'r',sendCeiling:1});
 assert.deepEqual(outcome,{accepted:true,providerRef:'cf-1'});
 assert.deepEqual(Object.keys(sent[0]).sort(),['from','headers','subject','text','to']);
 assert.deepEqual(sent[0].from,{email:'notify@whumpo.com',name:'Whumpo'});assert.deepEqual(sent[0].headers,{'X-Whumpo-Notice-Id':'notice-1'});
 assert.equal(sent[0].subject,GOLDEN_NEW_MESSAGE.subject);assert.equal(sent[0].text,GOLDEN_NEW_MESSAGE.text);assert.equal(sent[0].to,'owner@example.test');
});
await checkOnce('the catalog and contact modules cannot reach inference, node builtins, the offline reference or a network call',async()=>{
 const inference=/^src\/(ai|ai-chat|ai-gateway|acknowledgment|site-agent|agent-[a-z-]+|standard-ai[a-z-]*|chat|backend-chat|app-upgrade-chat|app-recovery-chat|app-page-design)\.ts$|^src\/chat-interactions\/(agent|agent-request|model-continuation|continuation)\.ts$/;
 for(const entry of ['src/notification-catalog.ts','src/contact-email.ts','src/contact-notifications.ts']){
  const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'neutral',write:false,metafile:true,logLevel:'silent'});
  const inputs=Object.keys(out.metafile.inputs);assert.ok(inputs.length>0);
  assert.deepEqual(inputs.filter(p=>inference.test(p)),[],entry);
  assert.deepEqual(inputs.filter(p=>!p.startsWith('src/')),[],`${entry} imports outside src`);
  assert.ok(!inputs.some(p=>p.includes('prototypes')||p.includes('tests/')),entry);
  for(const name of ['AI_GATEWAY','OPENAI','ANTHROPIC','sendAIChat','agentPrompt','node:crypto','process.env','XMLHttpRequest'])assert.ok(!out.outputFiles[0].text.includes(name),`${entry} references ${name}`);
  assert.ok(!/\bfetch\s*\(/.test(out.outputFiles[0].text),`${entry} performs a network call`);
 }
 const bundle=await build({entryPoints:['src/notification-catalog.ts'],bundle:true,format:'esm',platform:'neutral',write:false,metafile:true,logLevel:'silent'});
 assert.deepEqual(Object.keys(bundle.metafile.inputs).sort(),['src/notification-catalog.ts','src/project-specification/v2/json.ts']);
 const specifiers=[...catalogText.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
 assert.deepEqual(specifiers,['./project-specification/v2/json']);
 // No Worker source imports the offline reference or its harness.
 const files=dir=>readdirSync(dir).flatMap(f=>{const p=join(dir,f);return statSync(p).isDirectory()?files(p):/\.(ts|tsx|mjs)$/.test(f)?[p]:[];});
 for(const file of files('src'))for(const x of readFileSync(file,'utf8').matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g))assert.ok(!/prototypes|tests\/|\.mjs$/.test(x[1]??x[2]),`${file} imports ${x[1]??x[2]}`);
});

// ---------- Mutants: deliberately broken copies of the source, each caught by the check written for its property ----------
const mutants=[
 ['registries are no longer deeply frozen',"if(value&&typeof value==='object'&&!Object.isFrozen(value)){","if(false){",'registries and the catalog are deeply frozen'],
 ['only a shallow freeze',"Object.freeze(value);for(const member of Object.values(value))deepFreeze(member);","Object.freeze(value);",'registries and the catalog are deeply frozen'],
 ['pinned digest not enforced in the catalog',"check(actual[i]===digest,'DIGEST_MISMATCH'","check(true,'DIGEST_MISMATCH'",'source validators are stricter'],
 ['digest is not of the canonical text',"{return jsonDigest(templateValue);}","{return jsonDigest(JSON.stringify(templateValue).length);}",'templates, senders, providers'],
 ['relay keys allowed',"check(!relayKeys.includes(key.toLowerCase()),'OPEN_RELAY'","check(true,'OPEN_RELAY'",'template and catalog validators'],
 ['template language allowed',"check(!/\\{\\{|\\}\\}|\\$\\{/.test(s.text),'TEMPLATE_SYNTAX',at);","",'template and catalog validators'],
 ['record values allowed in owner/staff notices',"if(variable.source==='record')check(","if(false)check(",'template and catalog validators'],
 ['links allowed in the subject',"check(multiline&&typeof s.link==='string'","check(typeof s.link==='string'",'template and catalog validators'],
 ['stale pin accepted',"check(cfg.template.digest===pinned,'STALE_TEMPLATE'","check(true,'STALE_TEMPLATE'",'configuration validator agrees'],
 ['withdrawn template configurable',"check(entry.state==='available','TEMPLATE_WITHDRAWN','configuration.template');","",'configuration validator agrees'],
 ['unbounded provider charge accepted',"check(provider.ceiling,'UNBOUNDED_CHARGE','configuration.sender');","",'configuration validator agrees'],
 ['urls allowed in configuration text',"check(!urlOrAddress(v),'CONFIG_URL'","check(true,'CONFIG_URL'",'configuration validator agrees'],
 ['sender looked up through the prototype chain',"Object.hasOwn(catalog.senders,cfg.sender),'UNKNOWN_SENDER'","cfg.sender in catalog.senders,'UNKNOWN_SENDER'",'no configuration, template or caller value'],
 ['unknown render values ignored',"check(Object.keys(values).every(name=>Object.hasOwn(t.variables,name)),'UNKNOWN_FIELD','render.values');","",'no configuration, template or caller value'],
 ['control characters allowed in text-line values',"v.length<=80&&lineSafe(v)&&!/[<>]/.test(v)","v.length<=80&&!/[<>]/.test(v)",'renderer agrees'],
 ['markup allowed in text-line values',"&&!/[<>]/.test(v)&&!urlOrAddress(v)","&&!urlOrAddress(v)",'configuration validator agrees'],
 ['planned templates renderable',"check(renderableReadiness.includes(entry.readiness),'TEMPLATE_NOT_IMPLEMENTED','render.template');","",'planned, withdrawn and unknown'],
 ['withdrawn templates renderable',"check(entry.state==='available','TEMPLATE_WITHDRAWN','render.template');","",'planned, withdrawn and unknown'],
 ['configuration not copied before the first await',"const cfg=snapshot(input,'configuration'),catalog","const cfg=input,catalog",'async validators copy'],
 ['accessors read instead of refused',"try{return copyJSON(value,maxBytes);}","try{return value;}",'source validators are stricter'],
 ['suppression no longer classified',"if(e.suppressed.includes(code))return 'suppressed';","",'templates, senders, providers'],
];
const textOf=(find,replace)=>{
 assert.equal(catalogText.split(find).length,2,`mutant text must match the source exactly once: ${find}`);
 return catalogText.replace(find,()=>replace);
};
let killed=0;
for(const [name,find,replace,by] of mutants){
 const broken=await load(catalogEntry,textOf(find,replace));
 await assert.rejects(suite(broken),e=>{
  assert.ok(e.message.startsWith(by),`mutant "${name}" was caught by an unexpected check: ${e.message}`);return true;
 },`mutant survived: ${name}`);killed++;
}
assert.equal(killed,mutants.length);
console.log(`notifications-source: ${total} checks passed against src/notification-catalog.ts and the contact runtime; ${killed}/${mutants.length} mutants caught (synthetic values only; no database, network, credential, provider or model).`);
