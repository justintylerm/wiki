import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { makeContent, createContentLoader } from '../src/content.js';
import { createWorker } from '../src/worker.js';

const root = new URL('../../', import.meta.url);
const bio = JSON.parse(await readFile(new URL('content.json', root), 'utf8'));
const updates = JSON.parse(await readFile(new URL('updates.json', root), 'utf8'));
const html = await readFile(new URL('index.html', root), 'utf8');
const data = makeContent(bio, [...updates, { id: 'secret-draft', title: 'Never expose this', text: 'draft-only-needle', type: 'note', published: false }], html);

test('real MCP client initializes, lists and calls tools over HTTP', async () => {
  const worker = createWorker(async () => data);
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.test/mcp'), {
    fetch: (url, init) => worker.fetch(new Request(url, init)),
  });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 4);
    assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
    const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
    const profile = await call('get_profile');
    assert.equal(profile.name, 'Justin Martin');
    assert.ok(!JSON.stringify(profile).includes('<span'));
    assert.ok((await call('search_content', { query: 'music' })).results.some(p => p.id === 'profile'));
    assert.deepEqual((await call('search_content', { query: 'draft-only-needle' })).results, []);
    assert.equal((await call('get_page', { id: 'secret-draft' })).error, 'Published page not found. Use search_content to find a page ID.');
    assert.equal((await call('get_page', { id: 'profile' })).source_url, 'https://justinmartin.wiki/');
    assert.ok((await call('get_contact')).links.includes('https://www.instagram.com/justinm/'));
    const invalid = await client.callTool({ name: 'search_content', arguments: { query: 'music', limit: 1000 } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); }
});

test('loader coalesces requests, caches, and retries after upstream failure', async () => {
  let calls = 0, fail = true;
  const loader = createContentLoader(async url => {
    calls++;
    if (fail) return new Response('unavailable', { status: 503 });
    return new Response(url.endsWith('content.json') ? JSON.stringify(bio) : url.endsWith('updates.json') ? JSON.stringify(updates) : html);
  });
  await assert.rejects(loader());
  fail = false;
  const [a, b] = await Promise.all([loader(), loader()]);
  assert.equal(a, b);
  await loader();
  assert.equal(calls, 6);
});

test('upstream failure returns an MCP tool error', async () => {
  const worker = createWorker(async () => { throw new Error('offline'); });
  const response = await worker.fetch(new Request('https://mcp.test/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_profile', arguments: {} } }),
  }));
  assert.equal((await response.json()).result.isError, true);
});

test('browser CORS preflight and invalid protocol requests', async () => {
  const worker = createWorker(async () => data);
  const preflight = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  const bad = await worker.fetch(new Request('https://mcp.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{' }));
  assert.equal(bad.status, 400);
});
