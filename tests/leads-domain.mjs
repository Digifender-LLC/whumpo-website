import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

// WH-093 pure lead domain core (docs/business-leads.md). The actual TypeScript module is bundled and called directly: no
// database, route, clock, timezone, network or model. Every value is synthetic. This is the shared core for later
// handlers; it is not evidence for the WH-093 acceptance criteria (tenancy, atomicity, export, browser journey).
const bundle=await build({stdin:{contents:"export * from './src/shared-modules/leads-domain.ts';export {ModuleError} from './src/shared-modules/policy.ts';",resolveDir:process.cwd(),loader:'ts'},
 bundle:true,platform:'node',format:'esm',write:false,metafile:true,logLevel:'silent'});
const d=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {ModuleError}=d;
let cases=0;const check=(name,fn)=>{try{fn();cases++;}catch(error){console.error(name);console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exit(1);}};
const uid=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
const MARK='SECRET-NOTE-MARKER-9f3',DATE_MARK='1999-13-45-MARK';
/** Asserts a refusal with the expected frozen code, its fixed message, and no echo of any submitted marker. */
function refuse(fn,code,label=code){
 try{fn();}catch(error){
  assert.ok(error instanceof ModuleError,`${label}: ${error}`);assert.equal(error.code,code,label);
  assert.equal(error.message,new ModuleError(code).message,label);
  for(const m of [MARK,DATE_MARK,'secret'])assert.ok(!JSON.stringify(error.body()).includes(m),label);
  return;
 }
 assert.fail(`${label}: expected ${code}`);
}
const apply=(state,changes,over={})=>d.applyLeadChanges(state,changes,{expectedRevision:state.revision,now:1000,noteId:null,...over});
const json=v=>JSON.stringify(v);

check('source and bundle boundaries',()=>{
 const inputs=Object.keys(bundle.metafile.inputs).filter(p=>p!=='<stdin>').sort();
 assert.deepEqual(inputs,['src/project-specification/v2/json.ts','src/shared-modules/leads-domain.ts','src/shared-modules/policy.ts']);
 const text=bundle.outputFiles[0].text;
 for(const word of ['fetch(','XMLHttpRequest','crypto.subtle','D1Database','prepare(','AI_GATEWAY','OPENAI','ANTHROPIC','agentPrompt'])assert.ok(!text.includes(word),word);
});
const source=await readFile('src/shared-modules/leads-domain.ts','utf8');
check('no clock, zone, randomness, async or storage in source',()=>{
 const code=source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm,'');
 for(const token of ['Date','Intl','fetch','await','async','Promise','setTimeout','Math.random','crypto','process','globalThis','localStorage','prepare','D1'])assert.ok(!new RegExp(`\\b${token.replace('.','\\.')}\\b`).test(code),token);
 for(const [name,value] of Object.entries(d))if(typeof value==='function')assert.notEqual(value.constructor.name,'AsyncFunction',name);
 assert.equal(source.includes('records.ts'),false);
});
check('registries are immutable and current-only',()=>{
 assert.deepEqual([...d.leadStages],['new','contacted','qualified','won','lost']);
 assert.deepEqual([...d.activeLeadStages],['new','contacted','qualified']);
 for(const registry of [d.leadStages,d.activeLeadStages,d.leadLimits,d.leadChangeBits,d.emptyLeadState,d.emptyLeadState.notes]){
  assert.ok(Object.isFrozen(registry));assert.throws(()=>{registry.extra=1;},TypeError);
 }
 assert.throws(()=>d.leadStages.push('legacy'),TypeError);
 assert.deepEqual({...d.leadLimits},{notes:20,noteCodePoints:1000,notesJsonBytes:16384,filterStages:5,requestJsonBytes:8192});
 // No revision cap is invented here: the 200-revision figure is an unapproved storage proposal.
 assert.ok(!('revisions' in d.leadLimits)&&!('maxRevision' in d.leadLimits));
 assert.equal(d.emptyLeadState.revision,0);
});

check('leap years and civil date validity',()=>{
 for(const [year,leap] of [[1,false],[4,true],[100,false],[400,true],[1900,false],[2000,true],[2024,true],[2026,false],[2028,true],[2100,false],[2400,true],[9996,true],[9999,false]])assert.equal(d.isLeapYear(year),leap,String(year));
 for(const date of ['2028-02-29','2000-02-29','2400-02-29','0004-02-29','0001-01-01','9999-12-31','2026-12-31','2026-04-30','2026-01-31'])assert.ok(d.isCivilDate(date),date);
 for(const date of ['2026-02-29','2100-02-29','1900-02-29','0100-02-29','2026-02-30','2026-04-31','2026-13-01','2026-00-10','2026-10-00','2026-1-01','2026-01-1','26-01-01','0000-01-01','0000-12-31','10000-01-01',
  '2026-10-08T10:00','2026-10-08 ','2026-10-08\n',' 2026-10-08','2026/10/08','20261008','２０２６-10-08','٢٠٢٦-١٠-٠٨','2026-10-08Z','+2026-10-08','-0001-01-01',''])assert.ok(!d.isCivilDate(date),JSON.stringify(date));
 for(const value of [null,undefined,20261008,{},[],['2026-10-08'],new String('2026-10-08'),new Date(0),true,{toString:()=> '2026-10-08'}])assert.ok(!d.isCivilDate(value),String(value));
 assert.deepEqual(d.parseCivilDate('2028-02-29'),{year:2028,month:2,day:29});
 assert.equal(d.parseCivilDate('2026-02-29'),null);
 // An impossible date is rejected, never normalized to the next valid one.
 assert.equal(d.parseCivilDate('2026-02-30'),null);assert.equal(d.parseCivilDate('2026-04-31'),null);
});
check('civil day arithmetic agrees with an independent oracle and has no zone input',()=>{
 const start=d.civilDayNumber('0001-01-01'),end=d.civilDayNumber('9999-12-31');
 assert.equal(d.civilDayNumber('1970-01-01'),0);assert.equal(end-start+1,3652059);
 const edgeYears=new Set([1,2,3,4,5,99,100,101,399,400,401,1582,1600,1899,1900,1901,1969,1970,1971,1999,2000,2001,2023,2024,2025,2026,2027,2028,2029,2100,2399,2400,9996,9997,9998,9999]);
 const verify=n=>{
  const iso=new Date(n*86400000).toISOString().slice(0,10); // oracle only; the module never uses Date
  assert.equal(d.addCivilDays('1970-01-01',n),iso,iso);assert.equal(d.civilDayNumber(iso),n,iso);assert.ok(d.isCivilDate(iso),iso);
 };
 for(let n=start;n<=end;n+=997)verify(n);
 for(const year of edgeYears){const first=d.civilDayNumber(`${String(year).padStart(4,'0')}-01-01`);for(let n=first;n<first+366&&n<=end;n++)verify(n);}
 assert.equal(d.addCivilDays('9999-12-31',1),null);assert.equal(d.addCivilDays('0001-01-01',-1),null);
 assert.equal(d.addCivilDays('9999-12-31',0),'9999-12-31');assert.equal(d.addCivilDays('0001-01-01',0),'0001-01-01');
 assert.equal(d.addCivilDays('2028-02-28',1),'2028-02-29');assert.equal(d.addCivilDays('2028-02-29',1),'2028-03-01');
 assert.equal(d.addCivilDays('2026-02-28',1),'2026-03-01');assert.equal(d.addCivilDays('2026-12-31',1),'2027-01-01');
 assert.equal(d.addCivilDays('2026-10-08',-8),'2026-09-30');assert.equal(d.addCivilDays('2026-10-08',6),'2026-10-14');
 refuse(()=>d.civilDayNumber('2026-02-29'),'invalid_request');refuse(()=>d.addCivilDays('2026-10-08',1.5),'invalid_request');refuse(()=>d.addCivilDays('bad',1),'invalid_request');
});

check('due buckets use only the caller reference date and are independent of the process timezone',()=>{
 const battery=()=>{
  const out=[];
  for(const ref of ['2026-03-08','2026-11-01','2026-03-29','2026-10-25','2028-02-29','2026-12-31','9999-12-31','0001-01-01'])
   for(const due of [null,'0001-01-01','2026-02-28','2026-03-07','2026-03-08','2026-03-09','2026-03-14','2026-03-15','2026-11-01','2026-11-07','2026-11-08','2028-02-28','2028-02-29','2028-03-06','2028-03-07','2027-01-01','9999-12-31'])
    for(const stage of d.leadStages)out.push(d.leadDueBucket({stage,dueOn:due},ref));
  return out;
 };
 const baseline=battery(),original=process.env.TZ;
 try{for(const tz of ['UTC','America/New_York','Europe/London','Pacific/Kiritimati','Pacific/Pago_Pago','Australia/Lord_Howe','Asia/Kolkata']){process.env.TZ=tz;assert.deepEqual(battery(),baseline,tz);}}
 finally{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;}
 const lead=(stage,dueOn)=>({stage,dueOn});
 assert.equal(d.leadDueBucket(lead('new',null),'2026-10-08'),'none');
 assert.equal(d.leadDueBucket(lead('won',null),'2026-10-08'),'none');
 assert.equal(d.leadDueBucket(lead('contacted','2026-10-07'),'2026-10-08'),'overdue');
 assert.equal(d.leadDueBucket(lead('qualified','2026-10-08'),'2026-10-08'),'today');
 assert.equal(d.leadDueBucket(lead('new','2026-10-09'),'2026-10-08'),'week');
 assert.equal(d.leadDueBucket(lead('new','2026-10-14'),'2026-10-08'),'week');
 assert.equal(d.leadDueBucket(lead('new','2026-10-15'),'2026-10-08'),'later');
 for(const stage of ['won','lost'])for(const due of ['2020-01-01','2026-10-08','2026-10-09','2030-01-01'])assert.equal(d.leadDueBucket(lead(stage,due),'2026-10-08'),'inactive');
 assert.equal(d.leadDueBucket(lead('new','2028-02-28'),'2028-02-27'),'week');
 assert.equal(d.leadDueBucket(lead('new','2027-01-02'),'2026-12-27'),'week');assert.equal(d.leadDueBucket(lead('new','2027-01-03'),'2026-12-27'),'later');
 assert.equal(d.isLeadOverdue(lead('new','2026-10-07'),'2026-10-08'),true);assert.equal(d.isLeadOverdue(lead('lost','2026-10-07'),'2026-10-08'),false);assert.equal(d.isLeadOverdue(lead('new','2026-10-08'),'2026-10-08'),false);
 // A reference date is required and must be a real civil date; there is no default and no instant is accepted.
 for(const bad of [undefined,null,'2026-02-29','2026-10-08T00:00:00Z',Date.UTC(2026,9,8),new Date(0)])refuse(()=>d.leadDueBucket(lead('new','2026-10-08'),bad),'invalid_request');
 assert.equal(d.leadDueBucket.length,2);
});

check('note text bounds, control characters and unicode',()=>{
 const ok=t=>assert.equal(d.leadNoteText(t),t);
 ok('a');ok('x'.repeat(1000));ok('line one\nline two\r\n\ttabbed');ok(' leading and trailing spaces kept ');ok('😀'.repeat(1000));ok('é'.repeat(1000));ok('é'.repeat(500));
 ok('é');ok('é'); // NFC and NFD stay exactly as written
 assert.notEqual(d.leadNoteText('é'),d.leadNoteText('é'));
 ok('日本語のメモ');ok('\u0085 next line char (C1 allowed, same class as record values)');ok('a\u2028\u2029b');
 for(const bad of ['','   ','\n\t\r ',' 　'.repeat(2)])refuse(()=>d.leadNoteText(bad),'invalid_request');
 refuse(()=>d.leadNoteText('x'.repeat(1001)),'invalid_request');refuse(()=>d.leadNoteText('😀'.repeat(1001)),'invalid_request');refuse(()=>d.leadNoteText('é'.repeat(2001)),'invalid_request');
 for(const code of [0,1,7,8,11,12,14,31,127])refuse(()=>d.leadNoteText(`a${String.fromCharCode(code)}b${MARK}`),'invalid_request');
 for(const lone of ['\ud800','\udbff','\udc00','\udfff','a\ud83d','\ude00b','\ud83d😀'])refuse(()=>d.leadNoteText(lone+MARK),'invalid_request');
 for(const bad of [null,undefined,1,true,{},['a'],new String('a'),Symbol('a'),10n])refuse(()=>d.leadNoteText(bad),'invalid_request');
});

const noteState=(count,text='n')=>{
 let state=d.emptyLeadState;
 for(let i=0;i<count;i++)state=apply(state,{note:{op:'add',text:`${text}${i}`}},{noteId:uid(i+1),now:1000+i}).state;
 return state;
};

check('state validation is strict and returns inert frozen copies',()=>{
 const state=noteState(2);
 const copy=d.leadState(JSON.parse(json(state)));
 assert.deepEqual(copy,state);assert.notEqual(copy,state);assert.ok(Object.isFrozen(copy)&&Object.isFrozen(copy.notes)&&copy.notes.every(Object.isFrozen));
 assert.equal(d.leadState(d.emptyLeadState),d.emptyLeadState);assert.equal(d.leadState(JSON.parse(json(d.emptyLeadState))),d.emptyLeadState);
 const base={stage:'contacted',stageChangedAt:50,dueOn:'2026-10-08',notes:[],revision:3,updatedAt:60};
 assert.deepEqual(d.leadState(base).stage,'contacted');
 const bads={
  missing:{...base,dueOn:undefined},extra:{...base,extra:1},stage:{...base,stage:'closed'},stageCase:{...base,stage:'Won'},stageCoerced:{...base,stage:1},date:{...base,dueOn:'2026-02-29'},dateCoerced:{...base,dueOn:20261008},
  revisionString:{...base,revision:'3'},revisionFloat:{...base,revision:1.5},revisionNegative:{...base,revision:-1},revisionHuge:{...base,revision:2**60},
  updatedZero:{...base,updatedAt:0},updatedNull:{...base,updatedAt:null},changedLater:{...base,stageChangedAt:61},changedNullNotNew:{...base,stageChangedAt:null},
  empty0:{...base,revision:0},zeroWithNotes:{stage:'new',stageChangedAt:null,dueOn:null,notes:[{id:uid(1),text:'x',createdAt:1,updatedAt:1}],revision:0,updatedAt:null},
  noteLater:{...base,notes:[{id:uid(1),text:'x',createdAt:61,updatedAt:61}]},noteBackwards:{...base,notes:[{id:uid(1),text:'x',createdAt:10,updatedAt:9}]},
  noteDup:{...base,notes:[{id:uid(1),text:'x',createdAt:1,updatedAt:1},{id:uid(1),text:'y',createdAt:1,updatedAt:1}]},noteExtra:{...base,notes:[{id:uid(1),text:'x',createdAt:1,updatedAt:1,by:'owner'}]},
  noteId:{...base,notes:[{id:'NOT-A-UUID',text:'x',createdAt:1,updatedAt:1}]},noteBlank:{...base,notes:[{id:uid(1),text:' ',createdAt:1,updatedAt:1}]},
  tooMany:{...base,notes:Array.from({length:21},(_,i)=>({id:uid(i+1),text:'x',createdAt:1,updatedAt:1}))},tooBig:{...base,notes:Array.from({length:17},(_,i)=>({id:uid(i+1),text:'x'.repeat(1000),createdAt:1,updatedAt:1}))},
  notesObject:{...base,notes:{}},notesNull:{...base,notes:null},
 };
 for(const [name,value] of Object.entries(bads))refuse(()=>d.leadState(value),'invalid_request',name);
 for(const bad of [null,undefined,[],'state',1,new Map(),()=>base])refuse(()=>d.leadState(bad),'invalid_request');
});

/** Hostile inputs that a permissive reader would accept, coerce or execute. */
function hostile(valid){
 const getter={};Object.defineProperty(getter,'changes',{enumerable:true,get(){throw Error('getter ran');}});
 const nested={changes:{}};Object.defineProperty(nested.changes,'stage',{enumerable:true,get(){throw Error('getter ran');}});
 const hidden={changes:{stage:'won'}};Object.defineProperty(hidden,'extra',{enumerable:false,value:1});
 const symbol={changes:{stage:'won'},[Symbol('s')]:1};
 class Changes{constructor(){this.changes={stage:'won'};}}
 const proto=Object.create({changes:{stage:'won'}});
 const toJSON={changes:{stage:'won'},toJSON(){throw Error('toJSON ran');}};
 const cyclic={changes:{}};cyclic.changes.self=cyclic;
 let deep={stage:'won'};for(let i=0;i<40;i++)deep={x:deep};
 return {getter,nested,hidden,symbol,class:new Changes(),proto,toJSON,cyclic,deep:{changes:deep},
  nan:{changes:{dueOn:NaN}},inf:{changes:{stage:Infinity}},undef:{changes:{stage:undefined}},bigint:{changes:{stage:1n}},fn:{changes:{stage:()=>'won'}},date:{changes:{dueOn:new Date(0)}},map:{changes:new Map([['stage','won']])},
  array:[{stage:'won'}],string:'{"changes":{"stage":"won"}}',nullInput:null,undefinedInput:undefined,num:7,
  ...valid};
}
check('update parsing accepts only the exact current shapes',()=>{
 const good=(changes)=>d.parseLeadUpdate({changes});
 assert.deepEqual(good({stage:'won'}).changes,{stage:'won'});
 assert.deepEqual(good({dueOn:null}).changes,{dueOn:null});assert.deepEqual(good({dueOn:'2028-02-29'}).changes,{dueOn:'2028-02-29'});
 assert.deepEqual(good({note:{op:'add',text:'hi'}}).changes,{note:{op:'add',text:'hi'}});
 assert.deepEqual(good({note:{op:'edit',noteId:uid(1),text:'hi'}}).changes.note.op,'edit');assert.deepEqual(good({note:{op:'remove',noteId:uid(1)}}).changes.note,{op:'remove',noteId:uid(1)});
 assert.deepEqual(good({stage:'contacted',dueOn:'2026-10-08',note:{op:'add',text:'x'}}).changes,{stage:'contacted',dueOn:'2026-10-08',note:{op:'add',text:'x'}});
 assert.deepEqual(d.parseLeadUpdate(Object.assign(Object.create(null),{changes:Object.assign(Object.create(null),{stage:'lost'})})).changes,{stage:'lost'});
 for(const stage of d.leadStages)assert.equal(good({stage}).changes.stage,stage);
 assert.ok(Object.isFrozen(good({note:{op:'add',text:'x'}}).changes.note));
 const inputs={
  ...hostile({}),emptyChanges:{changes:{}},noChanges:{},changesNull:{changes:null},changesArray:{changes:[]},topExtra:{changes:{stage:'won'},revision:1},
  unknownChange:{changes:{owner:'x'}},legacyStatus:{changes:{status:'won'}},legacyDue:{changes:{due:'2026-10-08'}},legacyNotes:{changes:{notes:['x']}},extraWithValid:{changes:{stage:'won',priority:1}},
  protoKey:JSON.parse('{"changes":{"__proto__":{"stage":"won"}}}'),protoTop:JSON.parse('{"__proto__":{"x":1},"changes":{"stage":"won"}}'),constructorKey:JSON.parse('{"changes":{"constructor":{"x":1}}}'),
  stageUnknown:{changes:{stage:'closed'}},stageUpper:{changes:{stage:'WON'}},stageSpace:{changes:{stage:'won '}},stageNull:{changes:{stage:null}},stageNumber:{changes:{stage:2}},stageArray:{changes:{stage:['won']}},stageObject:{changes:{stage:{toString:()=> 'won'}}},stageProto:{changes:{stage:'__proto__'}},stageCtor:{changes:{stage:'constructor'}},
  dueMissing:{changes:{dueOn:undefined}},dueBad:{changes:{dueOn:'2026-02-29'}},dueTime:{changes:{dueOn:'2026-10-08T00:00:00Z'}},dueNumber:{changes:{dueOn:20261008}},dueEmpty:{changes:{dueOn:''}},dueMark:{changes:{dueOn:DATE_MARK}},dueFullWidth:{changes:{dueOn:'２０２６-10-08'}},dueFalse:{changes:{dueOn:false}},
  noteString:{changes:{note:'text'}},noteNull:{changes:{note:null}},noteArray:{changes:{note:[]}},noteNoOp:{changes:{note:{text:'x'}}},noteBadOp:{changes:{note:{op:'append',text:'x'}}},noteOpCase:{changes:{note:{op:'ADD',text:'x'}}},noteOpNumber:{changes:{note:{op:1,text:'x'}}},
  addId:{changes:{note:{op:'add',noteId:uid(1),text:'x'}}},addMissingText:{changes:{note:{op:'add'}}},addBlank:{changes:{note:{op:'add',text:'  '}}},addNumber:{changes:{note:{op:'add',text:5}}},addLong:{changes:{note:{op:'add',text:'x'.repeat(1001)}}},addControl:{changes:{note:{op:'add',text:`a\u0000${MARK}`}}},
  editMissingId:{changes:{note:{op:'edit',text:'x'}}},editBadId:{changes:{note:{op:'edit',noteId:'abc',text:'x'}}},editUpperId:{changes:{note:{op:'edit',noteId:uid(1).toUpperCase(),text:'x'}}},editMissingText:{changes:{note:{op:'edit',noteId:uid(1)}}},editExtra:{changes:{note:{op:'edit',noteId:uid(1),text:'x',more:1}}},
  removeText:{changes:{note:{op:'remove',noteId:uid(1),text:'x'}}},removeNoId:{changes:{note:{op:'remove'}}},removeNumber:{changes:{note:{op:'remove',noteId:1}}},
  oversize:{changes:{note:{op:'add',text:'x'.repeat(1000)},stage:'won',pad:'y'.repeat(9000)}},
 };
 for(const [name,value] of Object.entries(inputs))refuse(()=>d.parseLeadUpdate(value),'invalid_request',name);
 assert.ok(Object.keys(inputs).length>=70,String(Object.keys(inputs).length));
});

check('first write, no-effect, stale and clock rules',()=>{
 const first=apply(d.emptyLeadState,{stage:'contacted'},{now:2000});
 assert.deepEqual({...first.state,notes:[...first.state.notes]},{stage:'contacted',stageChangedAt:2000,dueOn:null,notes:[],revision:1,updatedAt:2000});
 assert.equal(first.mask,d.leadChangeBits.stage);assert.equal(first.noteId,null);
 // The same stage is not a change; a request that changes nothing is not a silent revision bump.
 refuse(()=>apply(d.emptyLeadState,{stage:'new'}),'invalid_request');refuse(()=>apply(first.state,{stage:'contacted'}),'invalid_request');
 refuse(()=>apply(d.emptyLeadState,{dueOn:null}),'invalid_request');refuse(()=>apply(first.state,{note:{op:'remove',noteId:uid(1)}}),'not_found');
 const dated=apply(first.state,{dueOn:'2026-10-08'},{now:2001});
 assert.equal(dated.state.stageChangedAt,2000,'a due date change keeps the stage time');assert.equal(dated.mask,d.leadChangeBits.dueOn);
 refuse(()=>apply(dated.state,{dueOn:'2026-10-08'}),'invalid_request');
 assert.equal(apply(dated.state,{dueOn:null},{now:2002}).state.dueOn,null);
 refuse(()=>apply(dated.state,{dueOn:'2026-02-29'}),'invalid_request');
 // Combined: only the effective parts count, and a repeated stage alongside a real change is accepted.
 const combo=apply(dated.state,{stage:'contacted',dueOn:'2026-11-01',note:{op:'add',text:'x'}},{noteId:uid(7),now:2003});
 assert.equal(combo.mask,d.leadChangeBits.dueOn|d.leadChangeBits.notes);assert.equal(combo.state.stageChangedAt,2000);assert.equal(combo.noteId,uid(7));
 assert.equal(apply(d.emptyLeadState,{stage:'won',dueOn:'2026-10-08',note:{op:'add',text:'x'}},{noteId:uid(8)}).mask,7);
 // Stale, wrong-type and unverifiable revisions are refused before anything else is applied.
 for(const expected of [0,1,3,5])refuse(()=>apply(dated.state,{stage:'won'},{expectedRevision:expected}),'stale_configuration',`rev ${expected}`);
 for(const expected of ['2',null,undefined,-1,1.5,NaN,2**60])refuse(()=>apply(dated.state,{stage:'won'},{expectedRevision:expected}),'invalid_request',String(expected));
 refuse(()=>apply(d.emptyLeadState,{stage:'won'},{expectedRevision:1}),'stale_configuration');
 // Stage can move freely among all five stages, including back to `new`.
 let state=d.emptyLeadState;for(const stage of ['lost','new','won','qualified','contacted','new']){state=apply(state,{stage},{now:3000+state.revision}).state;assert.equal(state.stage,stage);}
 assert.equal(state.revision,6);
 // Timestamps never move backwards, and `now` must be a positive safe integer.
 const later=apply(dated.state,{stage:'won'},{now:5});assert.equal(later.state.updatedAt,2001);assert.equal(later.state.stageChangedAt,2001);
 for(const now of [0,-1,1.5,'1000',null,undefined,NaN,Infinity,2**60])refuse(()=>apply(dated.state,{stage:'won'},{now}),'invalid_request',String(now));
 for(const context of [null,undefined,{expectedRevision:1},{expectedRevision:1,now:5},{expectedRevision:1,now:5,noteId:null,extra:1},{expectedRevision:1,now:5,noteId:'x'},{expectedRevision:1,now:5,noteId:uid(1).toUpperCase()}])
  refuse(()=>d.applyLeadChanges(dated.state,{stage:'won'},context),'invalid_request');
 // Changes are re-parsed, so unchecked callers cannot smuggle shapes past the parser.
 for(const changes of [{},{stage:'closed'},{owner:1},null,{note:{op:'add',text:MARK+'\u0000'}}])refuse(()=>apply(dated.state,changes),'invalid_request');
 // No revision cap is invented: 200 and beyond still advance; only the safe-integer ceiling stops.
 const high={stage:'new',stageChangedAt:null,dueOn:null,notes:[],revision:200,updatedAt:10};
 assert.equal(apply(high,{stage:'won'}).state.revision,201);
 refuse(()=>apply({...high,revision:Number.MAX_SAFE_INTEGER},{stage:'won'}),'limited');
});

check('note add, edit, remove and unknown ids',()=>{
 const one=apply(d.emptyLeadState,{note:{op:'add',text:`${MARK} first`}},{noteId:uid(1),now:100});
 assert.equal(one.noteId,uid(1));assert.deepEqual(one.state.notes,[{id:uid(1),text:`${MARK} first`,createdAt:100,updatedAt:100}]);assert.equal(one.state.stage,'new');assert.equal(one.state.stageChangedAt,null);
 refuse(()=>apply(one.state,{note:{op:'add',text:'dup'}},{noteId:uid(1)}),'invalid_request','duplicate id');refuse(()=>apply(one.state,{note:{op:'add',text:'x'}}),'invalid_request','missing id');
 const two=apply(one.state,{note:{op:'add',text:'second'}},{noteId:uid(2),now:200});
 assert.deepEqual(two.state.notes.map(n=>n.id),[uid(1),uid(2)]);
 const edited=apply(two.state,{note:{op:'edit',noteId:uid(1),text:'edited'}},{now:300});
 assert.deepEqual(edited.state.notes,[{id:uid(1),text:'edited',createdAt:100,updatedAt:300},{id:uid(2),text:'second',createdAt:200,updatedAt:200}]);assert.equal(edited.mask,d.leadChangeBits.notes);assert.equal(edited.noteId,null);
 refuse(()=>apply(edited.state,{note:{op:'edit',noteId:uid(1),text:'edited'}}),'invalid_request','same text is no effect');
 refuse(()=>apply(edited.state,{note:{op:'edit',noteId:uid(9),text:MARK}}),'not_found','unknown edit');refuse(()=>apply(edited.state,{note:{op:'remove',noteId:uid(9)}}),'not_found','unknown remove');
 const removed=apply(edited.state,{note:{op:'remove',noteId:uid(1)}},{now:400});
 assert.deepEqual(removed.state.notes.map(n=>n.id),[uid(2)]);refuse(()=>apply(removed.state,{note:{op:'remove',noteId:uid(1)}}),'not_found','already removed');refuse(()=>apply(removed.state,{note:{op:'edit',noteId:uid(1),text:'x'}}),'not_found','edit after remove');
 const empty=apply(removed.state,{note:{op:'remove',noteId:uid(2)}},{now:500});assert.deepEqual(empty.state.notes,[]);assert.equal(empty.state.revision,5);
 // Edit does not move created time even when the clock regresses, and updated time never precedes created time.
 const regress=apply(two.state,{note:{op:'edit',noteId:uid(2),text:'later'}},{now:1});assert.deepEqual(regress.state.notes[1],{id:uid(2),text:'later',createdAt:200,updatedAt:200});
 // The 21st note and the 16 KiB total both report `limited`; either way the state is untouched.
 const full=noteState(20);assert.equal(full.notes.length,20);
 refuse(()=>apply(full,{note:{op:'add',text:'21'}},{noteId:uid(99)}),'limited','21st note');
 assert.equal(apply(full,{note:{op:'remove',noteId:uid(3)}}).state.notes.length,19);
 assert.equal(apply(full,{note:{op:'edit',noteId:uid(3),text:'still fits'}}).state.notes.length,20);
 for(const text of ['x'.repeat(1000),'日'.repeat(1000),'😀'.repeat(1000)]){
  let state=d.emptyLeadState,added=0;
  for(;;){
   try{state=apply(state,{note:{op:'add',text}},{noteId:uid(added+1)}).state;added++;}
   catch(error){assert.equal(error.code,'limited');break;}
   assert.ok(Buffer.byteLength(d.leadNotesJson(state.notes))<=16384);
  }
  assert.ok(added>=4&&added<20,`${text.slice(0,1)} fit ${added} notes`);
  assert.ok(Buffer.byteLength(d.leadNotesJson(state.notes))<=16384);
  // One more fitting-size edit that would exceed the byte cap is refused without changing the state.
  const frozenJson=json(state);
  refuse(()=>apply(state,{note:{op:'add',text}},{noteId:uid(98)}),'limited','byte cap');assert.equal(json(state),frozenJson);
 }
 // Byte accounting is by UTF-8 size, not characters: the same count of characters fits fewer 3-byte notes than 1-byte notes.
 const countFit=text=>{let s=d.emptyLeadState,n=0;for(;;){try{s=apply(s,{note:{op:'add',text}},{noteId:uid(n+1)}).state;n++;}catch{return n;}}};
 assert.ok(countFit('日'.repeat(1000))<countFit('x'.repeat(1000)));
 // Edit growing past the cap is limited, not truncated.
 let near=d.emptyLeadState;for(let i=0;i<5;i++)near=apply(near,{note:{op:'add',text:'日'.repeat(1000)}},{noteId:uid(i+1)}).state;
 near=apply(near,{note:{op:'add',text:'tiny'}},{noteId:uid(6)}).state;
 refuse(()=>apply(near,{note:{op:'edit',noteId:uid(6),text:'x'.repeat(1000)}}),'limited','edit growth past the byte cap');
 assert.equal(apply(near,{note:{op:'edit',noteId:uid(6),text:'x'.repeat(100)}}).state.notes.length,6);
});

check('apply is pure: inputs are not mutated, results are deeply frozen and replayable',()=>{
 const state=noteState(3),before=json(state);
 const frozenInput=JSON.parse(before);
 const deepFreeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(deepFreeze);Object.freeze(v);}return v;};
 deepFreeze(frozenInput);
 const changes={stage:'won',dueOn:'2026-10-08',note:{op:'edit',noteId:uid(2),text:'changed'}},changesBefore=json(changes);
 const a=d.applyLeadChanges(frozenInput,changes,{expectedRevision:3,now:9000,noteId:null});
 assert.equal(json(state),before);assert.equal(json(frozenInput),before);assert.equal(json(changes),changesBefore);
 const b=d.applyLeadChanges(JSON.parse(before),JSON.parse(changesBefore),{expectedRevision:3,now:9000,noteId:null});
 assert.equal(json(a),json(b),'same inputs, same result (no hidden clock, randomness or state)');
 for(const part of [a,a.state,a.state.notes,...a.state.notes])assert.ok(Object.isFrozen(part));
 assert.throws(()=>{a.state.stage='lost';},TypeError);assert.throws(()=>a.state.notes.push({}),TypeError);assert.throws(()=>{a.state.notes[0].text='x';},TypeError);
 assert.ok(a.state.notes.every((n,i)=>n!==frozenInput.notes[i]),'no aliasing of caller note objects');
 // The result is itself a valid state that chains into the next change.
 const next=d.applyLeadChanges(a.state,{stage:'lost'},{expectedRevision:4,now:9001,noteId:null});assert.equal(next.state.revision,5);
 // Accessors on caller state or context are never invoked.
 const sneaky={stage:'new',stageChangedAt:null,dueOn:null,notes:[],revision:0,updatedAt:null};Object.defineProperty(sneaky,'stage',{enumerable:true,get(){throw Error('getter ran');}});
 refuse(()=>d.leadState(sneaky),'invalid_request');
 const parsed=d.parseLeadUpdate({changes:{note:{op:'add',text:'x'}}});assert.throws(()=>{parsed.changes.stage='won';},TypeError);
});

check('stored notes are read back only in their exact canonical form',()=>{
 const state=noteState(3,'é-日本-');
 const text=d.leadNotesJson(state.notes);
 assert.deepEqual(d.readLeadNotes(text),state.notes);assert.ok(Object.isFrozen(d.readLeadNotes(text)));assert.deepEqual(d.readLeadNotes('[]'),[]);
 assert.ok(text.startsWith('[{"createdAt":'),'sorted keys');
 const reordered=JSON.stringify(state.notes.map(n=>({id:n.id,text:n.text,createdAt:n.createdAt,updatedAt:n.updatedAt})));
 const bad=[reordered,text+' ',' '+text,'[]\n','',null,undefined,{},[],'{}','null','[null]','[{}]','not json',text.slice(0,-1),text.replace('"é','"\\u00e9'),
  JSON.stringify([{createdAt:1,id:uid(1),text:'x',updatedAt:1,extra:1}]),JSON.stringify([{createdAt:2,id:uid(1),text:'x',updatedAt:1}]),JSON.stringify([{createdAt:1,id:'x',text:'x',updatedAt:1}]),
  JSON.stringify(Array.from({length:21},(_,i)=>({createdAt:1,id:uid(i+1),text:'x',updatedAt:1}))),'['.repeat(40),`[{"createdAt":1,"id":"${uid(1)}","text":"\\u0000","updatedAt":1}]`,
  d.leadNotesJson([{id:uid(1),text:'x'.repeat(1000),createdAt:1,updatedAt:1}]).padEnd(16385,' ')];
 for(const [i,value] of bad.entries())refuse(()=>d.readLeadNotes(value),'unavailable',`stored ${i}`);
 refuse(()=>d.leadNotesJson(Array.from({length:17},(_,i)=>({id:uid(i+1),text:'x'.repeat(1000),createdAt:1,updatedAt:1}))),'limited');
});

check('filters validate only decision-independent fields and canonicalize',()=>{
 const none=d.parseLeadFilter({});assert.deepEqual({...none},{stages:null,hasNotes:null,dueFrom:null,dueTo:null});assert.ok(Object.isFrozen(none));
 const f=d.parseLeadFilter({stages:['lost','new','contacted'],hasNotes:false,dueFrom:'2028-02-29',dueTo:'2028-02-29'});
 assert.deepEqual([...f.stages],['new','contacted','lost'],'vocabulary order, so equal filters are equal');assert.equal(f.hasNotes,false);assert.ok(Object.isFrozen(f.stages));
 assert.equal(json(d.parseLeadFilter({stages:['won','new']})),json(d.parseLeadFilter({stages:['new','won']})));
 assert.deepEqual([...d.parseLeadFilter({stages:[...d.leadStages].reverse()}).stages],[...d.leadStages]);
 assert.equal(d.parseLeadFilter({dueFrom:'2026-10-08'}).dueTo,null);assert.equal(d.parseLeadFilter({hasNotes:true}).hasNotes,true);
 const bads={
  ...hostile({}),unknownKey:{stage:'new'},legacy:{status:['new']},due:{due:'overdue'},bucket:{bucket:'overdue'},stagesEmpty:{stages:[]},stagesSix:{stages:['new','contacted','qualified','won','lost','new']},stagesDup:{stages:['new','new']},stagesUnknown:{stages:['closed']},stagesString:{stages:'new'},stagesNull:{stages:null},stagesNested:{stages:[['new']]},
  stagesObject:{stages:{0:'new',length:1}},hasNotesString:{hasNotes:'yes'},hasNotesNumber:{hasNotes:1},hasNotesNull:{hasNotes:null},fromBad:{dueFrom:'2026-02-29'},toBad:{dueTo:'2026-13-01'},fromNull:{dueFrom:null},toNumber:{dueTo:20261008},fromTime:{dueFrom:'2026-10-08T00:00:00Z'},
  inverted:{dueFrom:'2026-10-09',dueTo:'2026-10-08'},protoKey:JSON.parse('{"__proto__":{"stages":["new"]}}'),
 };
 for(const [name,value] of Object.entries(bads))refuse(()=>d.parseLeadFilter(value),'invalid_request',name);
 const row=(stage,dueOn,notes=0)=>({stage,dueOn,notes:Array.from({length:notes})});
 const m=(input,lead)=>d.matchesLeadFilter(lead,d.parseLeadFilter(input));
 assert.ok(m({},row('new',null)));
 assert.ok(m({stages:['new']},row('new',null)));assert.ok(!m({stages:['new']},row('won',null)));assert.ok(m({stages:['won','lost']},row('lost',null)));
 assert.ok(m({hasNotes:true},row('new',null,1)));assert.ok(!m({hasNotes:true},row('new',null)));assert.ok(m({hasNotes:false},row('new',null)));assert.ok(!m({hasNotes:false},row('new',null,2)));
 const range={dueFrom:'2026-10-08',dueTo:'2026-10-10'};
 assert.ok(!m(range,row('new',null)),'no due date never matches a date bound');assert.ok(!m(range,row('new','2026-10-07')));assert.ok(m(range,row('new','2026-10-08')));assert.ok(m(range,row('lost','2026-10-09')));assert.ok(m(range,row('won','2026-10-10')));assert.ok(!m(range,row('new','2026-10-11')));
 assert.ok(m({dueFrom:'2026-10-08'},row('new','9999-12-31')));assert.ok(!m({dueFrom:'2026-10-08'},row('new',null)));assert.ok(m({dueTo:'2026-10-08'},row('new','0001-01-01')));assert.ok(!m({dueTo:'2026-10-08'},row('new',null)));
 assert.ok(m({stages:['contacted'],hasNotes:true,dueFrom:'2026-01-01',dueTo:'2026-12-31'},row('contacted','2026-06-01',1)));assert.ok(!m({stages:['contacted'],hasNotes:true,dueFrom:'2026-01-01',dueTo:'2026-12-31'},row('new','2026-06-01',1)));
});

check('refusals never echo submitted values',()=>{
 const attempts=[()=>d.parseLeadUpdate({changes:{note:{op:'add',text:`${MARK}\u0000`}}}),()=>d.parseLeadUpdate({changes:{dueOn:DATE_MARK}}),()=>d.parseLeadUpdate({changes:{[MARK]:1}}),
  ()=>d.parseLeadFilter({[MARK]:1}),()=>d.parseLeadFilter({dueFrom:DATE_MARK}),()=>d.leadState({stage:MARK}),()=>d.readLeadNotes(MARK),()=>d.leadDueBucket({stage:'new',dueOn:null},DATE_MARK),
  ()=>apply(d.emptyLeadState,{note:{op:'edit',noteId:uid(5),text:MARK}})];
 for(const [i,attempt] of attempts.entries()){
  try{attempt();assert.fail(`attempt ${i} succeeded`);}catch(error){
   assert.ok(error instanceof ModuleError,String(error));assert.ok(!error.message.includes(MARK)&&!error.message.includes('1999'));assert.ok(!JSON.stringify(error.body()).includes(MARK));assert.equal(error.message,new ModuleError(error.code).message);
  }
 }
});

console.log(`Lead domain core passed: ${cases} groups — pure typed stage vocabulary, civil dates (leap years, impossible dates, day arithmetic checked against an independent calendar oracle, timezone independence), notes bounds (code points, UTF-8 bytes, control characters, lone surrogates), strict hostile-input rejection, revision-checked change application, filters and canonical stored notes. Not evidence for storage, tenancy, eligibility, export, deletion, Chat or browser acceptance.`);
