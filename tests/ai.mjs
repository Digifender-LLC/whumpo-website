import assert from 'node:assert/strict';
import {agentContentPolicy} from '../src/content-policy.ts';
import { build } from 'esbuild';
const bundle = await build({entryPoints:['src/ai.ts'],bundle:true,platform:'node',format:'esm',write:false});
const { complete } = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
import { buildUnits } from '../src/plans.ts';

assert.equal(buildUnits(0, 0), 0);
assert.equal(buildUnits(1000, 0), 1);
assert.equal(buildUnits(1, 250), 2);
assert.throws(() => buildUnits(-1, 1));
assert.throws(() => buildUnits(Number.MAX_SAFE_INTEGER, 1));

const config = { baseURL: 'https://example.test/v1', apiKey: 'test-secret', model: 'test-model' };
const messages = [{ role: 'user', content: 'Make a bakery website' }];
let calls = 0;
const chat = await complete(config, messages, async (url, init) => {
  calls++;
  assert.equal(url.href, 'https://example.test/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer test-secret');
  assert.equal(init.redirect, 'manual');
  assert.deepEqual(JSON.parse(init.body).messages, [{role:'system',content:agentContentPolicy},...messages]);
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'A bakery site' } }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
});
assert.deepEqual(chat, { text: 'A bakery site', inputTokens: 10, outputTokens: 20 });
const responses = await complete({ ...config, protocol: 'responses' }, messages, async (url, init) => {
  assert.equal(url.pathname, '/v1/responses');
  assert.deepEqual(JSON.parse(init.body).input,[{role:'system',content:agentContentPolicy},...messages]);
  assert.equal(JSON.parse(init.body).store, false);
  return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }], usage: { input_tokens: 3, output_tokens: 4 } });
});
assert.equal(responses.text, 'Hello');
await assert.rejects(complete({ ...config, baseURL: 'http://example.test' }, messages), { kind: 'configuration' });
await assert.rejects(complete(config, messages, async () => new Response('private upstream details test-secret', { status: 429 })), { message: 'AI provider rejected' });
await assert.rejects(complete(config, messages, async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] })), { kind: 'output_limit' });
await assert.rejects(complete(config, messages, async () => new Response('x'.repeat(262145))), { kind: 'invalid_response' });
await assert.rejects(complete(config, messages, async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Missing usage' } }] })), { kind: 'invalid_response' });
assert.equal(calls, 1);
console.log('Provider contracts passed: both protocols, usage, limits, failures, and secret-safe errors.');

// Ported Jarvis modelgateway rejection cases: successful HTTP is not enough.
for (const [patch, reason] of [
  [{model:'other-model'}, 'model_identity'],
  [{choices:[{finish_reason:'stop',message:{content:'hello',tool_calls:[{name:'deploy'}]}}]}, 'tool_content'],
  [{choices:[{finish_reason:'stop',message:{content:'echo test-secret'}}]}, 'credential_echo'],
  [{choices:[{finish_reason:'stop',message:{role:'user',content:'hello'}}]}, 'message_invalid']
]) {
  await assert.rejects(complete(config,messages,async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'hello'}}],usage:{prompt_tokens:1,completion_tokens:1},...patch})), {kind:'invalid_response',reason});
}
await assert.rejects(complete({...config,protocol:'responses'},messages,async()=>Response.json({status:'completed',output:[{type:'function_call',name:'deploy'}]})), {reason:'tool_content'});
await assert.rejects(complete(config,messages,async()=>{throw new DOMException('secret upstream address','TimeoutError');}), {kind:'unavailable',reason:'timeout',message:'AI provider unavailable'});
console.log('Jarvis response checks passed: model identity, tool isolation, credential echo, role and sanitized timeout.');

// Workers' native fetch requires its global receiver; Node's fetch hides this bug.
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async function () {
    assert.equal(this, globalThis);
    return Response.json({choices:[{finish_reason:'stop',message:{content:'Bound fetch works'}}],usage:{prompt_tokens:1,completion_tokens:1}});
  };
  assert.equal((await complete(config,messages)).text,'Bound fetch works');
} finally { globalThis.fetch = originalFetch; }
console.log('Default transport retains the Workers global receiver.');
