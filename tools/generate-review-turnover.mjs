// WH-182: derives src/review-turnover.generated.ts from the canonical schema, so the deleting statement of review turnover
// re-evaluates exactly the predicates that review_receipt_bind and each family's BEFORE DELETE guard enforce. Nothing here
// is hand-copied: if a guard changes, `--check` (part of `pnpm check`) fails until this is regenerated.
// Run `node tools/generate-review-turnover.mjs`, or with `--check` to compare only.
import {readFile,writeFile} from 'node:fs/promises';
import {currentSchema} from './current-schema.mjs';

const output='src/review-turnover.generated.ts';
const sql=await currentSchema();
const lines=sql.split('\n');

/** Bind blocks: `SELECT RAISE(ABORT,'review_receipt_bind') WHERE NEW.family='F' AND (...` up to the line ending in `;`. */
const binds=new Map();
for(let i=0;i<lines.length;i++){
 const head=/^ SELECT RAISE\(ABORT,'review_receipt_bind'\) WHERE NEW\.family='(\w+)' AND \(NEW\.lifecycle_class<>'([\w-]+)' OR NOT EXISTS\(SELECT 1 FROM (\w+) r WHERE r\.id=NEW\.id$/.exec(lines[i]);
 if(!head)continue;
 const body=[];let j=i+1;for(;j<lines.length;j++){body.push(lines[j]);if(lines[j].endsWith(';'))break;}
 binds.set(head[1],{cls:head[2],table:head[3],body});
}
if(binds.size!==21)throw Error('Expected 21 receipt families, found '+binds.size);

const one=(re,lines,family)=>{const m=lines.map(l=>re.exec(l)).filter(Boolean);if(m.length>1)throw Error(family+': ambiguous '+re);return m[0]?.[1]??null;};
const families={};
for(const [family,{cls,table,body}] of binds){
 const f={table,cls};
 if(!body.some(l=>l==='  AND r.user_id=NEW.owner_user_id'))throw Error(family+': owner is not user_id');
 const projected=body.includes('  AND r.project_id=NEW.project_id');
 if(!projected&&!body.includes('  AND NEW.project_id IS NULL'))throw Error(family+': project binding');
 f.project=projected;
 f.kind=one(/^  AND NEW\.kind=(.*)$/,body,family);
 f.target=one(/^  AND NEW\.target IS (.*)$/,body,family);
 f.digest=one(/^  AND NEW\.payload_digest=(.*)$/,body,family);
 f.hash=one(/^  AND NEW\.request_hash=(.*)$/,body,family);
 f.confirmed=one(/^  AND NEW\.confirmed_by IS (.*)$/,body,family);
 const outcome=body.find(l=>l.startsWith('  AND (NEW.outcome='));
 const group=(text,start)=>{let depth=0;for(let k=start;k<text.length;k++){if(text[k]==='(')depth++;else if(text[k]===')'&&--depth===0)return k+1;}return -1;};
 const caseStart='  AND (NEW.outcome='.length,caseEnd=group(outcome,caseStart),sup=" OR (NEW.outcome='superseded' AND ";
 if(!outcome.startsWith('  AND (NEW.outcome=(CASE ')||caseEnd<0)throw Error(family+': outcome shape');
 f.outcome=outcome.slice(caseStart,caseEnd);
 f.superseded=null;
 if(outcome.slice(caseEnd).startsWith(sup)){const start=caseEnd+sup.length;f.superseded=outcome.slice(start,group(outcome,start));}
 const head=`  AND (NEW.outcome=${f.outcome}${f.superseded?sup+f.superseded+')':''}`;
 if(!outcome.startsWith(head)||!/^\)+;?$/.test(outcome.slice(head.length)))throw Error(family+': outcome round trip '+JSON.stringify([outcome.slice(head.length),f.superseded]));
 // Round trip: the parsed pieces must rebuild the original bind lines exactly.
 const rebuilt=[`  AND NEW.kind=${f.kind}`,`  AND NEW.target IS ${f.target}`,...(f.digest?[`  AND NEW.payload_digest=${f.digest}`]:[]),...(f.hash?[`  AND NEW.request_hash=${f.hash}`]:[]),...(f.confirmed?[`  AND NEW.confirmed_by IS ${f.confirmed}`]:[])];
 for(const line of rebuilt)if(!body.includes(line))throw Error(family+': round trip '+line);
 // The matching BEFORE DELETE guard: everything before the receipt requirement is the ineligibility predicate.
 const guards=[...sql.matchAll(new RegExp(`CREATE TRIGGER (\\w+) BEFORE DELETE ON ${table}\\n(?:WHEN [^\\n]*\\n)?BEGIN\\n(?: --[^\\n]*\\n)? SELECT RAISE\\(ABORT,'\\w+'\\) WHERE ([^]*?)\\n  OR NOT EXISTS\\(SELECT 1 FROM review_receipts WHERE family='${family}' AND id=OLD\\.id AND ([^;]*)\\);\\nEND;`,'g'))];
 if(guards.length!==1)throw Error(`${family}: expected one receipt-requiring delete guard, found ${guards.length}`);
 f.ineligible=guards[0][2].replaceAll('OLD.','r.');
 f.receipt=guards[0][3].replaceAll('OLD.','r.').replace('(outcome IN','(q.outcome IN');
 if(/\sr\s|\sr\.id=r\./.test(guards[0][2]))throw Error(family+': guard uses alias r');
 // Module and composition reviews keep Unix-second expiries; the rest keep ISO text.
 f.unix=f.ineligible.includes('unixepoch()');
 // The platform-wide active count that the admission trigger compares with 5,000 (null when the family has no such cap).
 const cap=[...sql.matchAll(new RegExp(`\\(SELECT count\\(\\*\\) FROM ${table} t WHERE ((?:(?!\\(SELECT count)[^;])*?)\\)>=5000`,'g'))][0];
 f.active=cap?cap[1].replace(/\s+/g,' '):null;
 f.capTrigger=cap?[...sql.slice(0,cap.index).matchAll(/CREATE TRIGGER (\w+)/g)].at(-1)[1]:null;
 families[family]=f;
}
const helpers=String.raw`/** The family's outcome for a row the guard allows to leave (superseded only when no other outcome applies). */
export const outcomeSql=(f:ReviewFamily)=>f.superseded?` + "`COALESCE(${f.outcome},CASE WHEN ${f.superseded} THEN 'superseded' END)`" + String.raw`:f.outcome;
export const scopeColumn=(f:ReviewFamily)=>f.project?'project_id':'user_id';
/** Policy terminalGraceMs: a row is compacted only one hour after its review expired, whatever its outcome, so a retried confirmation of a just-applied review still finds its row. A pending withdrawal that a newer one has superseded has no grace: it is already replaced, and bounding withdrawal rows by target depends on it leaving at once. */
export const settledSql=(f:ReviewFamily)=>(f.unix?'r.expires_at<=unixepoch()-3600':"r.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')")+(f.superseded?' OR ('+f.outcome+' IS NULL AND '+f.superseded+')':'');
/** Row filter for FROM table r: terminal, unreferenced, unheld, outside the history window and past the grace. */
export const eligibleSql=(f:ReviewFamily)=>` + "`NOT (${f.ineligible}) AND ${outcomeSql(f)} IS NOT NULL AND (${settledSql(f)})`" + String.raw`;
`;
const file=`// Generated by tools/generate-review-turnover.mjs from the canonical schema (review_receipt_bind and each family's BEFORE DELETE
// guard). Do not edit: run \`node tools/generate-review-turnover.mjs\`. \`r\` is the review row; \`ineligible\` is the guard's
// own predicate (terminal, unreferenced, unheld, outside the history window), so the deleting statement re-checks it.
export type ReviewFamily={table:string;cls:string;project:boolean;kind:string;target:string;digest:string|null;hash:string|null;confirmed:string|null;outcome:string;superseded:string|null;ineligible:string;receipt:string;active:string|null;capTrigger:string|null;unix:boolean};
export const reviewFamilies:Record<string,ReviewFamily>=${JSON.stringify(families,null,1)};
${helpers}`;
if(process.argv.includes('--check')){if(await readFile(output,'utf8')!==file)throw Error('Review turnover module is stale; run node tools/generate-review-turnover.mjs');}
else await writeFile(output,file);
