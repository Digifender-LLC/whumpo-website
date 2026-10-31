import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {posix} from 'node:path';
import {pathToFileURL} from 'node:url';

// Same rules as docs/agent-review.md. Fails safe: every path is full tier unless it is on this short allowlist.
const policyDocs=/^docs\/(legal\/|agent-review\.md$|boundary-|data-lifecycle|data-protection\.md$|deployment\.md$|disaster-recovery\.md$|identity-authority\.md$|releases\.md$|security-risk-actions\.md$|tenant-)/;
const gateTests=/^tests\/(secret-custody|deploy-ci|boundary-|tenant-|verification-profiles|review-tier|agents-md-check|build-snapshot|release-|restore-|processing-boundaries|sqlite-authorizer)/;
export const isSafePath=p=>p==='README.md'||(/^docs\/.*\.md$/.test(p)&&!policyDocs.test(p))||(/^tests\/[^/]+\.mjs$/.test(p)&&!gateTests.test(p));
export const tiers={trivial:{maxLines:10,reviewers:2},lite:{maxLines:100,reviewers:4},full:{maxLines:Infinity,reviewers:7}};

// Deploy-gate suites are derived, not listed: everything in every tools/verify.mjs profile (the deploy gate and the site, app and security sweeps) plus whatever they import (transitively).
export const gateProfiles=['fast','protection','security','site','app'];
export function gateSuites(verifyText){
 return gateProfiles.flatMap(name=>{
  const m=verifyText.match(new RegExp(`\\b${name}:\\[([^\\]]*)\\]`));
  if(!m)throw Error(`verify.mjs has no ${name} profile; the gate list cannot be derived.`);
  return [...m[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
 });
}
/** read(path) returns the file text at the base commit, or null. Returns the set of gate suites and their relative imports. */
export function gateFiles(read){
 const verify=read('tools/verify.mjs');
 if(verify==null)throw Error('tools/verify.mjs not readable.');
 const seen=new Set(),queue=gateSuites(verify);
 while(queue.length){
  const file=queue.pop();
  if(seen.has(file))continue;
  seen.add(file);
  for(const m of (read(file)??'').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g))queue.push(posix.join(posix.dirname(file),m[1]));
 }
 return seen;
}

/** files: [{path, lines, binary?}] where lines is additions plus deletions. Renames must arrive as a delete plus an add (`--no-renames`).
 * gate: set of paths that are deploy-gate suites or their imports (see gateFiles). A binary file is never safe, whatever its name. */
export function reviewTier(files,gate=new Set()){
 const lines=files.reduce((n,f)=>n+f.lines,0);
 const unsafe=files.filter(f=>f.binary||gate.has(f.path)||!isSafePath(f.path)).map(f=>f.path);
 const tier=unsafe.length||lines>tiers.lite.maxLines?'full':lines>tiers.trivial.maxLines?'lite':'trivial';
 return {tier,reviewers:tiers[tier].reviewers,lines,unsafe};
}

/** Parses `git diff --numstat --no-renames`. A binary row (`-`) has no line count, so it is flagged `binary`. */
export function parseNumstat(text){
 return text.split('\n').filter(Boolean).map(row=>{const [a,d,...p]=row.split('\t');return {path:p.join('\t'),lines:(Number(a)||0)+(Number(d)||0),...(a==='-'||d==='-'?{binary:true}:{})};});
}

/** statuses: GitHub commit statuses for the head SHA, newest first. Approval is the newest `review:clean` being `success`. */
export const hasCleanStatus=statuses=>statuses.find(s=>s.context==='review:clean')?.state==='success';

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv[2]==='--status'){
  const {GITHUB_REPOSITORY:repo,HEAD_SHA:sha,GITHUB_TOKEN:token,GITHUB_API_URL:apiUrl}=process.env,api=apiUrl||'https://api.github.com'; // Actions sets GITHUB_API_URL; read-only: lists commit statuses
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo||'')||!/^[0-9a-f]{40}$/.test(sha||'')||!token||!/^https:\/\//.test(api))throw Error('Needs GITHUB_REPOSITORY, HEAD_SHA, GITHUB_TOKEN and GITHUB_API_URL.');
  const response=await fetch(`${api}/repos/${repo}/commits/${sha}/statuses?per_page=100`,{headers:{authorization:`Bearer ${token}`,accept:'application/vnd.github+json'}});
  if(!response.ok)throw Error(`Status lookup failed: ${response.status}`);
  if(!hasCleanStatus(await response.json())){console.error(`::error::No review:clean commit status on ${sha}. A new push clears it; the reviewers must pass this exact commit (docs/agent-review.md).`);process.exit(1);}
  console.log(`review:clean status present on ${sha}.`);
 }else{
  const base=process.argv[2];
  if(!/^[0-9a-f]{7,40}$/.test(base||''))throw Error('Usage: node tools/review-tier.mjs <base-sha> | --status');
  const read=file=>{try{return execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8',maxBuffer:64e6,stdio:['ignore','pipe','ignore']});}catch{return null;}};
  const result=reviewTier(parseNumstat(execFileSync('git',['diff','--numstat','--no-renames',base,'HEAD'],{encoding:'utf8',maxBuffer:64e6})),gateFiles(read));
  const summary=`## Review tier: ${result.tier}\n\n${result.lines} changed lines, ${result.reviewers}+ reviewers. See docs/agent-review.md.\n${result.unsafe.length?'\nNot on the safe-path allowlist:\n'+result.unsafe.map(p=>'- `'+p+'`').join('\n')+'\n':''}`;
  console.log(summary);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary);
 }
}
