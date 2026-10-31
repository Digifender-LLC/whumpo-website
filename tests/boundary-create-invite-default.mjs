// WH-004 finding B7 regression (offline). tools/create-invite.mjs is run from a temporary directory whose
// node_modules/wrangler/bin/wrangler.js is a recorder, so no real Wrangler, account or database is reachable.
// Policy (D2): the tool previews by default and writes only with an explicit --apply (remote), or --apply --local.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const tool=resolve('tools/create-invite.mjs'),cwd=mkdtempSync(join(tmpdir(),'whumpo-invite-regression-'));
try{
 mkdirSync(join(cwd,'node_modules/wrangler/bin'),{recursive:true});
 writeFileSync(join(cwd,'node_modules/wrangler/bin/wrangler.js'),"require('node:fs').appendFileSync('calls.json',JSON.stringify(process.argv.slice(2))+'\\n');\n");
 writeFileSync(join(cwd,'package.json'),'{"type":"commonjs"}');
 const run=args=>spawnSync(process.execPath,[tool,...args],{cwd,encoding:'utf8',env:{PATH:process.env.PATH,HOME:cwd}});
 const calls=()=>existsSync(join(cwd,'calls.json'))?readFileSync(join(cwd,'calls.json'),'utf8').trim().split('\n').map(l=>JSON.parse(l)):[];
 for(const args of [[],['--local']]){
  const r=run(args);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Preview only.*Nothing was written/s);
  assert.deepEqual(calls(),[],'a preview never calls Wrangler');assert.equal(existsSync(join(cwd,'.secrets')),false,'a preview creates no code or file');
 }
 assert.equal(run(['--apply']).status,0);
 assert.deepEqual(calls()[0].slice(0,4),['d1','execute','DB','--remote'],'--apply writes remotely');
 assert.equal(run(['--apply','--local']).status,0);
 assert.deepEqual(calls()[1].slice(0,4),['d1','execute','DB','--local']);
 assert.equal(calls().length,2);
 assert.deepEqual(readdirSync(join(cwd,'.secrets')).filter(f=>f.endsWith('.sql')),[]);
 console.log('create-invite: previews by default and writes nothing; --apply writes to the remote control database, --apply --local to the local one.');
}finally{rmSync(cwd,{recursive:true,force:true});}
