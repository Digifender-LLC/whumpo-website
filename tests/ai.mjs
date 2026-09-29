import assert from 'node:assert/strict';
import { complete } from '../src/ai.ts';
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
  assert.equal(init.redirect, 'error');
  assert.deepEqual(JSON.parse(init.body).messages, messages);
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'A bakery site' } }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
});
assert.deepEqual(chat, { text: 'A bakery site', inputTokens: 10, outputTokens: 20 });
const responses = await complete({ ...config, protocol: 'responses' }, messages, async (url, init) => {
  assert.equal(url.pathname, '/v1/responses');
  assert.equal(JSON.parse(init.body).store, false);
  return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }], usage: { input_tokens: 3, output_tokens: 4 } });
});
assert.equal(responses.text, 'Hello');
await assert.rejects(complete({ ...config, baseURL: 'http://example.test' }, messages), { kind: 'configuration' });
await assert.rejects(complete(config, messages, async () => new Response('private upstream details test-secret', { status: 429 })), { message: 'AI provider unavailable' });
await assert.rejects(complete(config, messages, async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] })), { kind: 'invalid_response' });
await assert.rejects(complete(config, messages, async () => new Response('x'.repeat(262145))), { kind: 'invalid_response' });
await assert.rejects(complete(config, messages, async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'Missing usage' } }] })), { kind: 'invalid_response' });
assert.equal(calls, 1);
console.log('Provider contracts passed: both protocols, usage, limits, failures, and secret-safe errors.');
