// Structural SQL reader for the trigger and view bodies in the current schema (WH-054 packet 1a).
// It is a tokenizer plus a recursive-descent parser for the SQLite subset those bodies use and a scope
// resolver that maps every column reference to its base (table, column). It never executes SQL. Anything
// outside the subset throws `UnsupportedSQL`, which callers must report (never skip): coverage is a result.

export class UnsupportedSQL extends Error{constructor(message,at){super(message);this.name='UnsupportedSQL';this.at=at;}}

const punctuation=new Set('(),;.');
const operators=['->>','->','||','<<','>>','<=','>=','==','!=','<>','=','<','>','+','-','*','/','%','&','|','~'];
export function tokenize(sql){
 const tokens=[];let i=0;
 const push=(type,value,start,extra={})=>tokens.push({type,value,start,end:i,...extra});
 while(i<sql.length){
  const c=sql[i],start=i;
  if(/\s/.test(c)){i++;continue;}
  if(c==='-'&&sql[i+1]==='-'){while(i<sql.length&&sql[i]!=='\n')i++;continue;}
  if(c==='/'&&sql[i+1]==='*'){const end=sql.indexOf('*/',i+2);if(end<0)throw new UnsupportedSQL('Unterminated comment',i);i=end+2;continue;}
  if(c==="'"){let v='';i++;for(;;){if(i>=sql.length)throw new UnsupportedSQL('Unterminated string',start);if(sql[i]==="'"){if(sql[i+1]==="'"){v+="'";i+=2;continue;}i++;break;}v+=sql[i++];}push('string',v,start);continue;}
  if(c==='"'||c==='`'||c==='['){
   const close=c==='['?']':c;let v='';i++;
   for(;;){if(i>=sql.length)throw new UnsupportedSQL('Unterminated identifier',start);if(sql[i]===close){if(close!==']'&&sql[i+1]===close){v+=close;i+=2;continue;}i++;break;}v+=sql[i++];}
   push('id',v,start,{quoted:true});continue;
  }
  if((c==='x'||c==='X')&&sql[i+1]==="'"){i+=2;while(i<sql.length&&sql[i]!=="'")i++;i++;push('string','',start);continue;}
  if(/[0-9]/.test(c)||(c==='.'&&/[0-9]/.test(sql[i+1]??''))){
   if(c==='0'&&/[xX]/.test(sql[i+1]??'')){i+=2;while(/[0-9a-fA-F]/.test(sql[i]??''))i++;}
   else{while(/[0-9]/.test(sql[i]??''))i++;if(sql[i]==='.'){i++;while(/[0-9]/.test(sql[i]??''))i++;}if(/[eE]/.test(sql[i]??'')&&/[-+0-9]/.test(sql[i+1]??'')){i+=2;while(/[0-9]/.test(sql[i]??''))i++;}}
   push('number',sql.slice(start,i),start);continue;
  }
  if(/[A-Za-z_]/.test(c)){while(/[A-Za-z0-9_$]/.test(sql[i]??''))i++;push('id',sql.slice(start,i),start,{quoted:false});continue;}
  if(c==='?'){i++;while(/[0-9]/.test(sql[i]??''))i++;push('param',sql.slice(start,i),start);continue;}
  if((c===':'||c==='@'||c==='$')&&/[A-Za-z_]/.test(sql[i+1]??'')){i++;while(/[A-Za-z0-9_]/.test(sql[i]??''))i++;push('param',sql.slice(start,i),start);continue;}
  const op=operators.find(o=>sql.startsWith(o,i));
  if(op){i+=op.length;push('op',op,start);continue;}
  if(punctuation.has(c)){i++;push('punct',c,start);continue;}
  throw new UnsupportedSQL(`Unexpected character ${JSON.stringify(c)}`,i);
 }
 tokens.push({type:'eof',value:'',start:sql.length,end:sql.length});
 return tokens;
}

// Words that cannot be a bare alias or column name in the positions this parser looks at.
const reserved=new Set(['ALL','AND','AS','BETWEEN','BY','CASE','CAST','COLLATE','CROSS','DISTINCT','ELSE','END','ESCAPE','EXCEPT','EXISTS','FROM','FULL','GLOB','GROUP','HAVING','IN','INDEXED','INNER','INSERT','INTERSECT','IS','ISNULL','JOIN','LEFT','LIKE','LIMIT','MATCH','NATURAL','NOT','NOTNULL','NULL','OFFSET','ON','OR','ORDER','OUTER','RETURNING','RIGHT','SELECT','SET','THEN','UNION','UPDATE','USING','VALUES','WHEN','WHERE','WINDOW','WITH','DELETE','DO','BEGIN','OVER','FILTER','RAISE']);
const comparisonOps=new Set(['=','==','!=','<>','<','<=','>','>=']);

class Parser{
 constructor(sql){this.sql=sql;this.tokens=tokenize(sql);this.i=0;}
 get t(){return this.tokens[this.i];}
 at(offset=0){return this.tokens[Math.min(this.i+offset,this.tokens.length-1)];}
 is(word,offset=0){const t=this.at(offset);return t.type==='id'&&!t.quoted&&t.value.toUpperCase()===word;}
 isPunct(v,offset=0){const t=this.at(offset);return t.type==='punct'&&t.value===v;}
 isOp(v,offset=0){const t=this.at(offset);return t.type==='op'&&t.value===v;}
 fail(message){throw new UnsupportedSQL(`${message} near ${JSON.stringify(this.sql.slice(this.t.start,this.t.start+30))}`,this.t.start);}
 next(){return this.tokens[this.i++];}
 eat(word){if(this.is(word)){this.i++;return true;}return false;}
 eatPunct(v){if(this.isPunct(v)){this.i++;return true;}return false;}
 eatOp(v){if(this.isOp(v)){this.i++;return true;}return false;}
 expect(word){if(!this.eat(word))this.fail(`Expected ${word}`);}
 expectPunct(v){if(!this.eatPunct(v))this.fail(`Expected ${v}`);}
 name(){const t=this.t;if(t.type==='id'||t.type==='string'){this.i++;return t.value;}this.fail('Expected a name');}
 // Plain (possibly quoted) identifier that is not reserved; used for bare aliases.
 isBareAlias(){const t=this.t;return t.type==='id'&&(t.quoted||!reserved.has(t.value.toUpperCase()));}

 // ---- statements ----
 triggerHeader(){
  this.expect('CREATE');if(this.eat('TEMP')||this.eat('TEMPORARY')){/* temp */}
  this.expect('TRIGGER');if(this.eat('IF')){this.expect('NOT');this.expect('EXISTS');}
  let name=this.name();if(this.eatPunct('.'))name=this.name();
  let timing='BEFORE';
  if(this.eat('BEFORE'))timing='BEFORE';else if(this.eat('AFTER'))timing='AFTER';else if(this.eat('INSTEAD')){this.expect('OF');timing='INSTEAD OF';}
  let event,ofColumns=null,ofRange=null;
  if(this.eat('DELETE'))event='DELETE';else if(this.eat('INSERT'))event='INSERT';
  else if(this.is('UPDATE')){const startTok=this.next();event='UPDATE';if(this.eat('OF')){ofColumns=[];do ofColumns.push(this.name());while(this.eatPunct(','));ofRange=[startTok.end,this.t.start];}}
  else this.fail('Expected a trigger event');
  this.expect('ON');let table=this.name();if(this.eatPunct('.'))table=this.name();
  return {name,timing,event,ofColumns,ofRange,table};
 }
 trigger(){
  const header=this.triggerHeader();
  if(this.eat('FOR')){this.expect('EACH');this.expect('ROW');}
  const when=this.eat('WHEN')?this.expr():null;
  this.expect('BEGIN');
  const body=[];
  while(!this.is('END')){body.push(this.statement());if(!this.eatPunct(';'))break;}
  this.expect('END');
  if(this.t.type!=='eof'&&!(this.isPunct(';')&&this.at(1).type==='eof'))this.fail('Unexpected trailing text');
  return {kind:'trigger',...header,when,body};
 }
 view(){
  this.expect('CREATE');if(this.eat('TEMP')||this.eat('TEMPORARY')){/* temp */}
  this.expect('VIEW');if(this.eat('IF')){this.expect('NOT');this.expect('EXISTS');}
  let name=this.name();if(this.eatPunct('.'))name=this.name();
  let columns=null;
  if(this.eatPunct('(')){columns=[];do columns.push(this.name());while(this.eatPunct(','));this.expectPunct(')');}
  this.expect('AS');
  const select=this.select();
  this.eatPunct(';');
  if(this.t.type!=='eof')this.fail('Unexpected trailing text');
  return {kind:'view',name,columns,select};
 }
 statement(){
  if(this.is('WITH'))this.fail('WITH clauses are not supported');
  if(this.is('SELECT')||this.is('VALUES'))return {type:'select',select:this.select()};
  if(this.is('INSERT')||this.is('REPLACE'))return this.insert();
  if(this.is('UPDATE'))return this.update();
  if(this.is('DELETE'))return this.deleteStatement();
  this.fail('Unsupported statement');
 }
 qualifiedTable(){let name=this.name();let schema=null;if(this.eatPunct('.')){schema=name;name=this.name();}return {name,schema};}
 insert(){
  const replace=this.is('REPLACE');this.i++;
  if(!replace){if(this.eat('OR'))this.name();}
  this.expect('INTO');const {name:table}=this.qualifiedTable();
  let alias=null;if(this.eat('AS'))alias=this.name();
  let columns=null;if(this.eatPunct('(')){columns=[];do columns.push(this.name());while(this.eatPunct(','));this.expectPunct(')');}
  let source;
  if(this.eat('DEFAULT')){this.expect('VALUES');source={kind:'default'};}
  else source={kind:'select',select:this.select()};
  const upserts=[];
  while(this.is('ON')&&this.is('CONFLICT',1)){
   this.i+=2;let target=null,targetWhere=null;
   if(this.eatPunct('(')){target=[];do{target.push(this.expr());this.eat('COLLATE')&&this.name();if(this.eat('ASC')||this.eat('DESC')){/* order */}}while(this.eatPunct(','));this.expectPunct(')');if(this.eat('WHERE'))targetWhere=this.expr();}
   this.expect('DO');
   if(this.eat('NOTHING'))upserts.push({target,targetWhere,nothing:true});
   else{this.expect('UPDATE');this.expect('SET');upserts.push({target,targetWhere,assignments:this.assignments(),where:this.eat('WHERE')?this.expr():null});}
  }
  if(this.is('RETURNING'))this.fail('RETURNING is not supported');
  return {type:'insert',table,alias,columns,source,upserts};
 }
 assignments(){
  const list=[];
  do{
   let columns;
   if(this.eatPunct('(')){columns=[];do columns.push(this.name());while(this.eatPunct(','));this.expectPunct(')');}
   else columns=[this.name()];
   if(!this.eatOp('='))this.fail('Expected =');
   list.push({columns,value:this.expr()});
  }while(this.eatPunct(','));
  return list;
 }
 update(){
  this.expect('UPDATE');if(this.eat('OR'))this.name();
  const {name:table}=this.qualifiedTable();let alias=null;
  if(this.eat('AS'))alias=this.name();else if(this.isBareAlias()&&!this.is('SET'))alias=this.name();
  this.expect('SET');const assignments=this.assignments();
  const from=this.eat('FROM')?this.fromClause():null;
  const where=this.eat('WHERE')?this.expr():null;
  if(this.is('RETURNING')||this.is('ORDER')||this.is('LIMIT'))this.fail('UPDATE ORDER/LIMIT/RETURNING are not supported');
  return {type:'update',table,alias,assignments,from,where};
 }
 deleteStatement(){
  this.expect('DELETE');this.expect('FROM');const {name:table}=this.qualifiedTable();let alias=null;
  if(this.eat('AS'))alias=this.name();else if(this.isBareAlias()&&!this.is('WHERE'))alias=this.name();
  const where=this.eat('WHERE')?this.expr():null;
  if(this.is('RETURNING')||this.is('ORDER')||this.is('LIMIT'))this.fail('DELETE ORDER/LIMIT/RETURNING are not supported');
  return {type:'delete',table,alias,where};
 }

 // ---- SELECT ----
 select(){
  if(this.is('WITH'))this.fail('WITH clauses are not supported');
  const parts=[{core:this.core(),op:null}];
  while(this.is('UNION')||this.is('INTERSECT')||this.is('EXCEPT')){
   const op=this.next().value.toUpperCase()+(this.is('ALL')&&this.eat('ALL')?' ALL':'');
   parts.push({core:this.core(),op});
  }
  let orderBy=null,limit=null;
  if(this.is('ORDER')){this.i++;this.expect('BY');orderBy=[];do{orderBy.push(this.expr());if(this.eat('COLLATE'))this.name();if(this.eat('ASC')||this.eat('DESC')){/* order */}if(this.eat('NULLS')){this.name();}}while(this.eatPunct(','));}
  if(this.eat('LIMIT')){limit=[this.expr()];if(this.eat('OFFSET')||this.eatPunct(','))limit.push(this.expr());}
  return {parts,orderBy,limit};
 }
 core(){
  if(this.is('VALUES')){
   this.i++;const rows=[];do{this.expectPunct('(');const row=[];do row.push(this.expr());while(this.eatPunct(','));this.expectPunct(')');rows.push(row);}while(this.eatPunct(','));
   return {values:rows};
  }
  this.expect('SELECT');
  const distinct=this.eat('DISTINCT');if(!distinct)this.eat('ALL');
  const columns=[];
  do{
   if(this.isOp('*')){this.i++;columns.push({star:true,table:null});continue;}
   if(this.t.type==='id'&&this.isPunct('.',1)&&this.isOp('*',2)){const table=this.name();this.i+=2;columns.push({star:true,table});continue;}
   const expr=this.expr();let alias=null;
   if(this.eat('AS'))alias=this.name();else if(this.isBareAlias())alias=this.name();
   columns.push({expr,alias});
  }while(this.eatPunct(','));
  const from=this.eat('FROM')?this.fromClause():null;
  const where=this.eat('WHERE')?this.expr():null;
  let groupBy=null,having=null;
  if(this.is('GROUP')){this.i++;this.expect('BY');groupBy=[];do groupBy.push(this.expr());while(this.eatPunct(','));}
  if(this.eat('HAVING'))having=this.expr();
  if(this.is('WINDOW'))this.fail('WINDOW is not supported');
  return {distinct,columns,from,where,groupBy,having};
 }
 fromClause(){
  const items=[this.tableOrSubquery()];
  for(;;){
   let join=null;
   if(this.eatPunct(','))join='JOIN';
   else if(this.is('JOIN')||this.is('LEFT')||this.is('INNER')||this.is('CROSS')||this.is('NATURAL')||this.is('RIGHT')||this.is('FULL')){
    const words=[];while(!this.is('JOIN')){if(this.t.type!=='id')this.fail('Expected JOIN');words.push(this.next().value.toUpperCase());}
    this.expect('JOIN');join=words.join(' ')||'JOIN';
    if(/NATURAL/.test(join))this.fail('NATURAL joins are not supported');
   }else break;
   const item=this.tableOrSubquery();item.join=join;
   if(this.eat('ON'))item.on=this.expr();
   else if(this.eat('USING')){this.fail('JOIN USING is not supported');}
   items.push(item);
  }
  return items;
 }
 tableOrSubquery(){
  if(this.isPunct('(')){
   this.i++;
   if(this.is('SELECT')||this.is('VALUES')||this.is('WITH')){
    const select=this.select();this.expectPunct(')');
    const alias=this.eat('AS')?this.name():this.isBareAlias()?this.name():null;
    return {kind:'subquery',select,alias};
   }
   const items=this.fromClause();this.expectPunct(')');
   return {kind:'group',items};
  }
  const {name,schema}=this.qualifiedTable();
  if(this.isPunct('(')){
   this.i++;const args=[];if(!this.isPunct(')')){do args.push(this.expr());while(this.eatPunct(','));}this.expectPunct(')');
   const alias=this.eat('AS')?this.name():this.isBareAlias()?this.name():null;
   return {kind:'function',name,args,alias};
  }
  const alias=this.eat('AS')?this.name():this.isBareAlias()?this.name():null;
  if(this.eat('INDEXED')){this.expect('BY');this.name();}else if(this.is('NOT')&&this.is('INDEXED',1)){this.i+=2;}
  return {kind:'table',name,schema,alias};
 }

 // ---- expressions (precedence climbing; SQLite binds || above * and NOT below comparison) ----
 expr(){return this.binary(0);}
 binary(min){
  let left=this.unary();
  for(;;){
   const t=this.t;let op=null,prec=0,not=false,skip=1;
   if(t.type==='op'){
    const v=t.value;
    if(v==='||'||v==='->'||v==='->>'){op=v;prec=9;}
    else if(v==='*'||v==='/'||v==='%'){op=v;prec=8;}
    else if(v==='+'||v==='-'){op=v;prec=7;}
    else if(v==='&'||v==='|'||v==='<<'||v==='>>'){op=v;prec=6;}
    else if(v==='<'||v==='<='||v==='>'||v==='>='){op=v;prec=5;}
    else if(v==='='||v==='=='||v==='!='||v==='<>'){op=v;prec=4;}
   }else if(t.type==='id'&&!t.quoted){
    const w=t.value.toUpperCase();
    if(w==='OR'){op='OR';prec=1;}
    else if(w==='AND'){op='AND';prec=2;}
    else if(w==='IS'){op='IS';prec=4;}
    else if(w==='ISNULL'||w==='NOTNULL'){op=w;prec=4;}
    else if(w==='IN'||w==='LIKE'||w==='GLOB'||w==='BETWEEN'||w==='MATCH'||w==='REGEXP'){op=w;prec=4;}
    else if(w==='COLLATE'){op='COLLATE';prec=10;}
    else if(w==='NOT'){
     const n=this.at(1);
     if(n.type==='id'&&!n.quoted&&['IN','LIKE','GLOB','BETWEEN','MATCH','REGEXP'].includes(n.value.toUpperCase())){op=n.value.toUpperCase();prec=4;not=true;skip=2;}
     else if(n.type==='id'&&!n.quoted&&n.value.toUpperCase()==='NULL'){op='NOTNULL';prec=4;skip=2;}
    }
   }
   if(!op||prec<min)return left;
   this.i+=skip;
   if(op==='ISNULL'||op==='NOTNULL'){left={k:'isnull',e:left,not:op==='NOTNULL'};continue;}
   if(op==='COLLATE'){this.name();continue;}
   if(op==='IS'){
    let isNot=this.eat('NOT');
    if(this.eat('DISTINCT')){this.expect('FROM');isNot=!isNot;}
    const right=this.binary(prec+1);left={k:'bin',op:isNot?'IS NOT':'IS',l:left,r:right};continue;
   }
   if(op==='IN'){left=this.inExpr(left,not);continue;}
   if(op==='BETWEEN'){const lo=this.binary(5);this.expect('AND');const hi=this.binary(5);left={k:'between',e:left,lo,hi,not};continue;}
   if(op==='LIKE'||op==='GLOB'||op==='MATCH'||op==='REGEXP'){const right=this.binary(prec+1);if(this.eat('ESCAPE'))this.binary(prec+1);left={k:'pattern',op,e:left,pattern:right,not};continue;}
   const right=this.binary(prec+1);
   left={k:'bin',op,l:left,r:right};
  }
 }
 inExpr(left,not){
  if(this.isPunct('(')){
   this.i++;
   if(this.is('SELECT')||this.is('VALUES')||this.is('WITH')){const select=this.select();this.expectPunct(')');return {k:'in',e:left,not,select};}
   const list=[];if(!this.isPunct(')')){do list.push(this.expr());while(this.eatPunct(','));}this.expectPunct(')');
   return {k:'in',e:left,not,list};
  }
  const {name}=this.qualifiedTable();
  return {k:'in',e:left,not,table:name};
 }
 unary(){
  if(this.is('NOT')){this.i++;return {k:'un',op:'NOT',e:this.binary(3)};}
  if(this.t.type==='op'&&(this.t.value==='-'||this.t.value==='+'||this.t.value==='~')){const op=this.next().value;return {k:'un',op,e:this.unary()};}
  return this.atom();
 }
 atom(){
  const t=this.t;
  if(t.type==='number'||t.type==='string'){this.i++;return {k:'lit',type:t.type,value:t.value};}
  if(t.type==='param'){this.i++;return {k:'param',name:t.value};}
  if(t.type==='punct'&&t.value==='('){
   this.i++;
   if(this.is('SELECT')||this.is('VALUES')||this.is('WITH')){const select=this.select();this.expectPunct(')');return {k:'sub',select};}
   const items=[this.expr()];while(this.eatPunct(','))items.push(this.expr());this.expectPunct(')');
   return items.length===1?{k:'paren',e:items[0]}:{k:'list',items};
  }
  if(t.type==='id'&&!t.quoted){
   const w=t.value.toUpperCase();
   if(w==='NULL'||w==='TRUE'||w==='FALSE'||w==='CURRENT_TIMESTAMP'||w==='CURRENT_DATE'||w==='CURRENT_TIME'){this.i++;return {k:'lit',type:'keyword',value:w};}
   if(w==='EXISTS'||(w==='NOT'&&this.is('EXISTS',1))){
    const not=w==='NOT';this.i+=not?2:1;this.expectPunct('(');const select=this.select();this.expectPunct(')');return {k:'exists',select,not};
   }
   if(w==='CASE'){
    this.i++;const operand=this.is('WHEN')?null:this.expr();const whens=[];
    while(this.eat('WHEN')){const cond=this.expr();this.expect('THEN');whens.push({cond,then:this.expr()});}
    const otherwise=this.eat('ELSE')?this.expr():null;this.expect('END');
    return {k:'case',operand,whens,otherwise};
   }
   if(w==='CAST'&&this.isPunct('(',1)){
    this.i+=2;const e=this.expr();this.expect('AS');while(this.t.type==='id'||this.isPunct('(')){if(this.eatPunct('(')){while(!this.isPunct(')'))this.i++;this.i++;}else this.i++;if(this.isPunct(')'))break;}
    this.expectPunct(')');return {k:'cast',e};
   }
  }
  if(t.type==='id'){
   this.i++;
   if(this.isPunct('(')){
    this.i++;const name=t.value;const args=[];let star=false,distinct=false;
    if(this.isOp('*')){this.i++;star=true;}
    else if(!this.isPunct(')')){distinct=this.eat('DISTINCT');do args.push(this.exprOrKeyword());while(this.eatPunct(','));}
    this.expectPunct(')');
    if(this.is('FILTER')||this.is('OVER'))this.fail('Window and FILTER clauses are not supported');
    return {k:'fn',name:name.toUpperCase(),args,star,distinct};
   }
   const parts=[t.value];
   while(this.isPunct('.')&&(this.at(1).type==='id'||this.at(1).type==='string')){this.i++;parts.push(this.next().value);}
   if(parts.length>3)this.fail('Unsupported qualified name');
   return {k:'col',table:parts.length>1?parts[parts.length-2]:null,name:parts[parts.length-1]};
  }
  this.fail('Unsupported expression');
 }
 // RAISE(ABORT,'text') puts a bare keyword where an expression is expected.
 exprOrKeyword(){
  if((this.is('ABORT')||this.is('FAIL')||this.is('ROLLBACK')||this.is('IGNORE'))&&(this.isPunct(',',1)||this.isPunct(')',1))){return {k:'lit',type:'keyword',value:this.next().value.toUpperCase()};}
  return this.expr();
 }
}

/** Header only (name, timing, event, UPDATE OF list, table), so a trigger whose body is unsupported is still probed. */
export function parseTriggerHeader(sql){return new Parser(sql).triggerHeader();}
/** Parse the `sql` column of a sqlite_master trigger or view row. */
export function parseObject(sql){
 const p=new Parser(sql);
 if(p.is('CREATE')){
  let j=1;if(p.is('TEMP',j)||p.is('TEMPORARY',j))j++;
  if(p.is('TRIGGER',j))return p.trigger();
  if(p.is('VIEW',j))return p.view();
 }
 throw new UnsupportedSQL('Only CREATE TRIGGER and CREATE VIEW are parsed',0);
}

// ---- scope resolution and comparison extraction ----
const lower=s=>s.toLowerCase();
const unparen=e=>e?.k==='paren'?unparen(e.e):e;

/**
 * Resolves column references to base columns and extracts typed comparisons.
 *  - tables: Map(lowercase table name -> string[] columns)
 *  - views: Map(lowercase view name -> parsed view)
 *  - typeOf(table, column) -> type string or undefined
 * `refs` of a resolved column are the base (table, column) pairs it can be; a computed value has none.
 */
export class Analyzer{
 constructor({tables,views,typeOf}){this.tables=tables;this.views=views;this.typeOf=typeOf;this.viewCache=new Map();this.reset();}
 reset(){this.comparisons=[];this.unresolved=[];this.expressions=0;}
 // A source is {alias, columns: Map(lowercase column -> refs[])}.
 tableSource(name,alias){
  const key=lower(name);
  if(this.tables.has(key)){return {alias:alias??name,columns:new Map(this.tables.get(key).map(c=>[lower(c),[{table:name,column:c}]]))};}
  if(this.views.has(key))return {alias:alias??name,columns:this.viewOutputs(key)};
  throw new UnsupportedSQL(`Unknown table or view ${name}`);
 }
 viewOutputs(key){
  if(this.viewCache.has(key))return this.viewCache.get(key);
  const view=this.views.get(key);this.viewCache.set(key,new Map());// recursion guard
  // The view's own comparisons belong to the view (analyzeView), never to the object that first reads it.
  const outputs=this.subOutputs(view.select,[]);
  const columns=new Map();
  outputs.forEach((o,index)=>{const name=view.columns?.[index]??o.name;if(name)columns.set(lower(name),o.refs);});
  this.viewCache.set(key,columns);return columns;
 }
 // Returns [{name, refs}] for a select; analyses nested comparisons as a side effect.
 selectOutputs(select,outer){
  const results=select.parts.map(part=>this.coreOutputs(part.core,outer));
  const first=results[0].outputs;
  const merged=first.map((o,index)=>({name:o.name,refs:results.flatMap(r=>r.outputs[index]?.refs??[])}));
  // ORDER BY/LIMIT see the first core's sources (and output aliases, which are not source columns).
  const unresolved=this.unresolved.length;
  for(const e of [...(select.orderBy??[]),...(select.limit??[])])this.walk(e,[...outer,results[0].frame]);
  this.unresolved.length=unresolved;// an ORDER BY name may be an output alias, not a source column
  return merged;
 }
 coreOutputs(core,outer){
  if(core.values){
   for(const row of core.values)for(const e of row)this.walk(e,outer);
   return {outputs:core.values[0].map((_,i)=>({name:`column${i+1}`,refs:[]})),frame:[]};
  }
  const frame=[];
  const addItems=items=>{
   for(const item of items){
    if(item.kind==='group'){addItems(item.items);continue;}
    let source;
    if(item.kind==='table')source=this.tableSource(item.name,item.alias);
    else if(item.kind==='subquery'){
     const out=this.selectOutputs(item.select,outer);
     source={alias:item.alias??'',columns:new Map(out.filter(o=>o.name).map(o=>[lower(o.name),o.refs]))};
    }else source={alias:item.alias??item.name,columns:new Map([['value',[]],['key',[]],['type',[]],['atom',[]],['id',[]],['parent',[]],['fullkey',[]],['path',[]]]),computed:true};
    frame.push(source);
    if(item.kind==='function')for(const a of item.args)this.walk(a,[...outer,frame]);
   }
  };
  if(core.from)addItems(core.from);
  const scopes=[...outer,frame];
  const onClauses=[];const collect=items=>{for(const item of items){if(item.kind==='group')collect(item.items);else if(item.on)onClauses.push(item.on);}};
  if(core.from)collect(core.from);
  for(const on of onClauses)this.walk(on,scopes);
  if(core.where)this.walk(core.where,scopes);
  for(const e of core.groupBy??[])this.walk(e,scopes);
  if(core.having)this.walk(core.having,scopes);
  const outputs=[];
  for(const c of core.columns){
   if(c.star){
    for(const s of frame)if(!c.table||lower(s.alias)===lower(c.table))for(const [name,refs] of s.columns)outputs.push({name,refs});
   }else{
    this.walk(c.expr,scopes);
    const refs=this.exprRefs(c.expr,scopes);
    const name=c.alias??(c.expr.k==='col'?c.expr.name:c.expr.k==='paren'&&c.expr.e.k==='col'?c.expr.e.name:null);
    outputs.push({name,refs});
   }
  }
  return {outputs,frame};
 }
 resolve(col,scopes){
  const name=lower(col.name);
  if(col.table){
   for(let s=scopes.length-1;s>=0;s--){
    const frame=scopes[s];
    for(const src of frame)if(lower(src.alias)===lower(col.table)&&src.columns.has(name))return src.columns.get(name);
   }
   return null;
  }
  for(let s=scopes.length-1;s>=0;s--){
   const hits=scopes[s].filter(src=>src.columns.has(name));
   if(hits.length)return hits[0].columns.get(name);
  }
  return null;
 }
 // Base (table, column) pairs an expression can carry; empty for computed values.
 exprRefs(e,scopes){
  switch(e.k){
   case 'col':return this.resolve(e,scopes)??[];
   case 'paren':return this.exprRefs(e.e,scopes);
   case 'sub':return this.subOutputs(e.select,scopes)[0]?.refs??[];
   case 'fn':if(['COALESCE','IFNULL','NULLIF'].includes(e.name))return e.args.flatMap(a=>this.exprRefs(a,scopes));return [];
   default:return [];
  }
 }
 subOutputs(select,scopes){
  // Re-analysing a nested select would double-count comparisons; resolve outputs against a throwaway analyzer state.
  const saved=[this.comparisons,this.unresolved,this.expressions];this.comparisons=[];this.unresolved=[];
  try{return this.selectOutputs(select,scopes);}finally{[this.comparisons,this.unresolved,this.expressions]=saved;}
 }
 typeOfRefs(refs){
  if(!refs.length)return {type:'untyped',types:['untyped'],refs};
  const types=[...new Set(refs.map(r=>this.typeOf(r.table,r.column)??'untyped'))].sort();
  return {type:types.length===1?types[0]:'mixed',types,refs};
 }
 operand(e,scopes){
  if(e.k==='paren')return this.operand(e.e,scopes);
  if(e.k==='col'){
   const refs=this.resolve(e,scopes);
   if(!refs){this.unresolved.push(e.table?`${e.table}.${e.name}`:e.name);return {type:'unresolved',types:['unresolved'],refs:[],text:e.table?`${e.table}.${e.name}`:e.name};}
   return {...this.typeOfRefs(refs),text:e.table?`${e.table}.${e.name}`:e.name};
  }
  if(e.k==='sub'){return {...this.typeOfRefs(this.exprRefs(e,scopes)),text:'(subquery)'};}
  if(e.k==='fn'&&['COALESCE','IFNULL','NULLIF'].includes(e.name)){return {...this.typeOfRefs(this.exprRefs(e,scopes)),text:e.name.toLowerCase()+'(...)'};}
  if(e.k==='list')throw new UnsupportedSQL('Row value outside a comparison of equal-length rows');
  return {type:'untyped',types:['untyped'],refs:[],text:'(expression)'};
 }
 // Row values compare element by element; anything else that the resolver cannot pair fails closed.
 compare(op,l,r,scopes){
  l=unparen(l);r=unparen(r);
  if(l.k==='list'||r.k==='list'){
   if(l.k==='list'&&r.k==='list'&&l.items.length===r.items.length){l.items.forEach((x,i)=>this.compare(op,x,r.items[i],scopes));return;}
   if(l.k==='list'&&r.k==='sub'){const out=this.subOutputs(r.select,scopes);if(out.length===l.items.length){l.items.forEach((x,i)=>this.comparePair(op,x,{outputs:out[i]},scopes));return;}}
   if(r.k==='list'&&l.k==='sub'){const out=this.subOutputs(l.select,scopes);if(out.length===r.items.length){r.items.forEach((x,i)=>this.comparePair(op,x,{outputs:out[i]},scopes));return;}}
   throw new UnsupportedSQL(`Row value ${op} comparison the resolver cannot pair`);
  }
  this.comparisons.push({op,left:this.operand(l,scopes),right:this.operand(r,scopes)});
 }
 walk(e,scopes){
  if(!e)return;
  this.expressions++;
  switch(e.k){
   case 'bin':
    this.walk(e.l,scopes);this.walk(e.r,scopes);
    if(comparisonOps.has(e.op)||e.op==='IS'||e.op==='IS NOT')this.compare(e.op,e.l,e.r,scopes);
    return;
   case 'un':case 'paren':case 'cast':case 'isnull':this.walk(e.e,scopes);return;
   case 'between':this.walk(e.e,scopes);this.walk(e.lo,scopes);this.walk(e.hi,scopes);this.compare('BETWEEN',e.e,e.lo,scopes);this.compare('BETWEEN',e.e,e.hi,scopes);return;
   case 'pattern':this.walk(e.e,scopes);this.walk(e.pattern,scopes);return;
   case 'fn':
    for(const a of e.args)this.walk(a,scopes);
    if(e.name==='NULLIF'&&e.args.length===2)this.compare('NULLIF',e.args[0],e.args[1],scopes);
    return;
   case 'list':for(const i of e.items)this.walk(i,scopes);return;
   case 'case':
    this.walk(e.operand,scopes);
    for(const w of e.whens){this.walk(w.cond,scopes);this.walk(w.then,scopes);if(e.operand)this.compare('CASE',e.operand,w.cond,scopes);}
    this.walk(e.otherwise,scopes);return;
   case 'exists':this.selectOutputs(e.select,scopes);return;
   case 'sub':this.selectOutputs(e.select,scopes);return;
   case 'in':{
    this.walk(e.e,scopes);
    if(e.select){
     const out=this.selectOutputs(e.select,scopes),left=unparen(e.e);
     if(left.k==='list'&&left.items.length===out.length)left.items.forEach((x,i)=>this.comparePair('IN',x,{outputs:out[i]},scopes));
     else if(left.k!=='list'&&out.length===1)this.comparePair('IN',left,{outputs:out[0]},scopes);
     else throw new UnsupportedSQL('IN (SELECT ...) whose row width the resolver cannot pair');
    }else if(e.list){for(const i of e.list){this.walk(i,scopes);this.compare('IN',e.e,i,scopes);}}
    else throw new UnsupportedSQL(`IN ${e.table} (a table operand) is not resolved`);
    return;
   }
   default:return;
  }
 }
 comparePair(op,l,derived,scopes){
  const right={...this.typeOfRefs(derived.outputs.refs),text:'(subquery column)'};
  this.comparisons.push({op,left:this.operand(l,scopes),right});
 }

 // Entry points. A trigger body sees OLD/NEW (the trigger table) in the outermost scope.
 analyzeTrigger(trigger){
  this.reset();
  const tableSource=name=>this.tableSource(name,name);
  const base=tableSource(trigger.table);
  const rowFrame=[{...base,alias:'OLD'},{...base,alias:'NEW'}];
  if(trigger.when)this.walk(trigger.when,[rowFrame]);
  for(const stmt of trigger.body)this.statement(stmt,[rowFrame]);
  return {comparisons:this.comparisons,unresolved:this.unresolved,expressions:this.expressions};
 }
 statement(stmt,outer){
  switch(stmt.type){
   case 'select':this.selectOutputs(stmt.select,outer);return;
   case 'insert':{
    const target=this.tableSource(stmt.table,stmt.alias);
    if(stmt.source.kind==='select')this.selectOutputs(stmt.source.select,outer);
    for(const up of stmt.upserts){
     const frame=[target,{...target,alias:'excluded'}];
     if(up.targetWhere)this.walk(up.targetWhere,[...outer,frame]);
     for(const a of up.assignments??[])this.walk(a.value,[...outer,frame]);
     if(up.where)this.walk(up.where,[...outer,frame]);
    }
    return;
   }
   case 'update':{
    const frame=[this.tableSource(stmt.table,stmt.alias)];
    if(stmt.from)this.fromInto(stmt.from,frame,outer);
    const scopes=[...outer,frame];
    for(const a of stmt.assignments)this.walk(a.value,scopes);
    if(stmt.where)this.walk(stmt.where,scopes);
    return;
   }
   case 'delete':{
    const frame=[this.tableSource(stmt.table,stmt.alias)];
    if(stmt.where)this.walk(stmt.where,[...outer,frame]);
    return;
   }
   default:throw new UnsupportedSQL('Unsupported body statement');
  }
 }
 fromInto(items,frame,outer){
  for(const item of items){
   if(item.kind==='group'){this.fromInto(item.items,frame,outer);continue;}
   if(item.kind==='table')frame.push(this.tableSource(item.name,item.alias));
   else if(item.kind==='subquery'){const out=this.selectOutputs(item.select,outer);frame.push({alias:item.alias??'',columns:new Map(out.filter(o=>o.name).map(o=>[lower(o.name),o.refs]))});}
   else frame.push({alias:item.alias??item.name,columns:new Map(),computed:true});
   if(item.on)this.walk(item.on,[...outer,frame]);
  }
 }
 analyzeView(view){
  this.reset();
  this.selectOutputs(view.select,[]);
  return {comparisons:this.comparisons,unresolved:this.unresolved,expressions:this.expressions};
 }
}
