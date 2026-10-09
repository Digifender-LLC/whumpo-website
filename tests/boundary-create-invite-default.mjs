// WH-004 finding B7 characterization (offline). tools/create-invite.mjs is run from a temporary directory whose
// node_modules/wrangler/bin/wrangler.js is a recorder, so no real Wrangler, account or database is reachable. It
// shows the tool's guard rails as they are: with no flag it immediately issues `d1 execute DB --remote`, with no
// preview, apply flag, operator reference, read-before-write or run record. This passes while that behavior is
// unchanged (a policy question for the owner, not an exploit); deliberately outside every verify profile.
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const tool=resolve('tools/create-invite.mjs'),cwd=mkdtempSync(join(tmpdir(),'whumpo-invite-characterization-'));
try{
 mkdirSync(join(cwd,'node_modules/wrangler/bin'),{recursive:true});
 writeFileSync(join(cwd,'node_modules/wrangler/bin/wrangler.js'),"require('node:fs').appendFileSync('calls.json',JSON.stringify(process.argv.slice(2))+'\\n');\n");
 writeFileSync(join(cwd,'package.json'),'{"type":"commonjs"}');
 const run=args=>spawnSync(process.execPath,[tool,...args],{cwd,encoding:'utf8',env:{PATH:process.env.PATH,HOME:cwd}});
 const calls=()=>readFileSync(join(cwd,'calls.json'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(run([]).status,0);
 const [remote]=calls();
 assert.deepEqual(remote.slice(0,4),['d1','execute','DB','--remote'],'no flag means a remote write');
 assert.equal(run(['--local']).status,0);
 assert.deepEqual(calls()[1].slice(0,4),['d1','execute','DB','--local']);
 // No other invocation happened: no read-before-write, and the SQL file is removed after the single write.
 assert.equal(calls().length,2);
 assert.deepEqual(readdirSync(join(cwd,'.secrets')).filter(f=>f.endsWith('.sql')),[]);
 console.log('create-invite characterization: with no flag it writes an invitation to the remote control database in one step (no preview/apply flag, operator reference, readback or run record); --local writes locally.');
}finally{rmSync(cwd,{recursive:true,force:true});}
